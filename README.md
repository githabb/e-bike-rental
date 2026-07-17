# E-Bike Rental — деплой на Render (frontend + backend + БД в одному сервісі)

Це один Node.js/Express застосунок: він і роздає HTML/CSS/JS (frontend), і
обробляє `/api/*` запити (backend), і працює з SQLite (`database.sqlite`).
На Render усе це - **один Web Service**, окремо деплоїти фронт і бек не треба.

## Що не увійшло в архів і чому

- **`.env`** - там реальні секрети (PayPal ключі, JWT secret). Використовуй
  `.env.example` як шаблон і заповни своїми значеннями локально; на Render
  ці змінні задаються окремо в панелі (див. нижче).
- **`database.sqlite`** - це runtime-дані, а не вихідний код. При старті
  сервер сам створює всі потрібні таблиці (`initializeTables()` в `server.js`).

## Крок 1. Залий проєкт у GitHub

`.gitignore` вже налаштований так, щоб `.env` і `database.sqlite` туди не потрапили.

## Крок 2. Створи Web Service на Render

1. **New → Web Service** → підключи свій репозиторій.
2. **Settings → Build & Deploy → Environment**: обери **Docker** (не Node).
   `Dockerfile` лежить у корені - шлях вказувати не треба.
3. Поля Build/Start Command при Docker-режимі ігноруються - все вже в
   `Dockerfile` (`CMD ["node", "server.js"]`).

## Крок 3. Заповни Environment Variables

Додай (кнопкою **"Add from .env"** можна вставити список одразу):

```
DATABASE=./database.sqlite
PAYPAL_CLIENT_ID=...
PAYPAL_SECRET=...
PAYPAL_MODE=sandbox
JWT_SECRET=...
```

⚠️ **`PORT` не додавай** - Render сам підставляє свій через `process.env.PORT`,
код вже це враховує.

## Крок 4. Перший деплой і отримання адреси

Натисни **Create Web Service**, дочекайся `Deploy live`. Render видасть адресу
типу `https://e-bike-rental-xxxx.onrender.com`.

## Крок 5. Додай BASE_URL і передеплой

Це критичний крок саме для PayPal - без нього після оплати PayPal спробує
повернути користувача на `localhost`, якого на сервері не існує.

1. Скопіюй адресу з кроку 4.
2. Додай змінну `BASE_URL=https://e-bike-rental-xxxx.onrender.com` (без слеша в кінці).
3. Збережи - Render автоматично передеплоїть із новою змінною.

## Про збереження даних (SQLite)

На безкоштовному плані Render файлова система контейнера ефемерна: при
кожному редеплої/рестарті `database.sqlite` створюється заново пустим.
Якщо потрібно, щоб замовлення та користувачі не губилися:

1. **Settings → Disks** → додай Persistent Disk (доступно на платних планах),
   зроби точку монтування, наприклад `/usr/src/app/data`.
2. Онови змінну `DATABASE=/usr/src/app/data/database.sqlite`.

Без диска сайт повністю працюватиме, просто дані будуть скидатися при
кожному редеплої/сплячому режимі безкоштовного плану.

## Локальний запуск (для перевірки перед деплоєм)

```bash
npm install
cp .env.example .env   # і впиши свої ключі, BASE_URL можна лишити пустим
npm run dev
```

## Локальний запуск через Docker

```bash
docker build -t e-bike-rental .
docker run -p 3000:10000 --env-file .env -e PORT=10000 e-bike-rental
```

## Структура проєкту

- `server.js` - Express-бекенд: API, робота з SQLite, роздача статики
- `index.html`, `auth.html`, `profile.html`, `my-trips.html`,
  `admin-orders.html`, `payment-success.html`, `payment-cancel.html`,
  `script.js`, `style.css` - frontend
- `Dockerfile` - збірка образу для Render
- `.env.example` - шаблон змінних середовища (без реальних ключів)
