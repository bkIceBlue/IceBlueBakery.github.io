const ORDER_SERVICE_URL = "https://script.google.com/macros/s/AKfycby-IJJhPh_FxLd8Gz2rfxS96J5-E0lvmeJaRdL1yaz4lDRGqaSIhoOd_ogfjT-m5AS1zg/exec";

const lookupForm = document.querySelector("#order-lookup-form");
const lookupButton = document.querySelector("#lookup-button");
const lookupStatus = document.querySelector("#lookup-status");
const orderResult = document.querySelector("#order-result");
const paymentReportForm = document.querySelector("#payment-report-form");
const paymentMethod = document.querySelector("#report-payment-method");
const bankReferenceField = document.querySelector("#bank-reference-field");
const bankLastFive = document.querySelector("#report-bank-last-five");
const linePayReferenceField = document.querySelector("#linepay-reference-field");
const linePayName = document.querySelector("#report-linepay-name");
const paymentReportButton = document.querySelector("#payment-report-button");
const paymentReportStatus = document.querySelector("#payment-report-status");

let verifiedOrder = null;

lookupForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!lookupForm.reportValidity()) return;

    const orderNumber = document.querySelector("#lookup-order-number").value.trim().toUpperCase();
    const phone = normalizePhone(document.querySelector("#lookup-phone").value);
    lookupButton.disabled = true;
    lookupStatus.textContent = "正在查詢訂單...";
    orderResult.hidden = true;
    verifiedOrder = null;

    try {
        const phoneHash = await hashText(phone);
        const result = await queryOrder(orderNumber, phoneHash);

        if (!result.ok || !result.found) {
            lookupStatus.textContent = "查無符合資料，請確認訂單編號與手機號碼。";
            return;
        }

        verifiedOrder = { orderNumber, phone };
        renderOrderResult(result.order);
        lookupStatus.textContent = "已找到訂單。";
    } catch (error) {
        console.error(error);
        lookupStatus.textContent = "目前無法查詢，請稍後再試。";
    } finally {
        lookupButton.disabled = false;
    }
});

paymentMethod.addEventListener("change", updatePaymentFields);

paymentReportForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!verifiedOrder || !paymentReportForm.reportValidity()) return;

    paymentReportButton.disabled = true;
    paymentReportStatus.textContent = "正在送出付款資訊...";

    const reference = paymentMethod.value === "LINE Pay Money"
        ? `付款人：${linePayName.value.trim()}`
        : `轉出帳號後五碼：${bankLastFive.value}`;

    try {
        await fetch(ORDER_SERVICE_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
                action: "reportPayment",
                orderNumber: verifiedOrder.orderNumber,
                customerPhone: verifiedOrder.phone,
                paymentMethod: paymentMethod.value,
                paymentReference: reference
            })
        });

        paymentReportForm.reset();
        updatePaymentFields();
        paymentReportStatus.textContent = "付款資訊已送出，等待店家確認。";
        document.querySelector("#result-payment-status").textContent = "已回報待確認";
    } catch (error) {
        console.error(error);
        paymentReportStatus.textContent = "付款資訊未能送出，請稍後再試。";
    } finally {
        paymentReportButton.disabled = false;
    }
});

function renderOrderResult(order) {
    document.querySelector("#result-payment-status").textContent = order.paymentStatus || "尚未付款";
    document.querySelector("#result-shipping-status").textContent = order.shippingStatus || "處理中";
    document.querySelector("#result-ship-date").textContent = formatDisplayDate(order.shipDate);
    document.querySelector("#result-tracking-number").textContent = order.trackingNumber || "尚未提供";
    paymentReportForm.hidden = !["尚未付款", "未選擇", ""].includes(order.paymentStatus || "");
    paymentReportStatus.textContent = "";
    orderResult.hidden = false;
}

function updatePaymentFields() {
    const isBank = ["中華郵政轉帳", "玉山銀行轉帳"].includes(paymentMethod.value);
    const isLinePay = paymentMethod.value === "LINE Pay Money";

    bankReferenceField.hidden = !isBank;
    bankLastFive.required = isBank;
    bankLastFive.disabled = !isBank;
    linePayReferenceField.hidden = !isLinePay;
    linePayName.required = isLinePay;
    linePayName.disabled = !isLinePay;
}

function queryOrder(orderNumber, phoneHash) {
    return new Promise((resolve, reject) => {
        const callbackName = `iceblueOrderLookup_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        const script = document.createElement("script");
        const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error("查詢逾時"));
        }, 12000);

        const cleanup = () => {
            window.clearTimeout(timeout);
            script.remove();
            delete window[callbackName];
        };

        window[callbackName] = (result) => {
            cleanup();
            resolve(result);
        };
        script.onerror = () => {
            cleanup();
            reject(new Error("查詢服務連線失敗"));
        };
        script.src = `${ORDER_SERVICE_URL}?action=queryOrder&orderNumber=${encodeURIComponent(orderNumber)}&phoneHash=${encodeURIComponent(phoneHash)}&callback=${encodeURIComponent(callbackName)}`;
        document.head.append(script);
    });
}

async function hashText(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizePhone(value) {
    return value.replace(/\D/g, "");
}

function formatDisplayDate(value) {
    if (!value) return "尚未提供";
    const parts = String(value).slice(0, 10).split("-");
    return parts.length === 3 ? `${parts[0]}/${Number(parts[1])}/${Number(parts[2])}` : value;
}

updatePaymentFields();
