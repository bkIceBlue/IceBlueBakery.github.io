const SHIPPING_FEE = 90;
const FREE_SHIPPING_THRESHOLD = 6000;
const CART_STORAGE_KEY = "iceblue-cart";

const cart = new Map();
let selectedProduct = null;

const modal = document.querySelector("#quantity-modal");
const modalTitle = document.querySelector("#modal-title");
const modalPrice = document.querySelector("#modal-price");
const quantityInput = document.querySelector("#quantity-input");
const confirmAddButton = document.querySelector("#confirm-add");
const variantOptions = document.querySelector("#variant-options");
const variantInputs = document.querySelectorAll('input[name="productVariant"]');
const mixOptions = document.querySelector("#mix-options");
const mixMessage = document.querySelector("#mix-message");
const mixPreset = document.querySelector("#mix-preset");
const mixChoiceInputs = document.querySelectorAll('input[name="mixOption"]');
const cartPanel = document.querySelector(".cart-panel");
const cartItems = document.querySelector("#cart-items");
const cartCount = document.querySelector("#cart-count");
const subtotalText = document.querySelector("#subtotal");
const shippingText = document.querySelector("#shipping");
const totalText = document.querySelector("#total");
const freeShippingNote = document.querySelector("#free-shipping-note");
const checkoutButton = document.querySelector("#checkout-button");

const money = new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0
});

initializeCarousels();

document.querySelectorAll(".add-cart-btn").forEach((button) => {
    button.addEventListener("click", () => {
        selectedProduct = {
            name: button.dataset.name,
            price: Number(button.dataset.price),
            unit: button.dataset.unit,
            variantType: button.dataset.variants || "",
            isMix: button.dataset.mix === "true"
        };

        quantityInput.value = 1;
        resetVariantOptions();
        resetMixOptions();
        variantOptions.hidden = selectedProduct.variantType !== "3q";
        mixOptions.hidden = !selectedProduct.isMix;
        updateSelectedProductDisplay();
        updateMixMessage();
        modal.hidden = false;
        quantityInput.focus();
        quantityInput.select();
    });
});

document.querySelectorAll("[data-close-modal]").forEach((element) => {
    element.addEventListener("click", closeModal);
});

document.querySelector("#decrease-qty").addEventListener("click", () => {
    quantityInput.value = Math.max(1, getQuantity() - 1);
});

document.querySelector("#increase-qty").addEventListener("click", () => {
    quantityInput.value = getQuantity() + 1;
});

quantityInput.addEventListener("input", () => {
    quantityInput.value = Math.max(1, getQuantity());
});

variantInputs.forEach((input) => {
    input.addEventListener("change", updateSelectedProductDisplay);
});

mixPreset.addEventListener("change", () => {
    if (mixPreset.checked) {
        mixChoiceInputs.forEach((input) => {
            input.checked = false;
            input.disabled = true;
        });
    } else {
        mixChoiceInputs.forEach((input) => {
            input.disabled = false;
        });
    }

    updateMixMessage();
});

mixChoiceInputs.forEach((input) => {
    input.addEventListener("change", () => {
        const checkedChoices = getSelectedMixChoices();

        if (checkedChoices.length > 2) {
            input.checked = false;
        }

        mixPreset.checked = false;
        updateMixMessage();
    });
});

confirmAddButton.addEventListener("click", () => {
    if (!selectedProduct) return;

    const productToAdd = getProductToAdd();

    if (!productToAdd) return;

    const currentItem = cart.get(productToAdd.name) || {
        ...productToAdd,
        quantity: 0
    };

    currentItem.quantity += getQuantity();
    cart.set(productToAdd.name, currentItem);
    saveCart();
    cartPanel.classList.remove("collapsed");
    closeModal();
    renderCart();
});

document.querySelector(".cart-tab").addEventListener("click", () => {
    cartPanel.classList.toggle("collapsed");
});

checkoutButton.addEventListener("click", () => {
    if (cart.size === 0) {
        cartPanel.classList.remove("collapsed");
        return;
    }

    saveCart();
    window.location.href = "checkout.html";
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
        closeModal();
    }
});

loadCart();
cartPanel.classList.add("collapsed");
renderCart();

function getQuantity() {
    const quantity = Number.parseInt(quantityInput.value, 10);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function initializeCarousels() {
    document.querySelectorAll("[data-carousel]").forEach((carousel) => {
        const track = carousel.querySelector(".carousel-track");
        const images = [...track.querySelectorAll("img")];
        const dots = [...carousel.querySelectorAll(".carousel-dots button")];
        let currentIndex = 0;
        let timer = null;

        const showImage = (index) => {
            if (images.length < 2) return;

            currentIndex = (index + images.length) % images.length;
            track.scrollTo({
                left: track.clientWidth * currentIndex,
                behavior: "smooth"
            });
            dots.forEach((dot, dotIndex) => {
                dot.classList.toggle("active", dotIndex === currentIndex);
            });
        };

        const startTimer = () => {
            window.clearInterval(timer);
            timer = window.setInterval(() => showImage(currentIndex + 1), 5000);
        };

        dots.forEach((dot, index) => {
            dot.addEventListener("click", () => {
                showImage(index);
                startTimer();
            });
        });

        track.addEventListener("scroll", () => {
            if (!track.clientWidth) return;

            currentIndex = Math.round(track.scrollLeft / track.clientWidth);
            dots.forEach((dot, dotIndex) => {
                dot.classList.toggle("active", dotIndex === currentIndex);
            });
        }, { passive: true });

        images.forEach((image, index) => {
            image.addEventListener("error", () => {
                image.remove();
                dots[index]?.remove();
                if (track.querySelectorAll("img").length < 2) {
                    carousel.querySelector(".carousel-dots").hidden = true;
                    window.clearInterval(timer);
                }
            }, { once: true });
        });

        carousel.addEventListener("mouseenter", () => window.clearInterval(timer));
        carousel.addEventListener("mouseleave", startTimer);
        carousel.addEventListener("touchstart", () => window.clearInterval(timer), { passive: true });
        carousel.addEventListener("touchend", startTimer, { passive: true });
        startTimer();
    });
}

function closeModal() {
    modal.hidden = true;
    selectedProduct = null;
    resetVariantOptions();
    resetMixOptions();
}

function resetVariantOptions() {
    variantOptions.hidden = true;
    variantInputs.forEach((input) => {
        input.checked = input.value === "box";
    });
}

function getSelectedVariantProduct() {
    if (!selectedProduct || selectedProduct.variantType !== "3q") {
        return selectedProduct;
    }

    const variant = document.querySelector('input[name="productVariant"]:checked')?.value;

    if (variant === "single") {
        return {
            ...selectedProduct,
            name: "3Q餅單入",
            price: 85,
            unit: "單顆"
        };
    }

    return {
        ...selectedProduct,
        name: "3Q餅",
        price: 400,
        unit: "5入一盒"
    };
}

function updateSelectedProductDisplay() {
    const product = getSelectedVariantProduct();

    if (!product) return;

    modalTitle.textContent = product.name;
    modalPrice.textContent = `${money.format(product.price)} / ${product.unit}`;
}

function resetMixOptions() {
    mixOptions.hidden = true;
    mixMessage.textContent = "";
    mixPreset.checked = false;
    mixChoiceInputs.forEach((input) => {
        input.checked = false;
        input.disabled = false;
    });
}

function getSelectedMixChoices() {
    return [...mixChoiceInputs]
        .filter((input) => input.checked)
        .map((input) => input.value);
}

function updateMixMessage() {
    if (!selectedProduct?.isMix) {
        mixMessage.textContent = "";
        return;
    }

    const choices = getSelectedMixChoices();

    if (mixPreset.checked) {
        mixMessage.textContent = "已選餅香4溢組。";
    } else if (choices.length === 0) {
        mixMessage.textContent = "請選兩組 4 入。";
    } else if (choices.length === 1) {
        mixMessage.textContent = "還需要再選一組 4 入。";
    } else {
        mixMessage.textContent = `已選：${choices.join(" + ")}`;
    }
}

function getProductToAdd() {
    const product = getSelectedVariantProduct();

    if (!selectedProduct.isMix) {
        return product;
    }

    if (mixPreset.checked) {
        return {
            ...product,
            name: `${product.name}（${mixPreset.value}）`
        };
    }

    const choices = getSelectedMixChoices();

    if (choices.length !== 2) {
        updateMixMessage();
        return null;
    }

    return {
        ...product,
        name: `${product.name}（${choices.join(" + ")}）`
    };
}

function renderCart() {
    const items = [...cart.values()];
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    cartCount.textContent = itemCount;
    checkoutButton.disabled = items.length === 0;
    subtotalText.textContent = money.format(subtotal);
    shippingText.textContent = "結帳時計算";
    totalText.textContent = money.format(subtotal);

    if (items.length === 0) {
        cartItems.className = "cart-items empty";
        cartItems.textContent = "尚未加入商品";
        freeShippingNote.textContent = "宅配運費於結帳選擇宅配時計算。";
        return;
    }

    cartItems.className = "cart-items";
    cartItems.innerHTML = "";

    items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "cart-item";
        const title = document.createElement("h3");
        const removeButton = document.createElement("button");
        const price = document.createElement("p");
        const controls = document.createElement("div");
        const decreaseButton = document.createElement("button");
        const quantity = document.createElement("span");
        const increaseButton = document.createElement("button");
        const itemTotal = document.createElement("strong");

        title.textContent = item.name;
        removeButton.className = "remove-item";
        removeButton.type = "button";
        removeButton.setAttribute("aria-label", `移除 ${item.name}`);
        removeButton.textContent = "x";
        price.textContent = `${money.format(item.price)} / ${item.unit || "份"}`;
        controls.className = "cart-item-controls";
        controls.setAttribute("aria-label", `${item.name}數量`);
        decreaseButton.className = "decrease-item";
        decreaseButton.type = "button";
        decreaseButton.setAttribute("aria-label", `減少 ${item.name} 數量`);
        decreaseButton.textContent = "-";
        quantity.textContent = item.quantity;
        increaseButton.className = "increase-item";
        increaseButton.type = "button";
        increaseButton.setAttribute("aria-label", `增加 ${item.name} 數量`);
        increaseButton.textContent = "+";
        itemTotal.className = "cart-item-total";
        itemTotal.textContent = money.format(item.price * item.quantity);
        controls.append(decreaseButton, quantity, increaseButton);
        row.append(title, removeButton, price, controls, itemTotal);

        row.querySelector(".remove-item").addEventListener("click", () => {
            cart.delete(item.name);
            saveCart();
            renderCart();
        });

        row.querySelector(".decrease-item").addEventListener("click", () => {
            item.quantity = Math.max(1, item.quantity - 1);
            cart.set(item.name, item);
            saveCart();
            renderCart();
        });

        row.querySelector(".increase-item").addEventListener("click", () => {
            item.quantity += 1;
            cart.set(item.name, item);
            saveCart();
            renderCart();
        });

        cartItems.append(row);
    });

    const remaining = FREE_SHIPPING_THRESHOLD - subtotal;
    freeShippingNote.textContent = remaining > 0
        ? `若選宅配，再買 ${money.format(remaining)} 即可免運`
        : "若選宅配，已達免運門檻";
}

function saveCart() {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([...cart.values()]));
}

function loadCart() {
    const savedCart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || "[]");

    savedCart.forEach((item) => {
        if (item.name && Number(item.price) > 0 && Number(item.quantity) > 0) {
            const normalizedName = item.name.replaceAll("綠豆椪", "清豆椪");
            cart.set(normalizedName, {
                name: normalizedName,
                price: Number(item.price),
                unit: item.unit || "",
                quantity: Number(item.quantity)
            });
        }
    });
}
