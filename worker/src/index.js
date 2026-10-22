const SHEETS = ['State', 'History', 'Coupons', 'Wishlist', 'People'];
const REWARDS = {
  bubble_tea: { name: 'ชานมไข่มุก', cost: 5, emoji: '🧋', couponKey: 'bubble_tea' },
  tea_snack: { name: 'ชานมไข่มุก + ขนม', cost: 10, emoji: '🧋🍰', couponKey: 'tea_snack' },
  mega_snack: { name: 'ขนมเบิ้ม ๆ', cost: 15, emoji: '🍰', couponKey: 'mega_snack' },
  cinnamoroll: { name: 'น้องม่อน 1 ตัว', cost: 20, emoji: '☁️', couponKey: 'cinnamoroll' }
};
const COUPON_TYPES = {
  bubble_tea: { name: 'คูปองชานมไข่มุก', type: 'tasty', emoji: '🧋', theme: 'bubble' },
  tea_snack: { name: 'คูปองเซ็ตชานมไข่มุก + ขนม', type: 'tasty', emoji: '🧋🍰', theme: 'set' },
  mega_snack: { name: 'คูปองขนมเบิ้ม ๆ', type: 'tasty', emoji: '🍰', theme: 'snack' },
  cinnamoroll: { name: 'คูปองน้องม่อน', type: 'tasty', emoji: '☁️', theme: 'cinna' },
  cozy: { name: 'คูปองกินอิ่มนอนอุ่น', type: 'cozy', emoji: '🌙', theme: 'cozy' },
  p_kom: { name: 'คูปองพี่คม', type: 'spa', emoji: '🧖', theme: 'bubble' }
};
const HEADERS = {
  State: ['key', 'value'],
  History: ['id', 'timestamp', 'action', 'person', 'detail', 'amount', 'tasty_before', 'tasty_after', 'cozy_before', 'cozy_after', 'note'],
  Coupons: ['id', 'created_at', 'name', 'type', 'created_by', 'status', 'used_at', 'used_by', 'source'],
  Wishlist: ['id', 'created_at', 'list_type', 'title', 'note', 'created_by', 'status'],
  People: ['name', 'active']
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = origin === env.FRONTEND_ORIGIN;
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    if (allowed) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Content-Type';
      headers.Vary = 'Origin';
    }
    if (origin && !allowed) return new Response(JSON.stringify({ error: 'ไม่อนุญาตให้เข้าถึงจากเว็บไซต์นี้' }), { status: 403, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    if (Number(request.headers.get('Content-Length') || 0) > 8192) return new Response(JSON.stringify({ error: 'ข้อมูลยาวเกินไป' }), { status: 413, headers });
    const stub = env.SERIALIZER.get(env.SERIALIZER.idFromName('cinna-rewards'));
    return stub.fetch(request).then(async response => new Response(response.body, { status: response.status, headers }));
  }
};

export class Serializer {
  constructor(ctx, env) {
    this.env = env;
    this.queue = Promise.resolve();
    this.token = null;
    this.tokenUntil = 0;
  }

  fetch(request) {
    const run = this.queue.then(() => this.handle(request));
    this.queue = run.catch(() => {});
    return run;
  }

  async handle(request) {
    try {
      const { method, payload = {} } = await request.json();
      if (!['getInitialData', 'addPoint', 'redeemReward', 'addCoupon', 'useCoupon', 'addWishlistItem', 'toggleWishlistItem', 'deleteHistoryRecord'].includes(method)) throw new InputError('ไม่พบคำสั่งนี้');
      const rows = await this.readAll();
      if (method !== 'getInitialData') {
        const sheetIds = await this.sheetIds();
        const requests = mutate(method, payload, rows, sheetIds);
        await this.google(`https://sheets.googleapis.com/v4/spreadsheets/${this.env.SHEET_ID}:batchUpdate`, {
          method: 'POST', body: JSON.stringify({ requests })
        });
        return Response.json(buildData(await this.readAll(), this.env.SHEET_ID));
      }
      return Response.json(buildData(rows, this.env.SHEET_ID));
    } catch (error) {
      const status = error instanceof InputError ? 400 : 502;
      if (status === 502) console.error(error);
      return Response.json({ error: status === 400 ? error.message : 'เชื่อมต่อ Google Sheets ไม่สำเร็จ กรุณาลองอีกครั้ง' }, { status });
    }
  }

  async readAll() {
    const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
    for (const name of SHEETS) params.append('ranges', `'${name}'!A:K`);
    const result = await this.google(`https://sheets.googleapis.com/v4/spreadsheets/${this.env.SHEET_ID}/values:batchGet?${params}`);
    const rows = {};
    result.valueRanges.forEach((range, index) => {
      const name = SHEETS[index];
      if (!range.values?.length || HEADERS[name].some((header, i) => range.values[0][i] !== header)) throw new Error(`Invalid ${name} sheet headers`);
      rows[name] = range.values;
    });
    return rows;
  }

  async sheetIds() {
    if (this.ids) return this.ids;
    const result = await this.google(`https://sheets.googleapis.com/v4/spreadsheets/${this.env.SHEET_ID}?fields=sheets(properties(sheetId,title))`);
    this.ids = Object.fromEntries(result.sheets.map(sheet => [sheet.properties.title, sheet.properties.sheetId]));
    if (SHEETS.some(name => this.ids[name] === undefined)) throw new Error('Missing sheet');
    return this.ids;
  }

  async google(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' } });
    if (!response.ok) throw new Error(`Google Sheets API ${response.status}: ${await response.text()}`);
    return response.json();
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenUntil) return this.token;
    const account = JSON.parse(this.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const now = Math.floor(Date.now() / 1000);
    const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const keyBytes = Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
    const assertion = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    if (!response.ok) throw new Error(`Google auth ${response.status}: ${await response.text()}`);
    const result = await response.json();
    this.token = result.access_token;
    this.tokenUntil = Date.now() + (result.expires_in - 60) * 1000;
    return this.token;
  }
}

class InputError extends Error {}
const required = (value, message) => {
  if (!String(value || '').trim()) throw new InputError(message);
  return String(value).trim();
};
const numeric = value => Number(value || 0);
const cell = value => ({ userEnteredValue: typeof value === 'number' ? { numberValue: value } : typeof value === 'boolean' ? { boolValue: value } : { stringValue: String(value ?? '') } });
const append = (ids, name, values) => ({ appendCells: { sheetId: ids[name], rows: [{ values: values.map(cell) }], fields: 'userEnteredValue' } });
const update = (ids, name, row, column, values) => ({ updateCells: { range: { sheetId: ids[name], startRowIndex: row, endRowIndex: row + 1, startColumnIndex: column, endColumnIndex: column + values.length }, rows: [{ values: values.map(cell) }], fields: 'userEnteredValue' } });
const remove = (ids, name, row) => ({ deleteDimension: { range: { sheetId: ids[name], dimension: 'ROWS', startIndex: row, endIndex: row + 1 } } });
const history = (ids, action, person, detail, amount, tastyBefore, tastyAfter, cozyBefore, cozyAfter, note = '') => append(ids, 'History', [crypto.randomUUID(), new Date().toISOString(), action, person, detail, amount, tastyBefore, tastyAfter, cozyBefore, cozyAfter, note]);
const coupon = (ids, type, name, person, source) => append(ids, 'Coupons', [crypto.randomUUID(), new Date().toISOString(), name, type, person, 'ACTIVE', '', '', source]);
const findRow = (rows, id) => rows.findIndex((row, index) => index > 0 && row[0] === id);
const state = rows => Object.fromEntries(rows.slice(1).map(row => [row[0], row[1]]));
const setState = (ids, rows, key, value) => {
  const row = findRow(rows, key);
  return row < 1 ? append(ids, 'State', [key, value]) : update(ids, 'State', row, 1, [value]);
};

function mutate(method, payload, rows, ids) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new InputError('ข้อมูลไม่ถูกต้อง');
  const current = state(rows.State);
  const tasty = numeric(current.tasty_points);
  const cozy = numeric(current.cozy_points);
  const requests = [];
  if (method === 'addPoint') {
    const person = required(payload.person, 'กรุณาเลือกผู้เพิ่มแต้ม');
    const reason = required(payload.type === 'shower' ? 'อาบน้ำ' : payload.reason, 'กรุณาระบุว่าได้แต้มจากอะไร');
    const tastyAfter = Math.min(20, tasty + 1);
    const cozyAfter = (cozy + 1) % 20;
    requests.push(setState(ids, rows.State, 'tasty_points', tastyAfter), setState(ids, rows.State, 'cozy_points', cozyAfter));
    requests.push(history(ids, 'ADD_POINT', person, reason, 1, tasty, tastyAfter, cozy, cozyAfter, tasty >= 20 ? 'แต้มของอร่อยเต็มแล้ว จึงเพิ่มเฉพาะกินอิ่มนอนอุ่น' : ''));
    if (cozy + 1 >= 20) {
      requests.push(coupon(ids, 'cozy', COUPON_TYPES.cozy.name, person, 'แปลงอัตโนมัติจาก 20 แต้ม'));
      requests.push(history(ids, 'AUTO_CONVERT', person, 'ครบ 20 แต้มกินอิ่มนอนอุ่น', 1, tastyAfter, tastyAfter, 20, 0, 'สร้างคูปองอัตโนมัติ'));
    }
  } else if (method === 'redeemReward') {
    const person = required(payload.person, 'กรุณาเลือกผู้แลก');
    const reward = REWARDS[payload.rewardId];
    if (!reward) throw new InputError('ไม่พบของรางวัลนี้');
    if (tasty < reward.cost) throw new InputError('แต้มของอร่อยยังไม่พอสำหรับรางวัลนี้');
    requests.push(setState(ids, rows.State, 'tasty_points', tasty - reward.cost));
    requests.push(history(ids, 'REDEEM_REWARD', person, reward.name, -reward.cost, tasty, tasty - reward.cost, cozy, cozy, 'เบิร์นแต้มเพื่อแลกรางวัล'));
  } else if (method === 'addCoupon') {
    const person = required(payload.person, 'กรุณาเลือกผู้เพิ่มคูปอง');
    const type = COUPON_TYPES[payload.couponKey];
    if (!type) throw new InputError('กรุณาเลือกประเภทคูปอง');
    requests.push(coupon(ids, type.type, type.name, person, 'เพิ่มคูปองด้วยตนเอง'));
    requests.push(history(ids, 'ADD_COUPON', person, type.name, 1, tasty, tasty, cozy, cozy, 'เพิ่มคูปองด้วยตนเอง'));
  } else if (method === 'useCoupon') {
    const person = required(payload.person, 'กรุณาเลือกผู้ใช้คูปอง');
    const id = required(payload.id, 'ไม่พบคูปอง');
    const row = findRow(rows.Coupons, id);
    if (row < 1) throw new InputError('ไม่พบคูปองนี้');
    if (rows.Coupons[row][5] !== 'ACTIVE') throw new InputError('คูปองนี้ถูกใช้ไปแล้ว');
    requests.push(update(ids, 'Coupons', row, 5, ['USED', new Date().toISOString(), person]));
    requests.push(history(ids, 'USE_COUPON', person, rows.Coupons[row][2], -1, tasty, tasty, cozy, cozy, payload.note || 'ใช้คูปอง'));
  } else if (method === 'addWishlistItem') {
    const person = required(payload.person, 'กรุณาเลือกผู้เพิ่ม');
    const title = required(payload.title, 'กรุณาใส่ชื่อร้านหรือสถานที่');
    requests.push(append(ids, 'Wishlist', [crypto.randomUUID(), new Date().toISOString(), payload.listType === 'trip' ? 'trip' : 'food', title, String(payload.note || '').trim(), person, 'WISH']));
  } else if (method === 'toggleWishlistItem') {
    const id = required(payload.id, 'ไม่พบรายการ');
    const row = findRow(rows.Wishlist, id);
    if (row < 1) throw new InputError('ไม่พบรายการนี้');
    requests.push(update(ids, 'Wishlist', row, 6, [rows.Wishlist[row][6] === 'DONE' ? 'WISH' : 'DONE']));
  } else if (method === 'deleteHistoryRecord') {
    const id = required(payload.id, 'ไม่พบรายการที่ต้องการลบ');
    const person = required(payload.person, 'กรุณาเลือกผู้ลบรายการ');
    const row = findRow(rows.History, id);
    if (row < 1) throw new InputError('ไม่พบรายการนี้ หรือรายการถูกลบไปแล้ว');
    const record = rows.History[row];
    const action = String(record[2] || '');
    if (action === 'DELETE_RECORD') throw new InputError('รายการบันทึกการลบ ไม่สามารถลบซ้ำได้');
    let tastyAfter = tasty;
    let cozyAfter = cozy;
    if (action === 'ADD_POINT') {
      tastyAfter = Math.max(0, tasty - Math.max(0, numeric(record[7]) - numeric(record[6])));
      if (cozy > 0) cozyAfter = cozy - 1;
      else {
        let couponRow = -1;
        for (let i = rows.Coupons.length - 1; i > 0; i--) {
          const item = rows.Coupons[i];
          if (item[2] === COUPON_TYPES.cozy.name && item[5] === 'ACTIVE' && String(item[8] || '').includes('แปลงอัตโนมัติ')) { couponRow = i; break; }
        }
        if (couponRow < 0) throw new InputError('ย้อนแต้มนี้ไม่ได้ เพราะคูปองกินอิ่มนอนอุ่นที่เกี่ยวข้องถูกใช้ไปแล้ว');
        requests.push(remove(ids, 'Coupons', couponRow));
        cozyAfter = 19;
      }
      requests.push(setState(ids, rows.State, 'tasty_points', tastyAfter), setState(ids, rows.State, 'cozy_points', cozyAfter));
    }
    requests.push(remove(ids, 'History', row));
    requests.push(history(ids, 'DELETE_RECORD', person, (action === 'ADD_POINT' ? 'ลบแต้ม: ' : 'ลบเรคคอร์ด: ') + String(record[4] || action), action === 'ADD_POINT' ? -1 : 0, tasty, tastyAfter, cozy, cozyAfter, 'ลบรายการเดิม ' + id));
  }
  return requests;
}

function buildData(rows, sheetId) {
  const toObjects = name => rows[name].slice(1).filter(row => row[0] !== '').map(row => Object.fromEntries(HEADERS[name].map((header, index) => [header, row[index] ?? ''])));
  const dates = (items, keys) => items.map(item => {
    for (const key of keys) {
      if (typeof item[key] === 'number') item[key] = new Date(Date.UTC(1899, 11, 30) + item[key] * 86400000).toISOString();
    }
    return item;
  });
  const current = state(rows.State);
  const people = toObjects('People').filter(item => String(item.active).toUpperCase() !== 'FALSE');
  return {
    points: { tasty: numeric(current.tasty_points), cozy: numeric(current.cozy_points), tastyCap: 20, cozyThreshold: 20 },
    rewards: Object.entries(REWARDS).map(([id, value]) => ({ id, ...value })),
    couponTypes: Object.entries(COUPON_TYPES).map(([id, value]) => ({ id, ...value })),
    coupons: dates(toObjects('Coupons'), ['created_at', 'used_at']),
    wishlist: dates(toObjects('Wishlist'), ['created_at']),
    history: dates(toObjects('History').slice(-30).reverse(), ['timestamp']),
    people: people.length ? people : [{ name: 'ฝน' }, { name: 'เบว' }],
    backendUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`
  };
}

export { mutate, buildData };
