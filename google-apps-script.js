const SHEET_NAME = "訂單";
const ORDER_SEQUENCE_KEY = "BK26_ORDER_SEQUENCE";

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
  const order = JSON.parse(e.postData.contents || "{}");

  if (order.action === "reportPayment") {
    return createJsonResponse(reportPayment(sheet, order));
  }

  if (order.orderNumber && hasOrderNumber(sheet, order.orderNumber)) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, duplicate: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  sheet.appendRow([
    order.orderNumber,
    new Date(),
    order.customerName,
    order.customerPhone,
    order.customerEmail,
    order.customerAddress,
    order.pickupMethod,
    order.shipDate,
    order.isPaid,
    order.bankLastFive,
    order.orderNote,
    order.itemsText,
    order.subtotal,
    order.shipping,
    order.total,
    order.paymentMethod,
    order.paymentReference,
    "",
    "處理中",
    ""
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
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

  return sheet;
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
  const row = findVerifiedOrderRow(sheet, orderNumber, phoneHash, true);

  if (!row) {
    return { ok: true, found: false };
  }

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
  const row = findVerifiedOrderRow(
    sheet,
    report.orderNumber,
    normalizePhone(report.customerPhone),
    false
  );

  if (!row) {
    return { ok: false, message: "查無符合訂單" };
  }

  const method = String(report.paymentMethod || "");
  const reference = String(report.paymentReference || "");
  const allowedMethods = ["中華郵政轉帳", "玉山銀行轉帳", "LINE Pay Money"];

  if (allowedMethods.indexOf(method) === -1 || !reference) {
    return { ok: false, message: "付款資料不完整" };
  }

  sheet.getRange(row, 9).setValue("已回報待確認");
  sheet.getRange(row, 16).setValue(method);
  sheet.getRange(row, 17).setValue(reference);
  sheet.getRange(row, 18).setValue(new Date());
  return { ok: true };
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
