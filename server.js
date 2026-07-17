const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname));

// ==================== PAYPAL CONFIG ====================

// За замовчуванням - sandbox (безпечніше): якщо забути задати PAYPAL_MODE на
// сервері, краще випадково лишитися в тестовому режимі, ніж піти в live API.
const PAYPAL_API = process.env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

// ==================== MIDDLEWARE ====================

app.use(cors());

// Базовий URL сервера - потрібен для PayPal return_url/cancel_url.
// Локально це http://localhost:3000, на Render - через змінну оточення BASE_URL
// (наприклад https://your-app.onrender.com), інакше PayPal намагатиметься
// повернути користувача на localhost, якого на проді не існує.
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, ''))); 

app.use('/api/auth', authRoutes); 
app.use('/api/trips', tripsRoutes);

app.get('/payment-success.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'payment-success.html'));
});

// ==================== ПІДКЛЮЧЕННЯ ДО БД ====================

// ==================== ОБРОБКА ПРОСТРОЧЕНИХ БРОНЮВАНЬ ====================
// З новим флоу замовлення пишеться в orders тільки ПІСЛЯ оплати, тому нових
// неоплачених рядків у БД більше не з'являється. Але старі pending-замовлення,
// створені до цієї зміни, могли залишитися - ця функція їх підчищає:
//  - оплачені брoні з минулою датою -> orderStatus = 'completed' (поїздка відбулася)
//  - старі неоплачені брoні з минулою датою -> orderStatus = 'cancelled' (бронь згоріла)
// Нічого не видаляємо з БД - історія має залишатися (для "Моїх поїздок" і статистики).

function updateExpiredOrders() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    db.run(
        `UPDATE orders
         SET orderStatus = 'completed'
         WHERE paymentStatus = 'paid'
           AND orderStatus != 'completed'
           AND date(rentalDate) < date(?)`,
        [today],
        function (err) {
            if (err) {
                console.error('❌ Помилка оновлення завершених поїздок:', err.message);
            } else if (this.changes > 0) {
                console.log(`✅ Поїздок позначено завершеними: ${this.changes}`);
            }
        }
    );

    db.run(
        `UPDATE orders
         SET orderStatus = 'cancelled'
         WHERE paymentStatus != 'paid'
           AND orderStatus NOT IN ('cancelled', 'completed')
           AND date(rentalDate) < date(?)`,
        [today],
        function (err) {
            if (err) {
                console.error('❌ Помилка скасування прострочених брoней:', err.message);
            } else if (this.changes > 0) {
                console.log(`🚫 Прострочених неоплачених брoней скасовано: ${this.changes}`);
            }
        }
    );
}

const DB_PATH = process.env.DATABASE || './database.sqlite';

console.log('📂 Відкриваю базу даних за абсолютним шляхом:', path.resolve(DB_PATH));
console.log('📂 Поточна робоча папка процесу (cwd):', process.cwd());
console.log('📂 Папка, де лежить server.js (__dirname):', __dirname);

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Помилка підключення:', err.message);
    } else {
        console.log('✅ Успішно підключено до бази даних SQLite.');
        initializeTables();

        // Одразу перевіряємо, що реально видно в цій базі при старті
        setTimeout(() => {
            db.get('SELECT COUNT(*) as cnt FROM orders', (e, row) => {
                if (e) console.error('❌ Не вдалося порахувати orders:', e.message);
                else console.log(`📊 При старті сервера в таблиці orders: ${row.cnt} записів`);
            });
            db.get('SELECT COUNT(*) as cnt FROM users', (e, row) => {
                if (e) console.error('❌ Не вдалося порахувати users:', e.message);
                else console.log(`📊 При старті сервера в таблиці users: ${row.cnt} записів`);
            });
        }, 500);

        // Перевіряємо прострочені брoні одразу при старті і потім раз на годину
        setTimeout(updateExpiredOrders, 2000);
        setInterval(updateExpiredOrders, 60 * 60 * 1000);
    }
});

// ==================== ІНІЦІАЛІЗАЦІЯ ТАБЛИЦЬ ====================

function initializeTables() {
    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clientName TEXT NOT NULL,
        clientEmail TEXT NOT NULL,
        clientPhone TEXT NOT NULL,
        bikeId INTEGER DEFAULT 1,
        bikeName TEXT DEFAULT 'E-Bike Classic',
        rentalDate TEXT NOT NULL,
        duration INTEGER NOT NULL,
        totalPrice REAL NOT NULL,
        paymentStatus TEXT DEFAULT 'pending',
        orderStatus TEXT DEFAULT 'pending',
        paypalOrderId TEXT,
        userId INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error('Помилка створення таблиці orders:', err);
        else {
            console.log('✅ Таблиця orders готова');
            ensureOrdersColumns();
        }
    });

    db.run(`CREATE TABLE IF NOT EXISTS bikes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        maxSpeed INTEGER NOT NULL,
        range INTEGER NOT NULL,
        chargeTime REAL NOT NULL,
        maxWeight INTEGER,
        price REAL NOT NULL,
        available BOOLEAN DEFAULT 1
    )`, (err) => {
        if (err) console.error('Помилка створення таблиці bikes:', err);
        else {
            console.log('✅ Таблиця bikes готова');
            seedBikes();
        }
    });
}

// Якщо таблиця orders вже існувала (створена до появи paypalOrderId
// у схемі), CREATE TABLE IF NOT EXISTS її не змінить - додаємо колонку вручну.
function ensureOrdersColumns() {
    db.all('PRAGMA table_info(orders)', (err, columns) => {
        if (err) {
            console.error('❌ Не вдалося прочитати структуру таблиці orders:', err.message);
            return;
        }

        const hasPaypalOrderId = columns.some(col => col.name === 'paypalOrderId');
        const hasUserId = columns.some(col => col.name === 'userId');

        if (!hasPaypalOrderId) {
            db.run('ALTER TABLE orders ADD COLUMN paypalOrderId TEXT', (alterErr) => {
                if (alterErr) {
                    console.error('❌ Помилка додавання колонки paypalOrderId:', alterErr.message);
                } else {
                    console.log('✅ У таблицю orders додано колонку paypalOrderId');
                }
            });
        }

        if (!hasUserId) {
            db.run('ALTER TABLE orders ADD COLUMN userId INTEGER', (alterErr) => {
                if (alterErr) {
                    console.error('❌ Помилка додавання колонки userId:', alterErr.message);
                } else {
                    console.log('✅ У таблицю orders додано колонку userId');
                }
            });
        }
    });
}

// ==================== ДОДАВАННЯ ВЕЛОСИПЕДІВ ====================

function seedBikes() {
    db.all('SELECT COUNT(*) as count FROM bikes', (err, rows) => {
        if (rows && rows[0].count === 0) {
            const bikes = [
                { name: 'E-Bike Classic', type: 'standard', maxSpeed: 50, range: 100, chargeTime: 2.0, maxWeight: 100, price: 50 },
                { name: 'E-Bike Premium', type: 'premium', maxSpeed: 60, range: 150, chargeTime: 1.5, maxWeight: 120, price: 80 },
                { name: 'E-Bike Cargo', type: 'cargo', maxSpeed: 40, range: 120, chargeTime: 2.0, maxWeight: 150, price: 100 }
            ];

            bikes.forEach(bike => {
                db.run(
                    'INSERT INTO bikes (name, type, maxSpeed, range, chargeTime, maxWeight, price) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [bike.name, bike.type, bike.maxSpeed, bike.range, bike.chargeTime, bike.maxWeight, bike.price]
                );
            });
            console.log('✅ Велосипеди додано до БД');
        }
    });
}

// ==================== ТИМЧАСОВЕ СХОВИЩЕ НЕОПЛАЧЕНИХ БРОНЕЙ ====================
// Поки клієнт не оплатив через PayPal, бронь живе тільки в пам'яті сервера.
// У таблицю orders запис потрапляє ТІЛЬКИ після успішного capture — неоплачених
// замовлень у базі більше не з'являється.
const pendingBookings = new Map(); // key: paypalOrderId -> { clientName, clientEmail, clientPhone, bikeId, bikeName, rentalDate, duration, totalPrice }

// ==================== ФУНКЦІЇ PAYPAL ====================

/**
 * Отримати access token від PayPal
 */
async function getPayPalAccessToken() {
    try {
        const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64');
        
        const response = await axios.post(`${PAYPAL_API}/v1/oauth2/token`, 'grant_type=client_credentials', {
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        return response.data.access_token;
    } catch (error) {
        console.error('❌ Помилка отримання PayPal токена:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Створити замовлення в PayPal
 */
async function createPayPalOrder(totalPrice, description) {
    try {
        const accessToken = await getPayPalAccessToken();

        const response = await axios.post(`${PAYPAL_API}/v2/checkout/orders`, {
            intent: 'CAPTURE',
            purchase_units: [
    {
        description: description || "E-Bike Rental Payment", // Додали заглушку на випадок, якщо description порожній
        amount: {
            currency_code: 'EUR',
            value: (Number(totalPrice) / 40).toFixed(2) // Примусово приводимо до числа
        }
    }
],
            application_context: {
    brand_name: 'E-Bike Rentals', //
    return_url: `${BASE_URL}/payment-success.html`, // orderId ще не існує - замовлення створиться тільки після оплати
    cancel_url: `${BASE_URL}/payment-cancel.html`, //
    
    // --- ЗМІНИ ЦЕЙ РЯДОК З 'PAY' НА 'PAY_NOW' ---
    user_action: 'PAY_NOW'
}
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ PayPal замовлення створено:', response.data.id);
        return response.data;

    } catch (error) {
        console.error('❌ Помилка створення PayPal замовлення:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Захопити платіж у PayPal
 */
async function capturePayPalOrder(paypalOrderId) {
    try {
        const accessToken = await getPayPalAccessToken();

        const response = await axios.post(
            `${PAYPAL_API}/v2/checkout/orders/${paypalOrderId}/capture`,
            {},
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('✅ PayPal платіж захоплено:', response.data);
        return response.data;

    } catch (error) {
        console.error('❌ Помилка захоплення PayPal платежу:', error.response?.data || error.message);
        throw error;
    }
}

// ==================== API ENDPOINTS ====================

// 1. Перевірка сервера
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: '✅ Сервер працює',
        timestamp: new Date().toISOString()
    });
});

// 2. Отримати всі велосипеди
app.get('/api/bikes', (req, res) => {
    db.all('SELECT * FROM bikes', (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, data: rows, count: rows.length });
    });
});

// 3. Створити PayPal платіж (бронь поки зберігається тільки в пам'яті, не в БД)
app.post('/api/payment/paypal/create', optionalAuth, async (req, res) => {
    const { clientName, clientEmail, clientPhone, bikeId, bikeName, rentalDate, duration, totalPrice } = req.body;

    console.log('⚡ Запит на створення PayPal платежу:', { clientName, clientPhone, rentalDate, duration, totalPrice });
    console.log(req.userId ? `👤 Платіж прив'язаний до акаунта, userId: ${req.userId}` : '👤 Платіж БЕЗ авторизації (гість) - Authorization header не прийшов або токен невалідний');

    if (!clientName || !clientEmail || !clientPhone || !rentalDate || !duration || !totalPrice) {
        return res.status(400).json({
            success: false,
            error: 'Будь ласка, заповни всі обов\u2019язкові поля'
        });
    }

    try {
        // Створюємо PayPal замовлення
        const paypalOrder = await createPayPalOrder(
            totalPrice,
            `E-Bike Rental - ${bikeName || 'E-Bike Classic'} (${rentalDate})`
        );

        console.log('✅ Замовлення в PayPal успішно створено:', paypalOrder.id);

        // Зберігаємо дані брoні в пам'яті до підтвердження оплати
        pendingBookings.set(paypalOrder.id, {
            clientName,
            clientEmail,
            clientPhone,
            bikeId: bikeId || 1,
            bikeName: bikeName || 'E-Bike Classic',
            rentalDate,
            duration,
            totalPrice,
            userId: req.userId || null // якщо людина була залогінена в момент оплати
        });

        // Шукаємо посилання для підтвердження оплати (approve)
        const approvalUrl = paypalOrder.links.find(link => link.rel === 'approve')?.href;

        // Повертаємо успішну відповідь фронтенду
        return res.json({
            success: true,
            paypalOrderId: paypalOrder.id,
            approvalUrl: approvalUrl
        });

    } catch (paypalError) {
        console.error('❌ Помилка PayPal API:', paypalError.response?.data || paypalError.message);
        return res.status(500).json({ success: false, error: paypalError.message });
    }
});

// 4. Підтвердити PayPal платіж (запис у БД створюється тільки тут)
app.post('/api/payment/paypal/capture', async (req, res) => {
    try {
        const { paypalOrderId } = req.body;

        if (!paypalOrderId) {
            return res.status(400).json({ success: false, error: 'Не вистачає даних' });
        }

        const booking = pendingBookings.get(paypalOrderId);
        if (!booking) {
            return res.status(404).json({
                success: false,
                error: 'Брoнь не знайдена або вже була оброблена раніше'
            });
        }

        // Захоплюємо платіж у PayPal
        const captureResult = await capturePayPalOrder(paypalOrderId);

        // Перевіряємо статус
        if (captureResult.status === 'COMPLETED') {
            const sql = `INSERT INTO orders (clientName, clientEmail, clientPhone, bikeId, bikeName, rentalDate, duration, totalPrice, paymentStatus, paypalOrderId, userId)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?)`;
            const params = [
                booking.clientName, booking.clientEmail, booking.clientPhone,
                booking.bikeId, booking.bikeName, booking.rentalDate,
                booking.duration, booking.totalPrice, paypalOrderId, booking.userId
            ];

            db.run(sql, params, function (err) {
                if (err) {
                    console.error('❌ Помилка запису оплаченого замовлення в БД:', err.message);
                    return res.status(500).json({ success: false, error: err.message });
                }

                const orderId = this.lastID;
                pendingBookings.delete(paypalOrderId);

                console.log(`✅ Замовлення #${orderId} оплачене і записане в БД!`);
                console.log(booking.userId ? `   → прив'язане до userId: ${booking.userId}` : '   → БЕЗ userId (гостьове замовлення, пошук буде тільки за телефоном)');

                res.json({
                    success: true,
                    orderId: orderId,
                    message: `✅ Оплату успішно прийнято! Замовлення #${orderId} підтверджене.`
                });
            });
        } else {
            res.status(400).json({ 
                success: false, 
                error: 'Платіж не завершено'
            });
        }

    } catch (error) {
        console.error('❌ Помилка підтвердження PayPal:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 6. Отримати всі замовлення
app.get('/api/orders', (req, res) => {
    db.all('SELECT * FROM orders ORDER BY createdAt DESC', (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, data: rows, count: rows.length });
    });
});

// 7. Отримати замовлення за ID
app.get('/api/orders/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM orders WHERE id = ?', [id], (err, row) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        if (!row) {
            return res.status(404).json({ success: false, error: 'Замовлення не знайдене' });
        }
        res.json({ success: true, data: row });
    });
});

// 8. Оновити статус замовлення
app.put('/api/orders/:id/status', (req, res) => {
    const { id } = req.params;
    const { orderStatus } = req.body;

    if (!orderStatus) {
        return res.status(400).json({ success: false, error: 'Статус не вказано' });
    }

    db.run('UPDATE orders SET orderStatus = ? WHERE id = ?', [orderStatus, id], function (err) {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, message: `✅ Статус замовлення #${id} оновлено` });
    });
});

// 9. Отримати статистику
app.get('/api/stats', (req, res) => {
    db.get(`
        SELECT 
            COUNT(*) as totalOrders,
            SUM(totalPrice) as totalRevenue,
            COUNT(CASE WHEN paymentStatus = 'paid' THEN 1 END) as paidOrders,
            COUNT(CASE WHEN paymentStatus = 'pending' THEN 1 END) as pendingOrders,
            COUNT(CASE WHEN orderStatus = 'completed' THEN 1 END) as completedOrders
        FROM orders
    `, (err, row) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, data: row });
    });
});

// Отримати оплачені замовлення
app.get('/api/trips', (req, res) => {
    db.all(
        `SELECT * FROM orders WHERE paymentStatus = 'paid' ORDER BY createdAt DESC`,
        (err, rows) => {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({ success: true, data: rows, count: rows.length });
        }
    );
});

// ВАЖЛИВО: цей маршрут має стояти ДО '/api/trips/:phone', інакше Express
// сприйме "my" як параметр :phone і туди ніколи не дійде verifyToken.
app.get('/api/trips/my', verifyToken, (req, res) => {
    const normalizedUserPhone = normalizePhone(req.userPhone);
    console.log(`🔍 Запит "Мої поїздки": userId=${req.userId}, телефон акаунта=${req.userPhone} (нормалізовано: ${normalizedUserPhone})`);

    db.all(
        `SELECT * FROM orders
         WHERE (
            userId = ?
            OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(clientPhone, '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') = ?
         )
           AND paymentStatus = 'paid'
         ORDER BY createdAt DESC`,
        [req.userId, normalizedUserPhone],
        (err, rows) => {
            if (err) {
                console.error('❌ Помилка запиту "Мої поїздки":', err.message);
                return res.status(500).json({ success: false, error: err.message });
            }
            console.log(`   → знайдено замовлень: ${rows.length}`);
            res.json({ success: true, data: rows, count: rows.length });
        }
    );
});

// Отримати поїздки за номером телефону
app.get('/api/trips/:phone', (req, res) => {
    const { phone } = req.params;
    db.all(
        `SELECT * FROM orders WHERE clientPhone = ? AND paymentStatus = 'paid' ORDER BY createdAt DESC`,
        [phone],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({ success: true, data: rows, count: rows.length });
        }
    );
});

// ==================== АУТЕНТИФІКАЦІЯ ТА ЛОГІН ====================

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const SECRET_KEY = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Створити таблицю користувачів при старті
function createUsersTable() {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error('Помилка створення таблиці users:', err);
        else console.log('✅ Таблиця users готова');
    });
}

// Виклич при ініціалізації таблиць
createUsersTable();

// ==================== РЕЄСТРАЦІЯ ====================

app.post('/api/auth/register', (req, res) => {
    try {
        const { phone, password, name, email } = req.body;

        // Валідація
        if (!phone || !password || !name || !email) {
            return res.status(400).json({ 
                success: false, 
                error: 'Усі поля обов\u2019язкові' 
            });
        }

        if (password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                error: 'Пароль має бути мінімум 6 символів' 
            });
        }

        // Перевіряємо, що користувач не існує
        db.get('SELECT * FROM users WHERE phone = ?', [phone], async (err, user) => {
            if (user) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Користувач з таким номером вже існує' 
                });
            }

            // Хешуємо пароль перед збереженням - у БД ніколи не лежить plain text
            const passwordHash = await bcrypt.hash(password, 10);

            db.run(
                'INSERT INTO users (phone, password, name, email) VALUES (?, ?, ?, ?)',
                [phone, passwordHash, name, email],
                function(err) {
                    if (err) {
                        console.error('Помилка реєстрації:', err);
                        return res.status(500).json({ 
                            success: false, 
                            error: 'Помилка реєстрації' 
                        });
                    }

                    // Створюємо JWT токен
                    const token = jwt.sign(
                        { userId: this.lastID, phone: phone },
                        SECRET_KEY,
                        { expiresIn: '7d' }
                    );

                    res.json({
                        success: true,
                        message: 'Реєстрація успішна!',
                        token: token,
                        userId: this.lastID
                    });
                }
            );
        });

    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ==================== ЛОГІН ====================

app.post('/api/auth/login', (req, res) => {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Телефон і пароль обов\u2019язкові' 
            });
        }

        // Шукаємо користувача за телефоном, пароль звіряємо окремо через bcrypt
        db.get(
            'SELECT * FROM users WHERE phone = ?',
            [phone],
            async (err, user) => {
                if (!user) {
                    return res.status(401).json({ 
                        success: false, 
                        error: 'Неправильний телефон або пароль' 
                    });
                }

                const passwordMatches = await bcrypt.compare(password, user.password);
                if (!passwordMatches) {
                    return res.status(401).json({
                        success: false,
                        error: 'Неправильний телефон або пароль'
                    });
                }

                // Створюємо JWT токен
                const token = jwt.sign(
                    { userId: user.id, phone: user.phone },
                    SECRET_KEY,
                    { expiresIn: '7d' }
                );

                res.json({
                    success: true,
                    message: 'Успішний вхід!',
                    token: token,
                    userId: user.id,
                    userName: user.name
                });
            }
        );

    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ==================== ПЕРЕВІРКА ТОКЕНА ====================

function verifyToken(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ 
            success: false, 
            error: 'Токен не знайдено' 
        });
    }

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.userId = decoded.userId;
        req.userPhone = decoded.phone;
        next();
    } catch (error) {
        res.status(401).json({ 
            success: false, 
            error: 'Недійсний токен' 
        });
    }
}

// М'яка перевірка токена: якщо він є і валідний - підставляємо userId,
// але запит не відхиляємо навіть без токена (гостьова бронь залишається можливою).
function optionalAuth(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];

    if (token) {
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            req.userId = decoded.userId;
            req.userPhone = decoded.phone;
        } catch (error) {
            // Токен є, але невалідний - просто ігноруємо, бронь залишиться гостьовою
        }
    }

    next();
}

// ==================== ОТРИМАТИ ДАНІ КОРИСТУВАЧА ====================

app.get('/api/auth/me', verifyToken, (req, res) => {
    db.get(
        'SELECT id, phone, name, email FROM users WHERE id = ?',
        [req.userId],
        (err, user) => {
            if (!user) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Користувача не знайдено' 
                });
            }

            res.json({
                success: true,
                data: user
            });
        }
    );
});

// ==================== ЗАХИЩЕНИЙ ENDPOINT: МОЇ ПОЇЗДКИ ====================

// Порівнюємо телефони без урахування форматування (+, пробіли, тире, дужки),
// інакше "+380 50 965-9520" і "+380509659520" вважалися б різними номерами.
function normalizePhone(phone) {
    return (phone || '').replace(/[^\d]/g, '');
}

// ==================== ОБРОБКА ПОМИЛОК ====================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: '❌ Маршрут не знайдено',
        path: req.path
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================

app.listen(PORT, () => {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   ⚡ E-Bike Rentals Backend запущено   ║');
    console.log('╚════════════════════════════════════════╝\n');
    console.log(`🚀 Сервер працює на http://localhost:${PORT}`);
    console.log('\n📝 API endpoints:');
    console.log('   POST /api/payment/paypal/create - створити PayPal платіж');
    console.log('   POST /api/payment/paypal/capture - підтвердити платіж');
    console.log('   POST /api/orders - створити замовлення');
    console.log('   GET  /api/stats - статистика\n');
    
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_SECRET) {
        console.warn('⚠️ PayPal не налаштований - платежі не працюють');
        console.warn('Додай PAYPAL_CLIENT_ID і PAYPAL_SECRET у файл .env');
    }
});

// ==================== ЗАКРИТТЯ БД ====================

process.on('SIGINT', () => {
    console.log('\n\n📴 Закриваємо БД...');
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('БД закрита.');
        process.exit(0);
    });
});