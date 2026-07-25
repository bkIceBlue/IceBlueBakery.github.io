const SHIPPING_FEE = 90;
const FREE_SHIPPING_THRESHOLD = 6000;
const CART_STORAGE_KEY = "iceblue-cart";
const EMAILJS_PUBLIC_KEY = "QNMA6YsC_S3mhgRw5";
const EMAILJS_SERVICE_ID = "service_y2uc2xq";
const SHOP_TEMPLATE_ID = "template_6sv6rmb";
const CUSTOMER_TEMPLATE_ID = "template_0gmy246";
const SHOP_EMAIL = "bk.iceblue@gmail.com";
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby-IJJhPh_FxLd8Gz2rfxS96J5-E0lvmeJaRdL1yaz4lDRGqaSIhoOd_ogfjT-m5AS1zg/exec";

const form = document.querySelector("#checkout-form");
const orderList = document.querySelector("#order-list");
const subtotalText = document.querySelector("#checkout-subtotal");
const shippingText = document.querySelector("#checkout-shipping");
const totalText = document.querySelector("#checkout-total");
const checkoutNote = document.querySelector("#checkout-note");
const statusText = document.querySelector("#form-status");
const pickupOtherRadio = document.querySelector("#pickup-other-radio");
const pickupOtherInput = document.querySelector("#pickup-other");
const customerAddressInput = document.querySelector("#customer-address");
const customerAddressLabel = document.querySelector("#customer-address-label");
const isPaidInput = document.querySelector("#is-paid");
const paymentMethodInput = document.querySelector("#payment-method");
const bankReportFields = document.querySelector("#bank-report-fields");
const bankLastFiveInput = document.querySelector("#bank-last-five");
const linePayReportFields = document.querySelector("#linepay-report-fields");
const linePayNameInput = document.querySelector("#linepay-name");
const submitButton = document.querySelector(".submit-button");
const shipDateInput = document.querySelector("#ship-date");

const SHIPPING_START_DATE = "2026-08-13";
const SHIPPING_END_DATE = "2026-09-24";
const UNAVAILABLE_SHIPPING_START = "2026-08-27";
const UNAVAILABLE_SHIPPING_END = "2026-09-01";

const money = new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0
});

let cart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || "[]");
let totals = getTotals(cart);

populateShippingDates();

if (window.emailjs) {
    emailjs.init({
        publicKey: EMAILJS_PUBLIC_KEY
    });
}

renderOrder();
updatePickupOtherState();
updatePaidState();

document.querySelectorAll('input[name="pickupMethod"]').forEach((radio) => {
    radio.addEventListener("change", () => {
        updatePickupOtherState();
        renderOrder();
    });
});

isPaidInput.addEventListener("change", updatePaidState);
paymentMethodInput.addEventListener("change", updatePaidState);

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (cart.length === 0) {
        statusText.textContent = "購物車是空的，請先回商品頁選購。";
        return;
    }

    updatePickupOtherState();
    updatePaidState();

    if (!form.reportValidity()) {
        statusText.textContent = "請確認必填欄位都已填寫。";
        return;
    }

    if (!window.emailjs) {
        statusText.textContent = "Email 服務尚未載入，請重新整理後再試一次。";
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "送出中...";
    statusText.textContent = "正在建立訂單編號，請稍候。";

    try {
        const orderNumber = await requestOrderNumber();
        const order = buildOrder(orderNumber);
        const params = buildEmailParams(order);

        statusText.textContent = `訂單 ${orderNumber} 送出中，請稍候。`;
        await emailjs.send(EMAILJS_SERVICE_ID, SHOP_TEMPLATE_ID, params);

        if (GOOGLE_SCRIPT_URL) {
            await saveOrderToGoogleSheet(order, params);
        }

        let customerMailNote = "客人未填 Email，所以只寄送店家通知信。";
        if (order.customerEmail) {
            try {
                await emailjs.send(EMAILJS_SERVICE_ID, CUSTOMER_TEMPLATE_ID, params);
                customerMailNote = "確認信也已寄給客人。";
            } catch (customerMailError) {
                console.error(customerMailError);
                customerMailNote = "訂單已成立，但客人確認信暫時未能寄出。";
            }
        }

        localStorage.removeItem(CART_STORAGE_KEY);
        cart = [];
        totals = getTotals(cart);
        renderOrder();
        form.reset();
        updatePickupOtherState();
        updatePaidState();
        const sheetNote = GOOGLE_SCRIPT_URL ? "訂單也已寫入統計表。" : "統計表尚未串接。";
        statusText.textContent = `訂單 ${orderNumber} 已送出。${customerMailNote}${sheetNote}`;
    } catch (error) {
        console.error(error);
        statusText.textContent = "訂單沒有成功送出。請確認 Google Apps Script 已更新部署，再稍後重試。";
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "送出訂單";
    }
});

function renderOrder() {
    if (cart.length === 0) {
        orderList.className = "order-message";
        orderList.textContent = "購物車是空的，請先回商品頁選購。";
    } else {
        orderList.className = "order-list";
        orderList.innerHTML = "";

        cart.forEach((item) => {
            const line = document.createElement("div");
            line.className = "order-line";
            line.innerHTML = `
                <strong>${item.name}</strong>
                <span>${money.format(item.price)} x ${item.quantity} = ${money.format(item.price * item.quantity)}</span>
            `;
            orderList.append(line);
        });
    }

    totals = getTotals(cart, getSelectedPickupMethod());
    subtotalText.textContent = money.format(totals.subtotal);
    shippingText.textContent = money.format(totals.shipping);
    totalText.textContent = money.format(totals.total);

    if (!getSelectedPickupMethod()) {
        checkoutNote.textContent = "請先選擇取貨方式，系統會自動計算運費。";
    } else if (getSelectedPickupMethod() !== "宅配") {
        checkoutNote.textContent = "自取與其他取貨方式不收運費。";
    } else if (totals.subtotal >= FREE_SHIPPING_THRESHOLD) {
        checkoutNote.textContent = "已達宅配免運門檻。";
    } else {
        checkoutNote.textContent = `宅配再買 ${money.format(FREE_SHIPPING_THRESHOLD - totals.subtotal)} 即可免運。`;
    }
}

function updatePickupOtherState() {
    const isOther = pickupOtherRadio.checked;
    const isDelivery = getSelectedPickupMethod() === "宅配";
    pickupOtherInput.disabled = !isOther;
    pickupOtherInput.required = isOther;
    customerAddressInput.required = isDelivery;
    customerAddressLabel.textContent = isDelivery ? "地址 *" : "地址";

    if (!isOther) {
        pickupOtherInput.value = "";
    }
}

function updatePaidState() {
    const isPaid = isPaidInput.checked;
    const isBankTransfer = isPaid && ["中華郵政轉帳", "玉山銀行轉帳"].includes(paymentMethodInput.value);
    const isLinePay = isPaid && paymentMethodInput.value === "LINE Pay Money";

    paymentMethodInput.disabled = !isPaid;
    paymentMethodInput.required = isPaid;
    bankReportFields.hidden = !isBankTransfer;
    bankLastFiveInput.disabled = !isBankTransfer;
    bankLastFiveInput.required = isBankTransfer;
    linePayReportFields.hidden = !isLinePay;
    linePayNameInput.disabled = !isLinePay;
    linePayNameInput.required = isLinePay;

    if (!isPaid) {
        paymentMethodInput.value = "";
    }

    if (!isBankTransfer) {
        bankLastFiveInput.value = "";
    }

    if (!isLinePay) {
        linePayNameInput.value = "";
    }
}

function getSelectedPickupMethod() {
    return document.querySelector('input[name="pickupMethod"]:checked')?.value || "";
}

function populateShippingDates() {
    const start = new Date(`${SHIPPING_START_DATE}T00:00:00`);
    const end = new Date(`${SHIPPING_END_DATE}T00:00:00`);

    for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
        const value = formatLocalDate(date);
        const option = document.createElement("option");
        const isUnavailable = value >= UNAVAILABLE_SHIPPING_START && value <= UNAVAILABLE_SHIPPING_END;

        option.value = value;
        option.textContent = `${date.getMonth() + 1}/${date.getDate()}${isUnavailable ? "（無法出貨）" : ""}`;
        option.disabled = isUnavailable;
        shipDateInput.append(option);
    }
}

function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getTotals(items, pickupMethod = "") {
    const subtotal = items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
    const shipping = pickupMethod === "宅配" && subtotal > 0 && subtotal < FREE_SHIPPING_THRESHOLD ? SHIPPING_FEE : 0;

    return {
        subtotal,
        shipping,
        total: subtotal + shipping
    };
}

async function saveOrderToGoogleSheet(order, params) {
    await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        mode: "no-cors",
        headers: {
            "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            customerPhone: order.customerPhone,
            customerEmail: order.customerEmail || "",
            customerAddress: order.customerAddress,
            pickupMethod: order.pickupMethod,
            shipDate: order.shipDate,
            isPaid: order.isPaid,
            paymentMethod: order.paymentMethod,
            paymentReference: order.paymentReference,
            bankLastFive: order.bankLastFive,
            orderNote: order.orderNote,
            itemsText: params.order_items,
            subtotal: params.subtotal,
            shipping: params.shipping,
            total: params.total,
            items: order.items
        })
    });
}

function requestOrderNumber() {
    return new Promise((resolve, reject) => {
        const callbackName = `iceblueOrderNumber_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        const script = document.createElement("script");
        const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error("取得訂單編號逾時"));
        }, 12000);

        const cleanup = () => {
            window.clearTimeout(timeout);
            script.remove();
            delete window[callbackName];
        };

        window[callbackName] = (result) => {
            cleanup();
            if (result?.ok && result.orderNumber) {
                resolve(result.orderNumber);
            } else {
                reject(new Error("無法取得訂單編號"));
            }
        };

        script.onerror = () => {
            cleanup();
            reject(new Error("訂單編號服務連線失敗"));
        };
        script.src = `${GOOGLE_SCRIPT_URL}?action=nextOrderNumber&callback=${encodeURIComponent(callbackName)}`;
        document.head.append(script);
    });
}

function buildOrder(orderNumber) {
    const data = new FormData(form);
    const pickupMethod = data.get("pickupMethod") === "其他"
        ? `其他：${data.get("pickupOther")}`
        : data.get("pickupMethod");
    totals = getTotals(cart, data.get("pickupMethod"));

    return {
        orderNumber,
        customerName: data.get("customerName"),
        customerPhone: data.get("customerPhone"),
        customerAddress: data.get("customerAddress") || "未填寫",
        customerEmail: data.get("customerEmail"),
        pickupMethod,
        shipDate: data.get("shipDate"),
        isPaid: data.get("isPaid") ? "已付款" : "尚未付款",
        paymentMethod: data.get("isPaid") ? data.get("paymentMethod") : "未選擇",
        paymentReference: getPaymentReference(data),
        bankLastFive: data.get("bankLastFive") || "未填寫",
        orderNote: data.get("orderNote") || "無",
        items: cart,
        totals
    };
}

function buildEmailParams(order) {
    return {
        shop_email: SHOP_EMAIL,
        order_number: order.orderNumber,
        customer_name: order.customerName,
        customer_phone: order.customerPhone,
        customer_email: order.customerEmail || "未填寫",
        customer_address: order.customerAddress,
        pickup_method: order.pickupMethod,
        ship_date: order.shipDate,
        paid_status: order.isPaid,
        payment_method: order.paymentMethod,
        payment_reference: order.paymentReference,
        bank_last_five: order.bankLastFive,
        order_note: order.orderNote,
        order_items: order.items.map((item) => (
            `${item.name}｜${money.format(item.price)} x ${item.quantity} = ${money.format(item.price * item.quantity)}`
        )).join("\n"),
        subtotal: money.format(order.totals.subtotal),
        shipping: money.format(order.totals.shipping),
        total: money.format(order.totals.total),
        order_text: formatOrder(order)
    };
}

function formatOrder(order) {
    const itemLines = order.items.map((item) => (
        `${item.name}｜${money.format(item.price)} x ${item.quantity} = ${money.format(item.price * item.quantity)}`
    )).join("\n");

    return [
        "冰藍烘焙實驗室訂單確認",
        "",
        `訂單編號：${order.orderNumber}`,
        `姓名：${order.customerName}`,
        `電話：${order.customerPhone}`,
        `地址：${order.customerAddress}`,
        `Email：${order.customerEmail || "未填寫"}`,
        `取貨方式：${order.pickupMethod}`,
        `出貨日期：${order.shipDate}`,
        `付款狀態：${order.isPaid}`,
        `付款方式：${order.paymentMethod}`,
        `付款核對資訊：${order.paymentReference}`,
        `備註：${order.orderNote}`,
        "",
        "訂購內容：",
        itemLines,
        "",
        `商品金額：${money.format(order.totals.subtotal)}`,
        `運費：${money.format(order.totals.shipping)}`,
        `合計：${money.format(order.totals.total)}`
    ].join("\n");
}

function getPaymentReference(data) {
    if (!data.get("isPaid")) {
        return "尚未付款";
    }

    if (data.get("paymentMethod") === "LINE Pay Money") {
        return `付款人：${data.get("linePayName")}`;
    }

    return `轉出帳號後五碼：${data.get("bankLastFive")}`;
}
