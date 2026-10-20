const APP = {
  SHEETS: {
    STATE: 'State',
    HISTORY: 'History',
    COUPONS: 'Coupons',
    WISHLIST: 'Wishlist',
    PEOPLE: 'People'
  },
  TASTY_CAP: 20,
  COZY_THRESHOLD: 20,
  REWARDS: {
    bubble_tea: { name: 'ชานมไข่มุก', cost: 5, emoji: '🧋', couponKey: 'bubble_tea' },
    tea_snack: { name: 'ชานมไข่มุก + ขนม', cost: 10, emoji: '🧋🍰', couponKey: 'tea_snack' },
    mega_snack: { name: 'ขนมเบิ้ม ๆ', cost: 15, emoji: '🍰', couponKey: 'mega_snack' },
    cinnamoroll: { name: 'น้องม่อน 1 ตัว', cost: 20, emoji: '☁️', couponKey: 'cinnamoroll' }
  },
  COUPON_TYPES: {
    bubble_tea: { name: 'คูปองชานมไข่มุก', type: 'tasty', emoji: '🧋', theme: 'bubble' },
    tea_snack: { name: 'คูปองเซ็ตชานมไข่มุก + ขนม', type: 'tasty', emoji: '🧋🍰', theme: 'set' },
    mega_snack: { name: 'คูปองขนมเบิ้ม ๆ', type: 'tasty', emoji: '🍰', theme: 'snack' },
    cinnamoroll: { name: 'คูปองน้องม่อน', type: 'tasty', emoji: '☁️', theme: 'cinna' },
    cozy: { name: 'คูปองกินอิ่มนอนอุ่น', type: 'cozy', emoji: '🌙', theme: 'cozy' },
    p_kom: { name: 'คูปองพี่คม', type: 'spa', emoji: '🧖', theme: 'bubble' }
  }
};

function doGet() {
  setup_();
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Cinna Rewards')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getInitialData() {
  setup_();
  return withLock_(function () {
    return buildAppData_();
  });
}

function addPoint(payload) {
  validateText_(payload && payload.person, 'กรุณาเลือกผู้เพิ่มแต้ม');
  const reason = payload.type === 'shower' ? 'อาบน้ำ' : String(payload.reason || '').trim();
  validateText_(reason, 'กรุณาระบุว่าได้แต้มจากอะไร');

  return withLock_(function () {
    const state = getState_();
    const tastyBefore = Number(state.tasty_points || 0);
    const cozyBefore = Number(state.cozy_points || 0);
    const tastyAfter = Math.min(APP.TASTY_CAP, tastyBefore + 1);
    const cozyTotal = cozyBefore + 1;
    const converted = Math.floor(cozyTotal / APP.COZY_THRESHOLD);
    const cozyAfter = cozyTotal % APP.COZY_THRESHOLD;

    setState_('tasty_points', tastyAfter);
    setState_('cozy_points', cozyAfter);

    const note = tastyBefore >= APP.TASTY_CAP
      ? 'แต้มของอร่อยเต็มแล้ว จึงเพิ่มเฉพาะกินอิ่มนอนอุ่น'
      : '';
    appendHistory_('ADD_POINT', payload.person, reason, 1, tastyBefore, tastyAfter, cozyBefore, cozyAfter, note);

    for (let i = 0; i < converted; i++) {
      const coupon = APP.COUPON_TYPES.cozy;
      createCoupon_(coupon.type, coupon.name, payload.person, 'แปลงอัตโนมัติจาก 20 แต้ม');
      appendHistory_('AUTO_CONVERT', payload.person, 'ครบ 20 แต้มกินอิ่มนอนอุ่น', 1, tastyAfter, tastyAfter, APP.COZY_THRESHOLD, 0, 'สร้างคูปองอัตโนมัติ');
    }
    return buildAppData_();
  });
}

function redeemReward(payload) {
  validateText_(payload && payload.person, 'กรุณาเลือกผู้แลก');
  const reward = APP.REWARDS[payload.rewardId];
  if (!reward) throw new Error('ไม่พบของรางวัลนี้');

  return withLock_(function () {
    const state = getState_();
    const before = Number(state.tasty_points || 0);
    if (before < reward.cost) throw new Error('แต้มของอร่อยยังไม่พอสำหรับรางวัลนี้');
    const after = before - reward.cost;
    setState_('tasty_points', after);
    appendHistory_('REDEEM_REWARD', payload.person, reward.name, -reward.cost, before, after, Number(state.cozy_points || 0), Number(state.cozy_points || 0), 'เบิร์นแต้มเพื่อแลกรางวัล');
    return buildAppData_();
  });
}

function addCoupon(payload) {
  validateText_(payload && payload.person, 'กรุณาเลือกผู้เพิ่มคูปอง');
  const coupon = APP.COUPON_TYPES[payload.couponKey];
  if (!coupon) throw new Error('กรุณาเลือกประเภทคูปอง');

  return withLock_(function () {
    createCoupon_(coupon.type, coupon.name, payload.person, 'เพิ่มคูปองด้วยตนเอง');
    const state = getState_();
    appendHistory_('ADD_COUPON', payload.person, coupon.name, 1, Number(state.tasty_points || 0), Number(state.tasty_points || 0), Number(state.cozy_points || 0), Number(state.cozy_points || 0), 'เพิ่มคูปองด้วยตนเอง');
    return buildAppData_();
  });
}

function useCoupon(payload) {
  validateText_(payload && payload.person, 'กรุณาเลือกผู้ใช้คูปอง');
  validateText_(payload && payload.id, 'ไม่พบคูปอง');

  return withLock_(function () {
    const sheet = getSheet_(APP.SHEETS.COUPONS);
    const values = sheet.getDataRange().getValues();
    const rowIndex = values.findIndex(function (row, index) { return index > 0 && row[0] === payload.id; });
    if (rowIndex < 1) throw new Error('ไม่พบคูปองนี้');
    if (values[rowIndex][5] !== 'ACTIVE') throw new Error('คูปองนี้ถูกใช้ไปแล้ว');
    sheet.getRange(rowIndex + 1, 6, 1, 3).setValues([['USED', new Date(), payload.person]]);
    const state = getState_();
    appendHistory_('USE_COUPON', payload.person, values[rowIndex][2], -1, Number(state.tasty_points || 0), Number(state.tasty_points || 0), Number(state.cozy_points || 0), Number(state.cozy_points || 0), payload.note || 'ใช้คูปอง');
    return buildAppData_();
  });
}

function addWishlistItem(payload) {
  validateText_(payload && payload.person, 'กรุณาเลือกผู้เพิ่ม');
  const title = String(payload.title || '').trim();
  validateText_(title, 'กรุณาใส่ชื่อร้านหรือสถานที่');
  const listType = payload.listType === 'trip' ? 'trip' : 'food';
  getSheet_(APP.SHEETS.WISHLIST).appendRow([
    Utilities.getUuid(), new Date(), listType, title, String(payload.note || '').trim(), payload.person, 'WISH'
  ]);
  return buildAppData_();
}

function toggleWishlistItem(payload) {
  validateText_(payload && payload.id, 'ไม่พบรายการ');
  return withLock_(function () {
    const sheet = getSheet_(APP.SHEETS.WISHLIST);
    const values = sheet.getDataRange().getValues();
    const rowIndex = values.findIndex(function (row, index) { return index > 0 && row[0] === payload.id; });
    if (rowIndex < 1) throw new Error('ไม่พบรายการนี้');
    const next = values[rowIndex][6] === 'DONE' ? 'WISH' : 'DONE';
    sheet.getRange(rowIndex + 1, 7).setValue(next);
    return buildAppData_();
  });
}

function deleteHistoryRecord(payload) {
  validateText_(payload && payload.id, 'ไม่พบรายการที่ต้องการลบ');
  validateText_(payload && payload.person, 'กรุณาเลือกผู้ลบรายการ');

  return withLock_(function () {
    const historySheet = getSheet_(APP.SHEETS.HISTORY);
    const historyValues = historySheet.getDataRange().getValues();
    const rowIndex = historyValues.findIndex(function (row, index) {
      return index > 0 && row[0] === payload.id;
    });
    if (rowIndex < 1) throw new Error('ไม่พบรายการนี้ หรือรายการถูกลบไปแล้ว');

    const record = historyValues[rowIndex];
    const action = String(record[2] || '');
    if (action === 'DELETE_RECORD') throw new Error('รายการบันทึกการลบ ไม่สามารถลบซ้ำได้');

    const state = getState_();
    const tastyBefore = Number(state.tasty_points || 0);
    const cozyBefore = Number(state.cozy_points || 0);
    let tastyAfter = tastyBefore;
    let cozyAfter = cozyBefore;

    if (action === 'ADD_POINT') {
      const tastyGain = Math.max(0, Number(record[7] || 0) - Number(record[6] || 0));
      tastyAfter = Math.max(0, tastyBefore - tastyGain);

      if (cozyBefore > 0) {
        cozyAfter = cozyBefore - 1;
      } else {
        const couponSheet = getSheet_(APP.SHEETS.COUPONS);
        const couponValues = couponSheet.getDataRange().getValues();
        let couponRow = -1;
        for (let i = couponValues.length - 1; i > 0; i--) {
          const isAutoCozy = couponValues[i][2] === APP.COUPON_TYPES.cozy.name &&
            couponValues[i][5] === 'ACTIVE' &&
            String(couponValues[i][8] || '').indexOf('แปลงอัตโนมัติ') >= 0;
          if (isAutoCozy) { couponRow = i + 1; break; }
        }
        if (couponRow < 0) {
          throw new Error('ย้อนแต้มนี้ไม่ได้ เพราะคูปองกินอิ่มนอนอุ่นที่เกี่ยวข้องถูกใช้ไปแล้ว');
        }
        couponSheet.deleteRow(couponRow);
        cozyAfter = APP.COZY_THRESHOLD - 1;
      }

      setState_('tasty_points', tastyAfter);
      setState_('cozy_points', cozyAfter);
    }

    historySheet.deleteRow(rowIndex + 1);
    appendHistory_(
      'DELETE_RECORD', payload.person,
      (action === 'ADD_POINT' ? 'ลบแต้ม: ' : 'ลบเรคคอร์ด: ') + String(record[4] || action),
      action === 'ADD_POINT' ? -1 : 0,
      tastyBefore, tastyAfter, cozyBefore, cozyAfter,
      'ลบรายการเดิม ' + payload.id
    );
    return buildAppData_();
  });
}

function getBackendUrl() {
  return getDb_().getUrl();
}

function buildAppData_() {
  const state = getState_();
  const coupons = rowsToObjects_(getSheet_(APP.SHEETS.COUPONS)).map(serializeDates_);
  const wishlist = rowsToObjects_(getSheet_(APP.SHEETS.WISHLIST)).map(serializeDates_);
  const history = rowsToObjects_(getSheet_(APP.SHEETS.HISTORY)).slice(-30).reverse().map(serializeDates_);
  const people = rowsToObjects_(getSheet_(APP.SHEETS.PEOPLE)).filter(function (x) { return String(x.active).toUpperCase() !== 'FALSE'; });
  return {
    points: {
      tasty: Number(state.tasty_points || 0),
      cozy: Number(state.cozy_points || 0),
      tastyCap: APP.TASTY_CAP,
      cozyThreshold: APP.COZY_THRESHOLD
    },
    rewards: Object.keys(APP.REWARDS).map(function (id) {
      return Object.assign({ id: id }, APP.REWARDS[id]);
    }),
    couponTypes: Object.keys(APP.COUPON_TYPES).map(function (id) {
      return Object.assign({ id: id }, APP.COUPON_TYPES[id]);
    }),
    coupons: coupons,
    wishlist: wishlist,
    history: history,
    people: people.length ? people : [{ name: 'ฝน' }, { name: 'เบว' }],
    backendUrl: getDb_().getUrl()
  };
}

function setup_() {
  const db = getDb_();
  ensureSheet_(db, APP.SHEETS.STATE, ['key', 'value']);
  ensureSheet_(db, APP.SHEETS.HISTORY, ['id', 'timestamp', 'action', 'person', 'detail', 'amount', 'tasty_before', 'tasty_after', 'cozy_before', 'cozy_after', 'note']);
  ensureSheet_(db, APP.SHEETS.COUPONS, ['id', 'created_at', 'name', 'type', 'created_by', 'status', 'used_at', 'used_by', 'source']);
  ensureSheet_(db, APP.SHEETS.WISHLIST, ['id', 'created_at', 'list_type', 'title', 'note', 'created_by', 'status']);
  ensureSheet_(db, APP.SHEETS.PEOPLE, ['name', 'active']);

  const state = getSheet_(APP.SHEETS.STATE);
  if (state.getLastRow() === 1) {
    state.getRange(2, 1, 2, 2).setValues([['tasty_points', 0], ['cozy_points', 0]]);
  }
  const people = getSheet_(APP.SHEETS.PEOPLE);
  if (people.getLastRow() === 1) {
    people.getRange(2, 1, 2, 2).setValues([['ฝน', true], ['เบว', true]]);
  } else if (people.getLastRow() === 3) {
    const currentNames = people.getRange(2, 1, 2, 1).getValues().map(function (row) { return row[0]; });
    if (currentNames[0] === 'ฉัน' && currentNames[1] === 'แฟน') {
      people.getRange(2, 1, 2, 1).setValues([['ฝน'], ['เบว']]);
    }
  }
  styleSheets_();
}

function getDb_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('DATABASE_SPREADSHEET_ID');
  if (!id) {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    const db = active || SpreadsheetApp.create('Cinna Rewards Database');
    id = db.getId();
    props.setProperty('DATABASE_SPREADSHEET_ID', id);
  }
  return SpreadsheetApp.openById(id);
}

function ensureSheet_(db, name, headers) {
  let sheet = db.getSheetByName(name);
  if (!sheet) sheet = db.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  return sheet;
}

function styleSheets_() {
  Object.keys(APP.SHEETS).forEach(function (key) {
    const sheet = getSheet_(APP.SHEETS[key]);
    if (sheet.getLastColumn() > 0) {
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, sheet.getLastColumn())
        .setBackground('#bde6ff').setFontColor('#31567a').setFontWeight('bold');
    }
  });
}

function getSheet_(name) {
  const sheet = getDb_().getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบชีต ' + name);
  return sheet;
}

function getState_() {
  const values = getSheet_(APP.SHEETS.STATE).getDataRange().getValues();
  return values.slice(1).reduce(function (result, row) {
    result[row[0]] = row[1];
    return result;
  }, {});
}

function setState_(key, value) {
  const sheet = getSheet_(APP.SHEETS.STATE);
  const values = sheet.getDataRange().getValues();
  const index = values.findIndex(function (row, i) { return i > 0 && row[0] === key; });
  if (index < 1) sheet.appendRow([key, value]);
  else sheet.getRange(index + 1, 2).setValue(value);
}

function createCoupon_(type, name, person, source) {
  getSheet_(APP.SHEETS.COUPONS).appendRow([
    Utilities.getUuid(), new Date(), name, type, person, 'ACTIVE', '', '', source
  ]);
}

function appendHistory_(action, person, detail, amount, tastyBefore, tastyAfter, cozyBefore, cozyAfter, note) {
  getSheet_(APP.SHEETS.HISTORY).appendRow([
    Utilities.getUuid(), new Date(), action, person, detail, amount,
    tastyBefore, tastyAfter, cozyBefore, cozyAfter, note || ''
  ]);
}

function rowsToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(function (row) { return row[0] !== ''; }).map(function (row) {
    return headers.reduce(function (obj, header, i) {
      obj[header] = row[i];
      return obj;
    }, {});
  });
}

function serializeDates_(obj) {
  Object.keys(obj).forEach(function (key) {
    if (obj[key] instanceof Date) obj[key] = obj[key].toISOString();
  });
  return obj;
}

function validateText_(value, message) {
  if (!String(value || '').trim()) throw new Error(message);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}
