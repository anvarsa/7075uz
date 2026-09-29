# 7075.uz Telegram Bot MVP v1.0 — Setup Guide

**Haydovchi va yo'lovchi uchun taksi platformasi**

---

## 📋 Nima Bor Bu Paketda?

1. **bot.js** — Telegram Bot asosiy logika (haydovchi, yo'lovchi, matching)
2. **bot-package.json** — Dependencies (Telegraf framework)
3. **.env.example** — Configuration template
4. **admin-panel.html** — Admin uchun ko'rib-chiqish paneli
5. **BOT-SETUP.md** — Bu fayl

---

## 🚀 Tez O'rnatish (5 minut)

### Step 1: Node.js O'rnatish

```bash
# Mac/Linux
brew install node

# Windows
# https://nodejs.org/'dan download qiling
```

### Step 2: Bot Token Olish

1. Telegram'da **@BotFather**'ga yozing
2. `/start` yuboring
3. `/newbot` yuboring
4. Bot nomini kiriting: `7075uz_Bot`
5. **Token** olasiz: `123456:ABC-DEF123456789`

### Step 3: Loyiha O'rnatish

```bash
# Folder yaratish
mkdir 7075-bot
cd 7075-bot

# Package.json ko'chirish
cp bot-package.json package.json

# Dependencies o'rnatish
npm install

# .env fayl yaratish
cp .env.example .env

# Token qo'shish
# .env'da BOT_TOKEN=YOUR_TOKEN_HERE ni token bilan almashtiring
```

### Step 4: Botni Ishga Tushirish

```bash
# Development mode (auto reload)
npm run dev

# Yoki production
npm start
```

**Tayyorlandi! 🎉 Bot ishga tushdi!**

---

## 🤖 Bot Ishlatish

### Haydovchi Ro'yxati

1. Telegram'da `/start` yuboring
2. "🚗 Haydovchi" ni tanlang
3. Moshina turi tanlang (Gentra, Cobalt, Onix)
4. Bagaj hajmini tanlang
5. Davlat raqami kiriting (01A123AA format)
6. Telefon raqami (+998901234567 format)
7. Ism-Familya kiriting

**Admin ma'lumotlar:**
- Moshina, bagaj, raqam, telefon → Admin ko'radi
- Tasdiqlash uchun reyting kerak
- Tasdiqlangandan keyin elon qo'sha oladi

### Yo'lovchi Ro'yxati

1. `/start` yuboring
2. "👤 Yo'lovchi" ni tanlang
3. Telefon raqami (+998901234567)
4. Ism-Familya

### Elon Qo'shish (Haydovchi)

1. "🚗 Elon qo'shish" ni tanlang
2. Yo'nalishni tanlang (Toshkent, Termiz, Qarshi)
3. Qayerga ketiladi tanlang
4. O'rindiq soni (1-4)
5. Sana (bugun)
6. Vaqti (08:00, 14:00, 18:00)
7. Narx (75,000 / 85,000 / 95,000 so'm)

**Elon qo'shilgandan keyin:**
- Yo'lovchilar uni ko'radi
- Band qilsa, haydovchiga bildirishnoma keladi
- Ikkisi ham qabul qilsa — matched!

### Safar Qidirish (Yo'lovchi)

1. "🔍 Safar qidirish" ni tanlang
2. Qayerdan (Toshkent, Termiz, Qarshi)
3. Qayerga
4. Mos safar ko'rsatiladi
5. "✅ Band qilish" ni tanlang
6. Haydovchi tasdiqlashni kutiladi

### Chat va Matching

**Haydovchiga notification:**
- Yo'lovchi band qilgani
- Yo'lovchi ismi, reyting
- ✅ Qabul yoki ❌ Rad

**Yo'lovchiga notification:**
- Haydovchi tasdiqlagan xabari
- Haydovchi ismи, telefon
- ✅ Tasdiqlash button

**Matched bo'lgandan keyin:**
- 💬 Chat (text messages)
- Shunga sharait bilai

---

## 📊 Admin Panel

### Ochish

```bash
# Browser'da
file:///path/to/admin-panel.html

# Yoki local server
python -m http.server 8000
# http://localhost:8000/admin-panel.html
```

### Admin Panel'da Ko'rish

✅ **Tasdiqlash Navbati**
- Yangi haydovchilar
- Moshina, raqam, telefon ma'lumotlari
- ✅ Tasdiqlash / ❌ Rad tugmelerі

✅ **Barcha Haydovchilar**
- Ismi, moshina, telefon
- Reyting, safar soni
- Tasdiqlangan/Kutilmoqda holati

✅ **Faol Elon-lar**
- Yo'nalish, sana, vaqt
- Narx, o'rindiq soni

✅ **Safarlar va Mos Qolganlar**
- Qaysi haydovchi-yo'lovchi mos qolgan
- Holati (matching, completed)

---

## 🔌 Database Integratsiya (Keyinchalik)

Hozir: **Memory'da saqlanadi** (bot restart qilinsa, barcha ma'lumot o'chadi)

Keyinchalik: **PostgreSQL bilan**

```javascript
// bot.js'da o'zgarish:

// Hozir:
const DB = { drivers: [], passengers: [] };

// Keyinchalik:
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// SQL:
// CREATE TABLE drivers (...);
// CREATE TABLE passengers (...);
// CREATE TABLE listings (...);
// CREATE TABLE matches (...);
```

---

## 🌐 Web Sayt Integratsiya (Keyinchalik)

Bot va sayt ayniy database'dan foydalanadi:

```
Telegram Bot (MVP v1.0)
    ↓
PostgreSQL Database
    ↓
NextJS Website (v2.0)
    ↓
Mobile App (v3.0)
```

---

## 🔔 Notifications Sistema

**Hozir:** Bot sendMessage orqali

**Keyinchalik:** WebSocket (real-time)

```javascript
// Misol: Haydovchiga notification
await bot.telegram.sendMessage(
  driverId,
  '🔔 Yangi yo\'lovchi: Zarina Rahmatova'
);

// Yo'lovchiga notification
await bot.telegram.sendMessage(
  passengerId,
  '✅ Haydovchi tasdiqladi: Rustam Kamalov'
);
```

---

## 📝 Database Schema (Keyinchalik)

```sql
-- Haydovchilar
CREATE TABLE drivers (
  id SERIAL PRIMARY KEY,
  telegram_id INTEGER UNIQUE,
  name VARCHAR(100),
  phone VARCHAR(20),
  car_type VARCHAR(50),
  license_plate VARCHAR(20),
  baggage VARCHAR(50),
  verified BOOLEAN DEFAULT false,
  rating DECIMAL(2,1) DEFAULT 5,
  trips INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Yo'lovchilar
CREATE TABLE passengers (
  id SERIAL PRIMARY KEY,
  telegram_id INTEGER UNIQUE,
  name VARCHAR(100),
  phone VARCHAR(20),
  rating DECIMAL(2,1) DEFAULT 5,
  trips INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Elon-lar
CREATE TABLE listings (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER REFERENCES drivers(id),
  from_city VARCHAR(50),
  to_city VARCHAR(50),
  date DATE,
  time TIME,
  seats_available INTEGER,
  price DECIMAL(10,2),
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Mos Qolganlar
CREATE TABLE matches (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id),
  driver_id INTEGER REFERENCES drivers(id),
  passenger_id INTEGER REFERENCES passengers(id),
  status VARCHAR(20) DEFAULT 'waiting',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Chat Xabarlar
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id),
  sender_id INTEGER,
  text TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🚀 Deployment (Production)

### Telegram Webhook (Recommended)

```bash
# Heroku, AWS Lambda, yoki VPS
# Webhook setup:
POST /setWebhook
{
  "url": "https://yourdomain.com/bot",
  "secret_token": "your-secret-token"
}
```

### Environment Variables

```bash
BOT_TOKEN=123456:ABC-DEF...
ADMIN_ID=123456789
DATABASE_URL=postgresql://user:pass@db:5432/7075
API_URL=https://api.7075.uz
NODE_ENV=production
```

---

## 🐛 Debugging

### Logs Ko'rish

```bash
# Console'da real-time logs
npm run dev

# File'ga logs
npm start > bot.log 2>&1
```

### Test Qilish

```javascript
// Console'da
const { bot, DB } = require('./bot.js');

// Driver test
console.log(DB.drivers); // Barcha haydovchilar
console.log(DB.listings); // Barcha elon-lar
console.log(DB.matches); // Barcha matchlar
```

---

## ✅ Checklist

### MVP v1.0
- [x] Haydovchi ro'yxati (moshina, bagaj, raqam)
- [x] Yo'lovchi ro'yxati (telefon, ism)
- [x] Elon qo'shish (yo'nalish, vaqt, narx)
- [x] Safar qidirish (filter)
- [x] Band qilish (booking)
- [x] Matching (haydovchi tasdiqlash)
- [x] Notifications (bot sendMessage)
- [x] Admin panel (ko'rib-chiqish)

### v2.0 (Keyinchalik)
- [ ] NextJS website
- [ ] PostgreSQL database
- [ ] Real-time chat (WebSocket)
- [ ] Rating system
- [ ] Payment integration
- [ ] Mobile app (React Native)

---

## 📞 Troubleshooting

### Bot xabar chiqarmipoqda?

```bash
# Token tekshiring
echo $BOT_TOKEN

# Bot ishga tushganmi?
npm run dev
```

### "Invalid token" xatosi?

```bash
# @BotFather ga /token yuboring
# Yangi token oling
# .env'da almashtiring
```

### Xabar yuborilmaydi?

```javascript
// bot.js'da check qiling:
console.log('Sending message to:', userId);

// Keyinchalik:
await bot.telegram.sendMessage(userId, text)
  .catch(err => console.error('Error:', err));
```

### Admin panel ko'rsinmaydi?

```bash
# Browser console (F12) check qiling
# admin-panel.html path correct bo'lsa check qiling
```

---

## 📚 Resources

- **Telegraf docs**: https://telegraf.js.org/
- **Telegram Bot API**: https://core.telegram.org/bots/api
- **PostgreSQL**: https://www.postgresql.org/
- **NextJS**: https://nextjs.org/

---

## 🎯 Next Step

1. Bot MVP qo'shildi ✅
2. Keyin: **Website** (HTML sayt)
3. Keyin: **Backend** (API + DB)
4. Keyin: **Mobile App** (iOS/Android)

---

**MVP v1.0 Tayyorlandi! 🚀**

Birinchi yo'lovchi va haydovchi bot'da ro'yxatdan o'tadi, matching qilish ishlaydi!

Keyinchalik barcha web, app, payment bilan tugallanadi.

Good luck! 💪
