const SHEET_NAME = "訂單";
const ORDER_SEQUENCE_KEY = "BK26_ORDER_SEQUENCE";
const SHEET_CONTROLS_VERSION_KEY = "BK26_SHEET_CONTROLS_VERSION";
const SHEET_CONTROLS_VERSION = "2";

const PAYMENT_STATUS_OPTIONS = [
  "尚未付款",
  "已回報待確認",
  "已付款",
  "付款已確認",
  "已退款",
  "訂單取消"
];
const PAYMENT_METHOD_OPTIONS = [
  "未選擇",
  "中華郵政轉帳",
  "玉山銀行轉帳",
  "LINE Pay Money"
];
const SHIPPING_STATUS_OPTIONS = [
  "處理中",
  "備貨中",
  "已出貨",
  "暫緩出貨",
  "訂單取消"
];

const REPORT_SHEET_NAMES = {
  productSummary: "商品統計",
  shippingList: "每日出貨名單",
  productionSummary: "每日製作統計"
};
const SALES_PRODUCTS = [
  "蛋黃酥",
  "芋頭酥",
  "清豆椪",
  "豆沙滷肉",
  "3Q餅",
  "3Q餅單入",
  "綜合月餅",
  "鳳梨酥"
];
const PRODUCTION_PRODUCTS = [
  "蛋黃酥",
  "芋頭酥",
  "清豆椪",
  "豆沙滷肉",
  "3Q餅",
  "鳳梨酥"
];
const PRODUCT_UNITS = ["盒", "盒", "盒", "盒", "盒", "顆", "盒", "盒"];
const PIECES_PER_BOX = {
  "蛋黃酥": 8,
  "芋頭酥": 8,
  "清豆椪": 8,
  "豆沙滷肉": 8,
  "3Q餅": 5,
  "鳳梨酥": 8
};
const PRODUCT_PRICES = {
  "蛋黃酥": 600,
  "芋頭酥": 600,
  "清豆椪": 600,
  "豆沙滷肉": 600,
  "3Q餅": 400,
  "3Q餅單入": 85,
  "綜合月餅": 600,
  "鳳梨酥": 480
};
const SHIPPING_FEE = 90;
const FREE_SHIPPING_THRESHOLD = 6000;
const SHIPPING_START_DATE = "2026-08-13";
const SHIPPING_END_DATE = "2026-09-24";
const UNAVAILABLE_SHIPPING_START = "2026-08-27";
const UNAVAILABLE_SHIPPING_END = "2026-09-01";
const MAX_ORDER_QUANTITY = 100;

function doGet(e) {
  if (e && e.parameter.action === "nextOrderNumber") {
    const callback = String(e.parameter.callback || "").replace(/[^\w.$]/g, "");
    const payload = JSON.stringify({
      ok: true,
      orderNumber: createOrderNumber()
    });

    if (callback) {
      return ContentService
        .createTextOutput(`${callback}(${payload});`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    return ContentService
      .createTextOutput(payload)
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (e && e.parameter.action === "queryOrder") {
    return createJsonpResponse(e.parameter.callback, queryOrder(
      e.parameter.orderNumber,
      e.parameter.phoneHash
    ));
  }

  const sheet = getOrderSheet();

  return ContentService
    .createTextOutput(JSON.stringify({
      ok: true,
      message: "冰藍烘焙實驗室訂單系統已連線",
      sheetName: sheet.getName()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const sheet = getOrderSheet();
  let order;
  try {
    order = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (error) {
    return createJsonResponse({ ok: false, message: "請求格式錯誤" });
  }

  if (order.action === "reportPayment") {
    return createJsonResponse(reportPayment(sheet, order));
  }

  const validation = validateAndNormalizeOrder(order);
  if (!validation.ok) return createJsonResponse(validation);
  const safeOrder = validation.order;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    if (hasOrderNumber(sheet, safeOrder.orderNumber)) {
      return createJsonResponse({ ok: true, duplicate: true });
    }

    sheet.appendRow([
      safeOrder.orderNumber,
      new Date(),
      safeOrder.customerName,
      safeOrder.customerPhone,
      safeOrder.customerEmail,
      safeOrder.customerAddress,
      safeOrder.pickupMethod,
      safeOrder.shipDate,
      safeOrder.isPaid,
      safeOrder.bankLastFive,
      safeOrder.orderNote,
      safeOrder.itemsText,
      safeOrder.subtotal,
      safeOrder.shipping,
      safeOrder.total,
      safeOrder.paymentMethod,
      safeOrder.paymentReference,
      "",
      "處理中",
      ""
    ]);

    // appendRow 會讓 Google Sheets 再次猜測資料型別；立即把新列 D 欄
    // 強制設為純文字並以原始 10 碼字串重寫，確保開頭的 0 不會消失。
    sheet.getRange(sheet.getLastRow(), 4)
      .setNumberFormat("@")
      .setValue(safeOrder.customerPhone);
  } finally {
    lock.releaseLock();
  }

  refreshOrderReports();

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function validateAndNormalizeOrder(order) {
  const customerPhone = normalizePhone(order.customerPhone);
  if (!/^09\d{8}$/.test(customerPhone)) return invalidOrder("手機號碼格式錯誤");

  const orderNumber = String(order.orderNumber || "").trim().toUpperCase();
  if (!/^BK26-\d{3,8}$/.test(orderNumber)) return invalidOrder("訂單編號格式錯誤");

  const customerName = safeSheetText(order.customerName, 80);
  if (!customerName) return invalidOrder("姓名不可空白");

  const customerEmail = plainText(order.customerEmail, 254);
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return invalidOrder("Email 格式錯誤");
  }

  const pickupMethod = safeSheetText(order.pickupMethod, 100);
  if (!["工作室自取", "龍岡自取", "宅配"].includes(pickupMethod) && pickupMethod.indexOf("其他：") !== 0) {
    return invalidOrder("取貨方式錯誤");
  }

  const customerAddress = safeSheetText(order.customerAddress, 300);
  if (pickupMethod === "宅配" && (!customerAddress || customerAddress === "未填寫")) {
    return invalidOrder("宅配地址不可空白");
  }

  const shipDate = String(order.shipDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shipDate) || shipDate < SHIPPING_START_DATE || shipDate > SHIPPING_END_DATE ||
      (shipDate >= UNAVAILABLE_SHIPPING_START && shipDate <= UNAVAILABLE_SHIPPING_END)) {
    return invalidOrder("出貨日期錯誤");
  }

  const priced = priceOrderItems(order.items);
  if (!priced.ok) return priced;

  const shipping = pickupMethod === "宅配" && priced.subtotal < FREE_SHIPPING_THRESHOLD ? SHIPPING_FEE : 0;
  const isPaid = order.isPaid === "已付款" ? "已付款" : "尚未付款";
  const paymentMethod = isPaid === "已付款" && ["中華郵政轉帳", "玉山銀行轉帳", "LINE Pay Money"].includes(order.paymentMethod)
    ? String(order.paymentMethod)
    : "未選擇";
  const paymentReference = safeSheetText(
    isPaid === "已付款" ? order.paymentReference : "尚未付款",
    100
  );
  const bankLastFive = /^\d{5}$/.test(String(order.bankLastFive || ""))
    ? String(order.bankLastFive)
    : "未填寫";

  return {
    ok: true,
    order: {
      orderNumber: orderNumber,
      customerName: customerName,
      customerPhone: customerPhone,
      customerEmail: safeSheetText(customerEmail, 254),
      customerAddress: customerAddress || "未填寫",
      pickupMethod: pickupMethod,
      shipDate: shipDate,
      isPaid: isPaid,
      bankLastFive: bankLastFive,
      orderNote: safeSheetText(order.orderNote || "無", 500),
      itemsText: safeSheetText(priced.itemsText, 2000),
      subtotal: priced.subtotal,
      shipping: shipping,
      total: priced.subtotal + shipping,
      paymentMethod: paymentMethod,
      paymentReference: paymentReference || "尚未付款"
    }
  };
}

function priceOrderItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 20) return invalidOrder("訂購內容錯誤");
  let subtotal = 0;
  let totalQuantity = 0;
  const lines = [];

  for (let index = 0; index < items.length; index += 1) {
    const name = validateProductName(items[index] && items[index].name);
    const quantity = Number(items[index] && items[index].quantity);
    if (!name || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ORDER_QUANTITY) {
      return invalidOrder("商品或數量錯誤");
    }
    const baseName = name.indexOf("綜合月餅") === 0 ? "綜合月餅" : name;
    const price = PRODUCT_PRICES[baseName];
    totalQuantity += quantity;
    if (totalQuantity > MAX_ORDER_QUANTITY) return invalidOrder("訂購數量超過限制");
    subtotal += price * quantity;
    lines.push(`${name}｜$${price} x ${quantity} = $${price * quantity}`);
  }

  return { ok: true, subtotal: subtotal, itemsText: lines.join("\n") };
}

function validateProductName(value) {
  const name = plainText(value, 120);
  if (Object.prototype.hasOwnProperty.call(PRODUCT_PRICES, name) && name !== "綜合月餅") return name;
  if (name === "綜合月餅（餅香4溢組（四款各兩顆））") return name;

  const match = name.match(/^綜合月餅（(.+)4 \+ (.+)4）$/);
  const allowedMix = ["蛋黃酥", "芋頭酥", "清豆椪", "豆沙滷肉"];
  if (!match || match[1] === match[2] || !allowedMix.includes(match[1]) || !allowedMix.includes(match[2])) return "";
  return name;
}

function plainText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, maxLength);
}

function safeSheetText(value, maxLength) {
  const text = plainText(value, maxLength);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function invalidOrder(message) {
  return { ok: false, message: message };
}

function getOrderSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error("找不到目前綁定的試算表。請從 Google 試算表的「擴充功能 > Apps Script」建立這份程式。");
  }

  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "訂單編號",
      "建立時間",
      "姓名",
      "電話",
      "Email",
      "地址",
      "取貨方式",
      "出貨日期",
      "付款狀態",
      "帳號後五碼",
      "備註",
      "訂購內容",
      "商品金額",
      "運費",
      "合計",
      "付款方式",
      "付款核對資訊"
    ]);
  } else if (sheet.getRange(1, 1).getValue() !== "訂單編號") {
    sheet.insertColumnBefore(1);
    sheet.getRange(1, 1).setValue("訂單編號");
  }

  if (sheet.getRange(1, 16).getValue() !== "付款方式") {
    sheet.getRange(1, 16, 1, 2).setValues([["付款方式", "付款核對資訊"]]);
  }

  if (sheet.getRange(1, 18).getValue() !== "付款回報時間") {
    sheet.getRange(1, 18, 1, 3).setValues([["付款回報時間", "出貨狀態", "出貨單號"]]);
  }

  ensureSheetControls(sheet);

  return sheet;
}

function ensureSheetControls(sheet) {
  const properties = PropertiesService.getScriptProperties();

  if (properties.getProperty(SHEET_CONTROLS_VERSION_KEY) === SHEET_CONTROLS_VERSION) {
    return;
  }

  const dataRowCount = Math.max(1, sheet.getMaxRows() - 1);
  const paymentStatusRange = sheet.getRange(2, 9, dataRowCount, 1);
  const paymentMethodRange = sheet.getRange(2, 16, dataRowCount, 1);
  const shippingStatusRange = sheet.getRange(2, 19, dataRowCount, 1);
  const phoneRange = sheet.getRange(2, 4, dataRowCount, 1);

  phoneRange.setNumberFormat("@");
  paymentStatusRange.setDataValidation(createDropdownRule(PAYMENT_STATUS_OPTIONS));
  paymentMethodRange.setDataValidation(createDropdownRule(PAYMENT_METHOD_OPTIONS));
  shippingStatusRange.setDataValidation(createDropdownRule(SHIPPING_STATUS_OPTIONS));

  const statusRules = [
    createStatusColorRule(paymentStatusRange, "尚未付款", "#fff2d9", "#9a5a00"),
    createStatusColorRule(paymentStatusRange, "已回報待確認", "#fff8cf", "#765b12"),
    createStatusColorRule(paymentStatusRange, "已付款", "#edf8e7", "#397b2b"),
    createStatusColorRule(paymentStatusRange, "付款已確認", "#edf8e7", "#397b2b"),
    createStatusColorRule(paymentStatusRange, "已退款", "#f1f2f2", "#596064"),
    createStatusColorRule(paymentStatusRange, "訂單取消", "#fbeaea", "#954b4b"),
    createStatusColorRule(shippingStatusRange, "處理中", "#e9f4fc", "#245f91"),
    createStatusColorRule(shippingStatusRange, "備貨中", "#fff8cf", "#765b12"),
    createStatusColorRule(shippingStatusRange, "已出貨", "#edf8e7", "#397b2b"),
    createStatusColorRule(shippingStatusRange, "暫緩出貨", "#fff8cf", "#765b12"),
    createStatusColorRule(shippingStatusRange, "訂單取消", "#fbeaea", "#954b4b")
  ];

  sheet.setConditionalFormatRules(sheet.getConditionalFormatRules().concat(statusRules));
  properties.setProperty(SHEET_CONTROLS_VERSION_KEY, SHEET_CONTROLS_VERSION);
}

function createDropdownRule(options) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(options, true)
    .setAllowInvalid(false)
    .setHelpText("請從下拉選單中選擇狀態。")
    .build();
}

function createStatusColorRule(range, text, background, fontColor) {
  return SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(text)
    .setBackground(background)
    .setFontColor(fontColor)
    .setRanges([range])
    .build();
}

function createOrderNumber() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getOrderSheet();
    const properties = PropertiesService.getScriptProperties();
    const savedSequence = Number(properties.getProperty(ORDER_SEQUENCE_KEY) || 0);
    const existingOrders = Math.max(0, sheet.getLastRow() - 1);
    const nextSequence = Math.max(savedSequence, existingOrders) + 1;

    properties.setProperty(ORDER_SEQUENCE_KEY, String(nextSequence));
    return `BK26-${String(nextSequence).padStart(3, "0")}`;
  } finally {
    lock.releaseLock();
  }
}

function hasOrderNumber(sheet, orderNumber) {
  if (sheet.getLastRow() < 2) return false;

  const match = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(orderNumber)
    .matchEntireCell(true)
    .findNext();

  return Boolean(match);
}

function queryOrder(orderNumber, phoneHash) {
  const sheet = getOrderSheet();
  const attemptKey = createAttemptKey("lookup", orderNumber);
  if (isAttemptBlocked(attemptKey, 8)) return { ok: true, found: false };
  const row = findVerifiedOrderRow(sheet, orderNumber, phoneHash, true);

  if (!row) {
    recordFailedAttempt(attemptKey);
    return { ok: true, found: false };
  }

  clearFailedAttempts(attemptKey);

  const values = sheet.getRange(row, 1, 1, 20).getDisplayValues()[0];
  return {
    ok: true,
    found: true,
    order: {
      shipDate: values[7],
      paymentStatus: values[8] || "尚未付款",
      shippingStatus: values[18] || "處理中",
      trackingNumber: values[19] || ""
    }
  };
}

function reportPayment(sheet, report) {
  const attemptKey = createAttemptKey("payment", report.orderNumber);
  if (isAttemptBlocked(attemptKey, 5)) return { ok: false, message: "請稍後再試" };
  const row = findVerifiedOrderRow(
    sheet,
    report.orderNumber,
    normalizePhone(report.customerPhone),
    false
  );

  if (!row) {
    recordFailedAttempt(attemptKey);
    return { ok: false, message: "查無符合訂單" };
  }

  const method = String(report.paymentMethod || "");
  const reference = safeSheetText(report.paymentReference, 100);
  const allowedMethods = ["中華郵政轉帳", "玉山銀行轉帳", "LINE Pay Money"];

  if (allowedMethods.indexOf(method) === -1 || !reference) {
    return { ok: false, message: "付款資料不完整" };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet.getRange(row, 9).setValue("已回報待確認");
    sheet.getRange(row, 16).setValue(method);
    sheet.getRange(row, 17).setValue(reference);
    sheet.getRange(row, 18).setValue(new Date());
  } finally {
    lock.releaseLock();
  }
  clearFailedAttempts(attemptKey);
  return { ok: true };
}

function createAttemptKey(prefix, value) {
  return `security:${prefix}:${hashText(String(value || "").trim().toUpperCase()).slice(0, 24)}`;
}

function isAttemptBlocked(key, limit) {
  return Number(CacheService.getScriptCache().get(key) || 0) >= limit;
}

function recordFailedAttempt(key) {
  const cache = CacheService.getScriptCache();
  cache.put(key, String(Number(cache.get(key) || 0) + 1), 600);
}

function clearFailedAttempts(key) {
  CacheService.getScriptCache().remove(key);
}

function findVerifiedOrderRow(sheet, orderNumber, phoneProof, proofIsHash) {
  if (sheet.getLastRow() < 2) return 0;

  const normalizedOrderNumber = String(orderNumber || "").trim().toUpperCase();
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getDisplayValues();

  for (let index = 0; index < values.length; index += 1) {
    const rowOrderNumber = String(values[index][0] || "").trim().toUpperCase();
    const rowPhone = normalizePhone(values[index][3]);
    const phoneMatches = proofIsHash
      ? hashText(rowPhone) === String(phoneProof || "").toLowerCase()
      : rowPhone === phoneProof;

    if (rowOrderNumber === normalizedOrderNumber && phoneMatches) {
      return index + 2;
    }
  }

  return 0;
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function hashText(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(byte) {
    const unsignedByte = byte < 0 ? byte + 256 : byte;
    return ("0" + unsignedByte.toString(16)).slice(-2);
  }).join("");
}

function createJsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function createJsonpResponse(callback, payload) {
  const safeCallback = String(callback || "").replace(/[^\w.$]/g, "");

  if (!safeCallback) {
    return createJsonResponse(payload);
  }

  return ContentService
    .createTextOutput(`${safeCallback}(${JSON.stringify(payload)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/**
 * 試算表開啟時加入手動更新選單。第一次貼上新版程式後，
 * 可從「訂單工具 > 重新整理統計分頁」補算所有既有訂單。
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("訂單工具")
    .addItem("重新整理統計分頁", "refreshOrderReports")
    .addToUi();
}

/**
 * 使用者手動修改訂單內容、出貨日或取消狀態時同步重算。
 * Apps Script 自己寫入儲存格不會再次觸發 onEdit，因此不會形成迴圈。
 */
function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME || e.range.getRow() < 2) return;

  const firstColumn = e.range.getColumn();
  const lastColumn = e.range.getLastColumn();
  const relevantColumns = [1, 2, 3, 4, 8, 9, 12, 19];
  const affectsReports = relevantColumns.some(function(column) {
    return column >= firstColumn && column <= lastColumn;
  });

  if (affectsReports) refreshOrderReports();
}

/**
 * 重新讀取「訂單」分頁，完整重建三個統計分頁。
 * 已取消的訂單不列入；尚未付款但未取消的訂單仍保留，方便安排產能。
 */
function refreshOrderReports() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("找不到目前綁定的試算表。");

  const orderSheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!orderSheet || orderSheet.getLastRow() < 2) {
    writeOrderReports(spreadsheet, []);
    return;
  }

  const rows = orderSheet
    .getRange(2, 1, orderSheet.getLastRow() - 1, 20)
    .getValues();
  const orders = rows
    .filter(function(row) {
      const paymentStatus = String(row[8] || "");
      const shippingStatus = String(row[18] || "");
      return row[0] && paymentStatus !== "訂單取消" && shippingStatus !== "訂單取消";
    })
    .map(function(row) {
      const parsedItems = parseOrderItems(row[11]);
      return {
        orderNumber: row[0],
        createdAt: row[1],
        customerName: row[2],
        customerPhone: row[3],
        shipDate: normalizeSheetDate(row[7]),
        salesCounts: parsedItems.salesCounts,
        productionCounts: parsedItems.productionCounts
      };
    });

  writeOrderReports(spreadsheet, orders);
}

function writeOrderReports(spreadsheet, orders) {
  writeProductSummary(spreadsheet, orders);
  writeShippingList(spreadsheet, orders);
  writeProductionSummary(spreadsheet, orders);
  SpreadsheetApp.flush();
}

function writeProductSummary(spreadsheet, orders) {
  const sheet = getOrCreateReportSheet(spreadsheet, REPORT_SHEET_NAMES.productSummary);
  clearReportContents(sheet, 1, 12);

  const totals = createZeroCounts(SALES_PRODUCTS);
  orders.forEach(function(order) {
    SALES_PRODUCTS.forEach(function(product) {
      totals[product] += order.salesCounts[product] || 0;
    });
  });

  sheet.getRange(1, 1).setValue("商品累計").setFontWeight("bold");
  sheet.getRange(2, 1, 1, 3).setValues([["商品", "累計數量", "單位"]]);
  sheet.getRange(3, 1, SALES_PRODUCTS.length, 3).setValues(
    SALES_PRODUCTS.map(function(product, index) {
      return [product, totals[product], PRODUCT_UNITS[index]];
    })
  );

  const detailRows = orders.map(function(order) {
    return [order.orderNumber, order.createdAt, order.customerName, order.shipDate]
      .concat(SALES_PRODUCTS.map(function(product) {
        return order.salesCounts[product] || 0;
      }));
  });
  if (detailRows.length) {
    sheet.getRange(14, 1, detailRows.length, 12).setValues(detailRows);
    sheet.getRange(14, 2, detailRows.length, 1).setNumberFormat("m/d/yyyy h:mm:ss");
    sheet.getRange(14, 4, detailRows.length, 1).setNumberFormat("yyyy-mm-dd");
  }

  styleReportHeader(sheet.getRange(2, 1, 1, 3));
  sheet.setFrozenRows(2);
  sheet.autoResizeColumns(1, 12);
}

function writeShippingList(spreadsheet, orders) {
  const sheet = getOrCreateReportSheet(spreadsheet, REPORT_SHEET_NAMES.shippingList);
  clearReportContents(sheet, 1, 11);
  const headers = ["出貨日", "姓名", "電話"].concat(SALES_PRODUCTS);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const rows = orders
    .slice()
    .sort(compareOrdersByShipDate)
    .map(function(order) {
      return [order.shipDate, order.customerName, String(order.customerPhone || "")]
        .concat(SALES_PRODUCTS.map(function(product) {
          return order.salesCounts[product] || 0;
        }));
    });
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.getRange(2, 1, rows.length, 1).setNumberFormat("yyyy-mm-dd");
    sheet.getRange(2, 3, rows.length, 1).setNumberFormat("@");
  }

  styleReportHeader(sheet.getRange(1, 1, 1, headers.length));
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

function writeProductionSummary(spreadsheet, orders) {
  const sheet = getOrCreateReportSheet(spreadsheet, REPORT_SHEET_NAMES.productionSummary);
  clearReportContents(sheet, 1, 7);
  const headers = ["出貨日"].concat(PRODUCTION_PRODUCTS);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const byDate = {};
  orders.forEach(function(order) {
    if (!order.shipDate) return;
    const key = Utilities.formatDate(order.shipDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
    if (!byDate[key]) {
      byDate[key] = { date: order.shipDate, counts: createZeroCounts(PRODUCTION_PRODUCTS) };
    }
    PRODUCTION_PRODUCTS.forEach(function(product) {
      byDate[key].counts[product] += order.productionCounts[product] || 0;
    });
  });

  const rows = Object.keys(byDate)
    .sort()
    .map(function(key) {
      return [byDate[key].date].concat(PRODUCTION_PRODUCTS.map(function(product) {
        return byDate[key].counts[product];
      }));
    });
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.getRange(2, 1, rows.length, 1).setNumberFormat("yyyy-mm-dd");
  }

  styleReportHeader(sheet.getRange(1, 1, 1, headers.length));
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

function parseOrderItems(itemsText) {
  const salesCounts = createZeroCounts(SALES_PRODUCTS);
  const productionCounts = createZeroCounts(PRODUCTION_PRODUCTS);
  const lines = String(itemsText || "").split(/\r?\n/);

  lines.forEach(function(line) {
    const separatorIndex = line.indexOf("｜");
    const quantityMatch = line.match(/\bx\s*(\d+)\s*=/i);
    if (separatorIndex < 0 || !quantityMatch) return;

    const itemName = line.slice(0, separatorIndex).trim();
    const quantity = Number(quantityMatch[1]);
    if (!quantity) return;

    if (itemName.indexOf("綜合月餅") === 0) {
      salesCounts["綜合月餅"] += quantity;
      addMixedBoxProduction(productionCounts, itemName, quantity);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(salesCounts, itemName)) {
      salesCounts[itemName] += quantity;
    }

    if (itemName === "3Q餅單入") {
      productionCounts["3Q餅"] += quantity;
    } else if (Object.prototype.hasOwnProperty.call(PIECES_PER_BOX, itemName)) {
      productionCounts[itemName] += quantity * PIECES_PER_BOX[itemName];
    }
  });

  return { salesCounts: salesCounts, productionCounts: productionCounts };
}

function addMixedBoxProduction(counts, itemName, boxQuantity) {
  if (itemName.indexOf("餅香4溢組") !== -1) {
    ["蛋黃酥", "芋頭酥", "清豆椪", "豆沙滷肉"].forEach(function(product) {
      counts[product] += 2 * boxQuantity;
    });
    return;
  }

  const optionPattern = /(蛋黃酥|芋頭酥|清豆椪|豆沙滷肉)\s*(\d+)/g;
  let match;
  while ((match = optionPattern.exec(itemName)) !== null) {
    counts[match[1]] += Number(match[2]) * boxQuantity;
  }
}

function createZeroCounts(products) {
  return products.reduce(function(counts, product) {
    counts[product] = 0;
    return counts;
  }, {});
}

function normalizeSheetDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (!value) return null;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function compareOrdersByShipDate(left, right) {
  const leftTime = left.shipDate ? left.shipDate.getTime() : Number.MAX_SAFE_INTEGER;
  const rightTime = right.shipDate ? right.shipDate.getTime() : Number.MAX_SAFE_INTEGER;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left.orderNumber).localeCompare(String(right.orderNumber));
}

function getOrCreateReportSheet(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function clearReportContents(sheet, firstRow, columnCount) {
  const rowCount = Math.max(1, sheet.getMaxRows() - firstRow + 1);
  sheet.getRange(firstRow, 1, rowCount, columnCount).clearContent();
}

function styleReportHeader(range) {
  range
    .setBackground("#eaf3f6")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
}
