/**
 * ==================== СКРИПТ ДЛЯ ЛЕНДИНГУ E-BIKE ====================
 * 
 * Функції:
 * - Плавний скрол
 * - Валідація форми
 * - Динамічний розрахунок ціни
 * - Відправка замовлень на сервер
 * - Toast сповіщення
 * - Анімація лічильників
 */

// ==================== КОНФІГУРАЦІЯ ====================

const API_BASE_URL = '/api';

// ==================== ОБ'ЄКТИ ТА ЗМІННІ ====================

const elements = {
    // Кнопки навігації
    headerBookBtn: document.getElementById('headerBookBtn'),
    mainBookBtn: document.getElementById('mainBookBtn'),
    learnMoreBtn: document.getElementById('learnMoreBtn'),
    
    // Форма
    bookingForm: document.getElementById('bookingForm'),
    bookingSection: document.getElementById('booking'),
    
    // Поля форми
    nameInput: document.getElementById('name'),
    emailInput: document.getElementById('email'),
    phoneInput: document.getElementById('phone'),
    bikeModelInput: document.getElementById('bikeModel'),
    dateInput: document.getElementById('date'),
    durationInput: document.getElementById('duration'),
    priceDisplay: document.getElementById('priceDisplay'),

    // Галерея велосипедів
    galleryItems: document.querySelectorAll('.gallery-item'),
};

// ==================== ВИБІР МОДЕЛІ ВЕЛОСИПЕДА ====================

/**
 * Обрати велосипед: підставити в форму і підсвітити картку в галереї
 */
function selectBike(bikeId, bikeName) {
    if (elements.bikeModelInput) {
        elements.bikeModelInput.value = `${bikeId}|${bikeName}`;
    }
    highlightSelectedBikeCard(bikeId);
    smoothScroll('#booking');
}

/**
 * Підсвітити обрану картку в галереї, знявши підсвітку з інших
 */
function highlightSelectedBikeCard(bikeId) {
    elements.galleryItems.forEach(item => {
        if (item.dataset.bikeId === String(bikeId)) {
            item.classList.add('gallery-item--selected');
        } else {
            item.classList.remove('gallery-item--selected');
        }
    });
}

// ==================== ДОПОМІЖНІ ФУНКЦІЇ ====================

/**
 * Плавний скрол до елемента
 */
function smoothScroll(targetSelector) {
    const target = document.querySelector(targetSelector);
    if (target) {
        target.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }
}

/**
 * Валідація email адреси
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Валідація номера телефону
 */
function isValidPhone(phone) {
    const digitsOnly = phone.replace(/\D/g, '');
    return digitsOnly.length >= 9;
}

/**
 * Валідація дати (не в минулому)
 */
function isValidDate(dateString) {
    const selectedDate = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return selectedDate >= today;
}

/**
 * Показати гарне сповіщення (Toast)
 */
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? '#00ff88' : '#ff006e';
    const textColor = type === 'success' ? '#0f0f0f' : '#fff';
    
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${bgColor};
        color: ${textColor};
        padding: 16px 24px;
        border-radius: 12px;
        font-weight: bold;
        z-index: 1000;
        animation: slideUp 0.3s ease-out;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        font-size: 14px;
        max-width: 300px;
    `;
    
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideDown 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showErrorMessage(message) {
    showToast('❌ ' + message, 'error');
}

function showSuccessMessage(message) {
    showToast('✅ ' + message, 'success');
}

function clearForm() {
    elements.bookingForm.reset();
    elements.priceDisplay.innerHTML = '';
    highlightSelectedBikeCard(null);
}

function disableSubmitButton() {
    const submitBtn = elements.bookingForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Відправка...';
}

function enableSubmitButton() {
    const submitBtn = elements.bookingForm.querySelector('button[type="submit"]');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Забронювати E-Bike';
}

// ==================== ВАЛІДАЦІЯ ФОРМИ ====================

function validateForm() {
    const name = elements.nameInput.value.trim();
    const email = elements.emailInput.value.trim();
    const phone = elements.phoneInput.value.trim();
    const date = elements.dateInput.value;
    const duration = elements.durationInput.value;
    
    if (name.length < 2) {
        showErrorMessage('Будь ласка, введи коректне ім\u2019я (мінімум 2 символи)');
        elements.nameInput.focus();
        return false;
    }
    
    if (!isValidEmail(email)) {
        showErrorMessage('Будь ласка, введи коректну email адресу');
        elements.emailInput.focus();
        return false;
    }
    
    if (!isValidPhone(phone)) {
        showErrorMessage('Будь ласка, введи коректний номер телефону');
        elements.phoneInput.focus();
        return false;
    }
    
    if (!elements.bikeModelInput.value) {
        showErrorMessage('Будь ласка, обери модель велосипеда');
        elements.bikeModelInput.focus();
        return false;
    }
    
    if (!date) {
        showErrorMessage('Будь ласка, обери дату бронювання');
        elements.dateInput.focus();
        return false;
    }
    
    if (!isValidDate(date)) {
        showErrorMessage('Дата не може бути в минулому');
        elements.dateInput.focus();
        return false;
    }
    
    if (!duration) {
        showErrorMessage('Будь ласка, обери тривалість бронювання');
        elements.durationInput.focus();
        return false;
    }
    
    return true;
}

// ==================== ЗБІР ДАНИХ З ФОРМИ ====================

function getFormData() {
    const duration = parseInt(elements.durationInput.value);
    const totalPrice = duration * 50;
    const [bikeId, bikeName] = elements.bikeModelInput.value.split('|');
    
    return {
        clientName: elements.nameInput.value.trim(),
        clientEmail: elements.emailInput.value.trim(),
        clientPhone: elements.phoneInput.value.trim(),
        bikeId: parseInt(bikeId),
        bikeName: bikeName,
        rentalDate: elements.dateInput.value,
        duration: duration,
        totalPrice: totalPrice
    };
}

// ==================== ВІДПРАВКА НА СЕРВЕР ====================

/**
 * Перевірити стан сервера
 */
async function checkServerHealth() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        const data = await response.json();
        return data.status === 'ok';
    } catch (error) {
        console.error('⚠️ Сервер недоступний:', error);
        return false;
    }
}

// ==================== РОЗРАХУНОК ЦІНИ ====================

function calculateTotalPrice(hours) {
    return hours * 50;
}

function calculateAndDisplayPrice() {
    const hours = elements.durationInput.value;
    
    if (!hours) {
        elements.priceDisplay.innerHTML = '';
        return;
    }
    
    const totalPrice = calculateTotalPrice(hours);
    elements.priceDisplay.textContent = `💰 Підсумкова ціна: ${totalPrice} ₴`;
    elements.priceDisplay.style.display = 'block';

    highlightSelectedPricingCard(hours);
}

/**
 * Підсвічує картку тарифу, яка відповідає реально вибраній тривалості,
 * а не завжди картку "Популярно".
 */
function highlightSelectedPricingCard(hours) {
    document.querySelectorAll('.pricing-card').forEach((card) => {
        card.classList.remove('pricing-card--selected');
    });

    const activeBtn = document.querySelector(
        `.pricing-card__btn[data-hours="${hours}"]`
    );
    if (activeBtn) {
        activeBtn.closest('.pricing-card')?.classList.add('pricing-card--selected');
    }
}

// ==================== ОБРОБКА ФОРМИ ====================

/**
 * Обробник відправки форми
 */
/**
 * Обробник відправки форми
 */
async function handleFormSubmit(event) {
    event.preventDefault();
    
    if (!validateForm()) {
        return;
    }
    
    // Проверяем сервер
    const serverOk = await checkServerHealth();
    if (!serverOk) {
        showErrorMessage('Сервер недоступний. Спробуй оновити сторінку або звернись до підтримки.');
        return;
    }
    
    const formData = getFormData();
    disableSubmitButton();
    showToast('⏳ Обробка замовлення...', 'loading');
    
    try {
        // Одразу відкриваємо PayPal - запис у БД з\u2019явиться тільки після оплати
        await openPayPalPayment(formData);
        clearForm();
    } catch (error) {
        console.error('❌ Помилка:', error);
        showErrorMessage(`Не вдалося створити платіж: ${error.message}`);
    } finally {
        enableSubmitButton();
    }
}

/**
 * Відкрити платіжну форму PayPal
 */
async function openPayPalPayment(formData) {
    try {
        console.log('💳 Створюємо платіж PayPal...');

        const token = localStorage.getItem('authToken');
        console.log(token ? '👤 Оплата з токеном авторизації (бронь прив\u2019яжеться до акаунта)' : '👤 Оплата БЕЗ токена - ти не залогінений, бронь буде гостьовою');
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${API_BASE_URL}/payment/paypal/create`, {
            method: 'POST',
            headers,
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (data.success && data.approvalUrl) {
            console.log('🔗 Перенаправляємо на PayPal...');
            // Відкриваємо сторінку підтвердження PayPal
            window.location.href = data.approvalUrl;
        } else {
            showErrorMessage('Помилка створення платежу: ' + (data.error || 'Невідома помилка'));
        }

    } catch (error) {
        console.error('❌ Помилка PayPal:', error);
        showErrorMessage('Не вдалося створити платіж');
    }
}

// ==================== ОБРОБНИКИ ПОДІЙ ====================

function initEventListeners() {
    // Кнопка "Забронювати" в шапці
    if (elements.headerBookBtn) {
        elements.headerBookBtn.addEventListener('click', () => {
            smoothScroll('#booking');
        });
    }
    
    // Кнопка "Забронювати" в hero
    if (elements.mainBookBtn) {
        elements.mainBookBtn.addEventListener('click', () => {
            smoothScroll('#booking');
        });
    }
    
    // Кнопка "Дізнатися більше"
    if (elements.learnMoreBtn) {
        elements.learnMoreBtn.addEventListener('click', () => {
            smoothScroll('#benefits');
        });
    }
    
    // Відправка форми
    if (elements.bookingForm) {
        elements.bookingForm.addEventListener('submit', handleFormSubmit);
    }
    
    // Динамічний розрахунок ціни
    if (elements.durationInput) {
        elements.durationInput.addEventListener('change', calculateAndDisplayPrice);
    }
    
    // Кнопки на картках цін
    document.querySelectorAll('.pricing-card__btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const hours = e.target.dataset.hours;
            elements.durationInput.value = hours;
            calculateAndDisplayPrice();
            smoothScroll('#booking');
        });
    });
    
    // Вибір моделі велосипеда кліком по картці в галереї
    elements.galleryItems.forEach(item => {
        item.addEventListener('click', () => {
            const bikeId = item.dataset.bikeId;
            const bikeName = item.dataset.bikeName;
            if (bikeId && bikeName) {
                selectBike(bikeId, bikeName);
            }
        });
    });

    // Вибір моделі велосипеда через випадаючий список у формі
    if (elements.bikeModelInput) {
        elements.bikeModelInput.addEventListener('change', () => {
            const [bikeId] = elements.bikeModelInput.value.split('|');
            highlightSelectedBikeCard(bikeId);
        });
    }

    // Валідація email
    if (elements.emailInput) {
        elements.emailInput.addEventListener('blur', () => {
            if (elements.emailInput.value && !isValidEmail(elements.emailInput.value)) {
                elements.emailInput.style.borderColor = '#ff006e';
            } else {
                elements.emailInput.style.borderColor = '';
            }
        });
    }
    
    // Валідація телефону
    if (elements.phoneInput) {
        elements.phoneInput.addEventListener('blur', () => {
            if (elements.phoneInput.value && !isValidPhone(elements.phoneInput.value)) {
                elements.phoneInput.style.borderColor = '#ff006e';
            } else {
                elements.phoneInput.style.borderColor = '';
            }
        });
    }
    
    // Валідація дати
    if (elements.dateInput) {
        elements.dateInput.addEventListener('change', () => {
            if (elements.dateInput.value && !isValidDate(elements.dateInput.value)) {
                elements.dateInput.style.borderColor = '#ff006e';
            } else {
                elements.dateInput.style.borderColor = '';
            }
        });
    }
}

// ==================== ВСТАНОВЛЕННЯ МІНІМАЛЬНОЇ ДАТИ ====================

function setMinDateToday() {
    if (elements.dateInput) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const minDate = `${year}-${month}-${day}`;
        elements.dateInput.min = minDate;
    }
}

// ==================== АНІМАЦІЯ ЛІЧИЛЬНИКІВ ====================

function animateCounters() {
    const counters = document.querySelectorAll('[data-count]');
    let isAnimated = false;
    
    window.addEventListener('scroll', () => {
        const statsSection = document.querySelector('.stats');
        if (!statsSection) return;
        
        const rect = statsSection.getBoundingClientRect();
        
        if (rect.top < window.innerHeight && !isAnimated) {
            isAnimated = true;
            
            counters.forEach(counter => {
                const target = parseFloat(counter.dataset.count);
                const increment = target / 50;
                let current = 0;
                
                const updateCounter = () => {
                    current += increment;
                    if (current < target) {
                        if (target % 1 === 0) {
                            counter.textContent = Math.floor(current);
                        } else {
                            counter.textContent = current.toFixed(1);
                        }
                        requestAnimationFrame(updateCounter);
                    } else {
                        counter.textContent = target;
                    }
                };
                
                updateCounter();
            });
        }
    });
}

// ==================== ЕФЕКТИ СКРОЛУ ====================

function handleScrollEffects() {
    const benefitCards = document.querySelectorAll('.benefit-card');
    
    window.addEventListener('scroll', () => {
        benefitCards.forEach(card => {
            const rect = card.getBoundingClientRect();
            const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
            
            if (isVisible) {
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            }
        });
    });
}

// ==================== ІНІЦІАЛІЗАЦІЯ ====================

/**
 * Якщо користувач залогінений - підставляємо його ім\u2019я/email/телефон у форму
 * бронювання і блокуємо поле телефону від редагування, щоб бронь
 * гарантовано прив\u2019язувалася до його профілю ("Мої поїздки" шукає замовлення
 * саме за цим телефоном).
 */
async function prefillLoggedInUser() {
    const token = localStorage.getItem('authToken');
    if (!token) return;

    try {
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();

        if (data.success && data.data) {
            if (elements.nameInput) elements.nameInput.value = data.data.name || '';
            if (elements.emailInput) elements.emailInput.value = data.data.email || '';
            if (elements.phoneInput) {
                elements.phoneInput.value = data.data.phone || '';
                elements.phoneInput.readOnly = true;
                elements.phoneInput.title = 'Телефон підставлений з твого профілю';
            }
        }
    } catch (error) {
        console.warn('Не вдалося підставити дані профілю:', error.message);
    }
}

async function init() {
    console.log('%c⚡ E-Bike Rentals завантажується...', 'font-size: 18px; color: #00ff88; font-weight: bold;');
    
    // Ініціалізуємо обробники подій
    initEventListeners();
    
    // Встановлюємо мінімальну дату
    setMinDateToday();
    
    // Додаємо ефекти скролу
    handleScrollEffects();
    
    // Додаємо анімацію лічильників
    animateCounters();
    
    // Якщо людина залогінена - підставляємо її дані у форму бронювання,
    // щоб телефон/ім\u2019я/пошта не відрізнялися від акаунта (інакше бронь потім
    // не знаходиться в "Моїх поїздках")
    await prefillLoggedInUser();
    
    // Проверяем подключение к серверу
    console.log('🔍 Перевіряємо підключення до сервера...');
    const serverOk = await checkServerHealth();
    
    if (serverOk) {
        console.log('%c✅ Підключення до сервера встановлено', 'color: #00ff88; font-weight: bold;');
    } else {
        console.warn('%c⚠️ Сервер недоступний', 'color: #ffea00; font-weight: bold;');
        showToast('⚠️ Сервер недоступний. Спробуй оновити сторінку.', 'error');
    }
    
    console.log('%c✅ Лендинг готовий!', 'font-size: 16px; color: #00ff88; font-weight: bold;');
}

// Запускаємо ініціалізацію
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ==================== КОНСОЛЬ ====================

console.log('%c🚴‍♂️ E-Bike Rentals - Лендинг з бекендом', 'font-size: 20px; color: #00ff88; font-weight: bold;');
console.log('%cAPI Base URL: ' + API_BASE_URL, 'color: #ffea00; font-weight: bold;');
console.log('%cДоступні команди в консолі:', 'color: #ffea00; font-weight: bold;');
console.log('%ccheckServerHealth() - перевірити сервер', 'color: #ffd700;');
console.log('%csubmitOrderToServer(data) - відправити замовлення', 'color: #ffd700;');