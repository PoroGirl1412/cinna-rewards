import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mutate, buildData } from './index.js';

const ids = { State: 1, History: 2, Coupons: 3, Wishlist: 4, People: 5 };
const rows = (tasty = 0, cozy = 0) => ({
  State: [['key', 'value'], ['tasty_points', tasty], ['cozy_points', cozy]],
  History: [['id', 'timestamp', 'action', 'person', 'detail', 'amount', 'tasty_before', 'tasty_after', 'cozy_before', 'cozy_after', 'note']],
  Coupons: [['id', 'created_at', 'name', 'type', 'created_by', 'status', 'used_at', 'used_by', 'source']],
  Wishlist: [['id', 'created_at', 'list_type', 'title', 'note', 'created_by', 'status']],
  People: [['name', 'active'], ['ฝน', true]]
});
const updatedValue = (requests, sheetId, row, column) => requests.find(request => request.updateCells?.range.sheetId === sheetId && request.updateCells.range.startRowIndex === row && request.updateCells.range.startColumnIndex === column)?.updateCells.rows[0].values[0].userEnteredValue;

test('point cap and automatic cozy coupon preserve existing rules', () => {
  const requests = mutate('addPoint', { type: 'shower', person: 'ฝน' }, rows(20, 19), ids);
  assert.deepEqual(updatedValue(requests, 1, 1, 1), { numberValue: 20 });
  assert.deepEqual(updatedValue(requests, 1, 2, 1), { numberValue: 0 });
  assert.equal(requests.filter(request => request.appendCells?.sheetId === 3).length, 1);
  assert.equal(requests.filter(request => request.appendCells?.sheetId === 2).length, 2);
});

test('reversing a point at zero cozy points requires an unused automatic coupon', () => {
  const data = rows(8, 0);
  data.History.push(['point-1', '', 'ADD_POINT', 'ฝน', 'อาบน้ำ', 1, 7, 8, 19, 0, '']);
  data.Coupons.push(['coupon-1', '', 'คูปองกินอิ่มนอนอุ่น', 'cozy', 'ฝน', 'ACTIVE', '', '', 'แปลงอัตโนมัติจาก 20 แต้ม']);
  const requests = mutate('deleteHistoryRecord', { id: 'point-1', person: 'ฝน' }, data, ids);
  assert.deepEqual(updatedValue(requests, 1, 2, 1), { numberValue: 19 });
  assert.equal(requests.filter(request => request.deleteDimension).length, 2);
  data.Coupons[1][5] = 'USED';
  assert.throws(() => mutate('deleteHistoryRecord', { id: 'point-1', person: 'ฝน' }, data, ids), /ย้อนแต้มนี้ไม่ได้/);
});

test('coupon catalog and sheet data retain the existing API shape', () => {
  const data = buildData(rows(3, 4), 'sheet-id');
  assert.equal(data.couponTypes.find(item => item.id === 'p_kom').emoji, '🧖');
  assert.deepEqual(data.points, { tasty: 3, cozy: 4, tastyCap: 20, cozyThreshold: 20 });
  assert.equal(data.backendUrl, 'https://docs.google.com/spreadsheets/d/sheet-id/edit');
});
