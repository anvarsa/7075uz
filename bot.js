require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const path = require('path');
const pool = require('./db');

const bot = new Telegraf(process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE');
const app = express();
const PORT = process.env.PORT || 4000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const sessions = new Map();

// 🔧 Xavfsiz tahrirlash
async function safeEdit(ctx, text, extra) {
  try {
    return await ctx.editMessageText(text, extra);
  } catch (err) {
    if (err.description && err.description.includes('message is not modified')) return;
    if (err.description && err.description.includes('there is no text in the message to edit')) {
      await ctx.deleteMessage().catch(() => {});
      return await ctx.replyWithHTML(text, extra);
    }
    throw err;
  }
}

// 📅 Dinamik sana tugmalari generatori
function generateDateKeyboard(actionPrefix = 'date_') {
  const buttons = [];
  const today = new Date();
  const dayNames = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];

  for (let i = 0; i < 5; i++) {
    const d = new Date();
    d.setDate(today.getDate() + i);
    const dateString = d.toISOString().split('T')[0];
    const label = i === 0 ? `Bugun (${dateString})` : i === 1 ? `Ertaga (${dateString})` : `${dateString} (${dayNames[d.getDay()]})`;
    buttons.push([Markup.button.callback(label, `${actionPrefix}_${dateString}`)]);
  }
  buttons.push([Markup.button.callback('← Orqaga', 'main_menu')]);
  return Markup.inlineKeyboard(buttons);
}

// ===== 🔄 MOS KELUVCHI FOYDALANUVCHILARGA XABAR YUBORISH =====
async function notifyMatchingUsers(type, listing) {
  try {
    // type === 'driver' bo'lsa, mos yo'lovchilarga xabar beramiz
    // type === 'passenger' bo'lsa, mos haydovchilarga xabar beramiz
    if (type === 'driver') {
      const passRes = await pool.query(
        'SELECT * FROM passengers_listings WHERE from_city = $1 AND to_city = $2 AND status = \'active\'',
        [listing.from, listing.to]
      );
      for (const pass of passRes.rows) {
        try {
          await bot.telegram.sendMessage(
            pass.id,
            `🔔 <b>Sizning yo'nalishingizga haydovchi topildi!</b>\n\n` +
            `<b>Mashina:</b> ${listing.car_type} (${listing.license_plate})\n` +
            `<b>Yo'nalish:</b> ${listing.from} ➔ ${listing.to}\n` +
            `<b>Sana / Vaqt:</b> ${listing.date} | ${listing.time}\n` +
            `<b>Narx:</b> ${listing.price} so'm\n` +
            `<b>Bo'sh o'rinlar:</b> ${listing.seats} ta\n` +
            `<b>Telefon:</b> ${listing.phone}`,
            { parse_mode: 'HTML' }
          );
        } catch (e) { console.error('Error notifying passenger:', e); }
      }
    } else {
      const drvRes = await pool.query(
        'SELECT * FROM drivers_listings WHERE from_city = $1 AND to_city = $2 AND status = \'active\'',
        [listing.from, listing.to]
      );
      for (const drv of drvRes.rows) {
        try {
          await bot.telegram.sendMessage(
            drv.id,
            `🔔 <b>Yo'nalishingizga yangi yo'lovchi buyurtmasi tushdi!</b>\n\n` +
            `<b>Ism:</b> ${listing.name}\n` +
            `<b>Yo'nalish:</b> ${listing.from} ➔ ${listing.to}\n` +
            `<b>Sana:</b> ${listing.date}\n` +
            `<b>Taklif narxi:</b> ${listing.price} so'm\n` +
            `<b>Telefon:</b> ${listing.phone}`,
            { parse_mode: 'HTML' }
          );
        } catch (e) { console.error('Error notifying driver:', e); }
      }
    }
  } catch (err) {
    console.error('Matching notification error:', err);
  }
}

// ===== MIDDLEWARE =====
bot.use((ctx, next) => {
  if (!ctx.from) return next();
  if (!sessions.has(ctx.from.id)) {
    sessions.set(ctx.from.id, {
      userId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      role: null,
      data: {},
      step: 'role_selection'
    });
  }
  ctx.session = sessions.get(ctx.from.id);
  return next();
});

// ===== 1. /START =====
bot.start(async (ctx) => {
  const userId = ctx.from.id;

  try {
    const driverRes = await pool.query('SELECT * FROM drivers WHERE id = $1', [userId]);
    if (driverRes.rows.length > 0) {
      const drv = driverRes.rows[0];
      ctx.session.role = 'driver';
      ctx.session.data = { name: drv.name, phone: drv.phone, carType: drv.car_type, baggage: drv.baggage, licensePlate: drv.license_plate };
      ctx.session.step = 'driver_main';
      return ctx.replyWithHTML(`<b>🚗 Haydovchi menyusi (Xush kelibsiz, ${drv.name}!)</b>`, {
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🚗 E'lon qo'shish (Bo'sh o'rin)", 'driver_create_listing')],
          [Markup.button.callback("📋 Mening e'lonlarim", 'driver_my_listings')],
          [Markup.button.callback("👥 Yo'lovchilar buyurtmasini ko'rish", 'driver_search_passengers')],
          [Markup.button.callback('❌ Chiqish', 'exit')]
        ])
      });
    }

    const passRes = await pool.query('SELECT * FROM passengers WHERE id = $1', [userId]);
    if (passRes.rows.length > 0) {
      const pass = passRes.rows[0];
      ctx.session.role = 'passenger';
      ctx.session.data = { name: pass.name, phone: pass.phone };
      ctx.session.step = 'passenger_main';
      return ctx.replyWithHTML(`<b>👤 Yo'lovchi menyusi (Xush kelibsiz, ${pass.name}!)</b>`, {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔍 Safar qidirish (Haydovchi topish)', 'passenger_search')],
          [Markup.button.callback("📝 E'lon berish (Buyurtma qoldirish)", 'passenger_create_listing')],
          [Markup.button.callback("📋 Mening e'lonlarim", 'passenger_my_listings')],
          [Markup.button.callback('❌ Chiqish', 'exit')]
        ])
      });
    }
  } catch (err) {
    console.error("DB Error on start:", err);
  }

  ctx.session.step = 'role_selection';
  ctx.replyWithHTML(
    `<b>🚗 7075.uz — Taksi Platformasi</b>\n\nSalom, <b>${ctx.from.first_name}</b>!\n\nSiz kimsiz?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🚗 Haydovchi', 'role_driver'), Markup.button.callback('👤 Yo\'lovchi', 'role_passenger')],
      [Markup.button.callback('❌ Chiqish', 'exit')]
    ])
  );
});

bot.action('role_selection', (ctx) => {
  ctx.session.step = 'role_selection';
  safeEdit(ctx, `<b>🚗 7075.uz — Taksi Platformasi</b>\n\nSiz kimsiz?`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🚗 Haydovchi', 'role_driver'), Markup.button.callback('👤 Yo\'lovchi', 'role_passenger')],
      [Markup.button.callback('❌ Chiqish', 'exit')]
    ])
  });
});

// ===== 🚗 HAYDOVCHI / 👤 YO'LOVCHI RO'YXATDAN O'TISH =====
bot.action('role_driver', async (ctx) => {
  ctx.session.role = 'driver';
  const driverRes = await pool.query('SELECT * FROM drivers WHERE id = $1', [ctx.from.id]);

  if (driverRes.rows.length > 0) {
    return ctx.deleteMessage().then(() => ctx.replyWithHTML(`<b>🚗 Haydovchi menyusi</b>`, Markup.inlineKeyboard([
      [Markup.button.callback("🚗 E'lon qo'shish (Bo'sh o'rin)", 'driver_create_listing')],
      [Markup.button.callback("📋 Mening e'lonlarim", 'driver_my_listings')],
      [Markup.button.callback("👥 Yo'lovchilar buyurtmasini ko'rish", 'driver_search_passengers')],
      [Markup.button.callback('❌ Chiqish', 'exit')]
    ])));
  }

  ctx.session.step = 'driver_phone';
  ctx.deleteMessage().catch(() => {});
  ctx.replyWithHTML(
    `<b>📱 Telefon raqamingizni yuboring</b>\n\nRo'yxatdan o'tish uchun pastdagi tugmani bosing:`,
    Markup.keyboard([[Markup.button.contactRequest('📱 Telefon raqamni yuborish')]]).resize().oneTime()
  );
});

bot.action('role_passenger', async (ctx) => {
  ctx.session.role = 'passenger';
  const passRes = await pool.query('SELECT * FROM passengers WHERE id = $1', [ctx.from.id]);

  if (passRes.rows.length > 0) {
    return ctx.deleteMessage().then(() => ctx.replyWithHTML(`<b>👤 Yo'lovchi menyusi</b>`, Markup.inlineKeyboard([
      [Markup.button.callback('🔍 Safar qidirish (Haydovchi topish)', 'passenger_search')],
      [Markup.button.callback("📝 E'lon berish (Buyurtma qoldirish)", 'passenger_create_listing')],
      [Markup.button.callback("📋 Mening e'lonlarim", 'passenger_my_listings')],
      [Markup.button.callback('❌ Chiqish', 'exit')]
    ])));
  }

  ctx.session.step = 'passenger_phone';
  ctx.deleteMessage().catch(() => {});
  ctx.replyWithHTML(
    `<b>📱 Telefon raqamingizni yuboring</b>\n\nRo'yxatdan o'tish uchun pastdagi tugmani bosing:`,
    Markup.keyboard([[Markup.button.contactRequest('📱 Telefon raqamni yuborish')]]).resize().oneTime()
  );
});

bot.on('contact', async (ctx) => {
  const phone = ctx.message.contact.phone_number;
  ctx.session.data.phone = phone;

  if (ctx.session.step === 'driver_phone') {
    ctx.session.step = 'driver_car_type';
    return ctx.replyWithHTML(`<b>🚗 Mashina turi</b>\n\nQaysi mashina bilan xizmat ko'rsatasiz?`, Markup.inlineKeyboard([
      [Markup.button.callback('Chevrolet Gentra', 'car_gentra'), Markup.button.callback('Chevrolet Cobalt', 'car_cobalt')],
      [Markup.button.callback('Onix', 'car_onix'), Markup.button.callback('Boshqa', 'car_other')],
      [Markup.button.callback('← Orqaga', 'role_selection')]
    ]));
  }

  if (ctx.session.step === 'passenger_phone') {
    const name = ctx.from.first_name || 'Yo\'lovchi';
    await pool.query(
      'INSERT INTO passengers (id, name, phone) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET phone = EXCLUDED.phone',
      [ctx.from.id, name, phone]
    );
    ctx.session.step = 'passenger_main';
    return ctx.replyWithHTML(`<b>✅ Muvaffaqiyatli ro'yxatdan o'tdingiz!</b>`, Markup.inlineKeyboard([
      [Markup.button.callback('🔍 Safar qidirish (Haydovchi topish)', 'passenger_search')],
      [Markup.button.callback("📝 E'lon berish (Buyurtma qoldirish)", 'passenger_create_listing')],
      [Markup.button.callback("📋 Mening e'lonlarim", 'passenger_my_listings')],
      [Markup.button.callback('❌ Chiqish', 'exit')]
    ]));
  }
});

bot.action(/^car_/, (ctx) => {
  const carType = ctx.match.input.replace('car_', '');
  const carMap = { gentra: 'Chevrolet Gentra', cobalt: 'Chevrolet Cobalt', onix: 'Onix', other: 'Boshqa' };
  ctx.session.data.carType = carMap[carType] || 'Boshqa';
  ctx.session.step = 'driver_baggage';

  safeEdit(ctx, `<b>🎒 Bagaj hajmi</b>\n\nMashingizda qancha bagaj sig'imi bor?`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('Kichik (5kg)', 'baggage_small'), Markup.button.callback('O\'rtacha (20kg)', 'baggage_medium')],
      [Markup.button.callback('Katta (50kg)', 'baggage_large')],
      [Markup.button.callback('← Orqaga', 'role_driver')]
    ])
  });
});

bot.action(/^baggage_/, (ctx) => {
  const baggageKey = ctx.match.input.replace('baggage_', '');
  const baggageMap = { small: 'Kichik (5kg)', medium: 'O\'rtacha (20kg)', large: 'Katta (50kg)' };
  ctx.session.data.baggage = baggageMap[baggageKey];
  ctx.session.step = 'driver_license_plate';

  safeEdit(ctx, `<b>🎫 Davlat raqami</b>\n\nMashinaning davlat raqamini yozib yuboring:\n<i>Masalan: 01A123AA</i>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('← Orqaga', 'car_back')]])
  });
});

bot.action('car_back', (ctx) => {
  ctx.session.step = 'driver_car_type';
  safeEdit(ctx, `<b>🚗 Mashina turi</b>\n\nQaysi mashina bilan xizmat ko'rsatasiz?`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('Chevrolet Gentra', 'car_gentra'), Markup.button.callback('Chevrolet Cobalt', 'car_cobalt')],
      [Markup.button.callback('Onix', 'car_onix'), Markup.button.callback('Boshqa', 'car_other')],
      [Markup.button.callback('← Orqaga', 'role_selection')]
    ])
  });
});

// ===== 💬 MATNLI INPUTLAR (TEXT HANDLER) =====
bot.on('text', async (ctx) => {
  const step = ctx.session.step;
  const text = ctx.message.text.trim();

  // 1. Haydovchi davlat raqami
  if (step === 'driver_license_plate') {
    ctx.session.data.licensePlate = text;
    const name = ctx.from.first_name || 'Haydovchi';
    
    await pool.query(
      `INSERT INTO drivers (id, name, phone, car_type, baggage, license_plate) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       ON CONFLICT (id) DO UPDATE SET 
       car_type = EXCLUDED.car_type, baggage = EXCLUDED.baggage, license_plate = EXCLUDED.license_plate`,
      [ctx.from.id, name, ctx.session.data.phone, ctx.session.data.carType, ctx.session.data.baggage, text]
    );

    ctx.session.step = 'driver_main';
    return ctx.replyWithHTML(`<b>✅ Muvaffaqiyatli ro'yxatdan o'tdingiz!</b>`, Markup.inlineKeyboard([
      [Markup.button.callback("🚗 E'lon qo'shish (Bo'sh o'rin)", 'driver_create_listing')],
      [Markup.button.callback("📋 Mening e'lonlarim", 'driver_my_listings')],
      [Markup.button.callback("👥 Yo'lovchilar buyurtmasini ko'rish", 'driver_search_passengers')],
      [Markup.button.callback('❌ Chiqish', 'exit')]
    ]));
  }

  // 2. Haydovchi narx kiritganda -> E'lonni bazaga yozish va xabar berish
  if (step === 'listing_price_input') {
    const price = parseInt(text.replace(/\D/g, ''));
    if (isNaN(price)) {
      return ctx.reply('⚠️ Iltimos, narxni faqat raqamlarda kiriting (masalan: 80000):');
    }
    ctx.session.data.price = price;
    const d = ctx.session.data;

    const newListing = {
      id: ctx.from.id,
      name: ctx.session.firstName || 'Haydovchi',
      phone: d.phone,
      car_type: d.carType,
      license_plate: d.licensePlate,
      from: d.from,
      to: d.to,
      seats: d.seats,
      date: d.date,
      time: d.time,
      price: price
    };

    const res = await pool.query(
      `INSERT INTO drivers_listings (id, name, phone, car_type, license_plate, from_city, to_city, seats, date, time, price, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active') RETURNING *`,
      [newListing.id, newListing.name, newListing.phone, newListing.car_type, newListing.license_plate, newListing.from, newListing.to, newListing.seats, newListing.date, newListing.time, newListing.price]
    );

    // Mos keluvchi yo'lovchilarga avto xabar yuborish
    await notifyMatchingUsers('driver', res.rows[0]);

    ctx.session.step = 'driver_main';
    return ctx.replyWithHTML(
      `<b>🎉 E'loningiz muvaffaqiyatli joylandi!</b>\n\n` +
      `<b>Yo'nalish:</b> ${d.from} ➔ ${d.to}\n` +
      `<b>Sana / Vaqt:</b> ${d.date} | ${d.time}\n` +
      `<b>Narx:</b> ${price} so'm\n` +
      `<b>Bo'sh o'rinlar:</b> ${d.seats} ta`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📋 Mening e\'lonlarim', 'driver_my_listings')],
        [Markup.button.callback('🏠 Bosh menyu', 'main_menu')]
      ])
    );
  }

  // 3. Yo'lovchi narx kiritganda -> E'lonni bazaga yozish va xabar berish
  if (step === 'passenger_listing_price') {
    const price = parseInt(text.replace(/\D/g, ''));
    if (isNaN(price)) {
      return ctx.reply('⚠️ Iltimos, narxni faqat raqamlarda kiriting (masalan: 350.000 yoki 450.000 uzs):');
    }
    ctx.session.data.price = price;
    const d = ctx.session.data;

    const res = await pool.query(
      `INSERT INTO passengers_listings (id, name, phone, from_city, to_city, date, price, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active') RETURNING *`,
      [ctx.from.id, ctx.from.first_name || 'Yo\'lovchi', d.phone, d.passFrom, d.passTo, d.passDate, price]
    );

    // Mos keluvchi haydovchilarga avto xabar yuborish
    await notifyMatchingUsers('passenger', res.rows[0]);

    ctx.session.step = 'passenger_main';
    return ctx.replyWithHTML(
      `<b>🎉 Buyurtmangiz qabul qilindi va e'lon qilindi!</b>\n\n` +
      `<b>Yo'nalish:</b> ${d.passFrom} ➔ ${d.passTo}\n` +
      `<b>Sana:</b> ${d.passDate}\n` +
      `<b>Taklif narxi:</b> ${price} so'm`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📋 Mening e\'lonlarim', 'passenger_my_listings')],
        [Markup.button.callback('🏠 Bosh menyu', 'main_menu')]
      ])
    );
  }
});

// ===== HAYDOVCHI E'LON YARATISH QADAMLARI =====
bot.action('driver_create_listing', (ctx) => {
  ctx.session.step = 'listing_from';
  safeEdit(ctx, `<b>🚗 Haydovchi e'loni</b>\n\n<b>📍 Qayerdan yo'lga chiqasiz?</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('Toshkent', 'listing_from_tsk'), Markup.button.callback('Termiz', 'listing_from_trz')],
      [Markup.button.callback('Qarshi', 'listing_from_qrshi')],
      [Markup.button.callback('← Orqaga', 'main_menu')]
    ])
  });
});

bot.action(/^listing_from_/, (ctx) => {
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  ctx.session.data.from = cityMap[ctx.match.input.replace('listing_from_', '')];
  ctx.session.step = 'listing_to';

  safeEdit(ctx, `<b>📍 Qayerga borasiz?</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('Toshkent', 'listing_to_tsk'), Markup.button.callback('Termiz', 'listing_to_trz')],
      [Markup.button.callback('Qarshi', 'listing_to_qrshi')],
      [Markup.button.callback('← Orqaga', 'driver_create_listing')]
    ])
  });
});

bot.action(/^listing_to_/, (ctx) => {
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  ctx.session.data.to = cityMap[ctx.match.input.replace('listing_to_', '')];
  ctx.session.step = 'listing_seats';

  safeEdit(ctx, `<b>👥 Qancha bo'sh o'rindiq bor?</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('1', 'seats_1'), Markup.button.callback('2', 'seats_2'), Markup.button.callback('3', 'seats_3'), Markup.button.callback('4', 'seats_4')],
      [Markup.button.callback('← Orqaga', 'driver_create_listing')]
    ])
  });
});

bot.action(/^seats_/, (ctx) => {
  ctx.session.data.seats = parseInt(ctx.match.input.replace('seats_', ''));
  ctx.session.step = 'listing_date';

  safeEdit(ctx, `<b>📅 Safar sanasini tanlang:</b>`, {
    parse_mode: 'HTML',
    ...generateDateKeyboard('date')
  });
});

bot.action(/^date_/, (ctx) => {
  const selectedDate = ctx.match.input.replace('date_', '');
  ctx.session.data.date = selectedDate;
  ctx.session.step = 'listing_time';

  safeEdit(ctx, `<b>🕐 Ketish vaqtini tanlang:</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('06:00', 'time_0600'), Markup.button.callback('08:00', 'time_0800')],
      [Markup.button.callback('14:00', 'time_1400'), Markup.button.callback('18:00', 'time_1800')],
      [Markup.button.callback('← Orqaga', 'driver_create_listing')]
    ])
  });
});

bot.action(/^time_/, (ctx) => {
  const timeKey = ctx.match.input.replace('time_', '');
  const timeMap = { '0600': '06:00', '0800': '08:00', '1400': '14:00', '1800': '18:00' };
  ctx.session.data.time = timeMap[timeKey] || '08:00';
  ctx.session.step = 'listing_price_input';

  safeEdit(ctx, `<b>💰 Narxni kiriting</b>\n\n1 ta o'rindiq uchun narxni raqamlarda yozib yuboring:\n<i>Masalan: 80000</i>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('← Orqaga', 'driver_create_listing')]])
  });
});

// ===== 👤 YO'LOVCHI E'LON YARATISH QADAMLARI =====
bot.action('passenger_create_listing', (ctx) => {
  ctx.session.step = 'passenger_listing_from';
  safeEdit(ctx, `<b>📝 Yo'lovchi e'loni</b>\n\n<b>📍 Qayerdan yo'lga chiqasiz?</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('Toshkent', 'passfrom_tsk'), Markup.button.callback('Termiz', 'passfrom_trz')],
      [Markup.button.callback('Qarshi', 'passfrom_qrshi')],
      [Markup.button.callback('← Orqaga', 'main_menu')]
    ])
  });
});

bot.action(/^passfrom_/, (ctx) => {
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  ctx.session.data.passFrom = cityMap[ctx.match.input.replace('passfrom_', '')];
  ctx.session.step = 'passenger_listing_to';

  safeEdit(ctx, `<b>📍 Qayerga borasiz?</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('Toshkent', 'passto_tsk'), Markup.button.callback('Termiz', 'passto_trz')],
      [Markup.button.callback('Qarshi', 'passto_qrshi')],
      [Markup.button.callback('← Orqaga', 'passenger_create_listing')]
    ])
  });
});

bot.action(/^passto_/, (ctx) => {
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  ctx.session.data.passTo = cityMap[ctx.match.input.replace('passto_', '')];
  ctx.session.step = 'passenger_listing_date';

  safeEdit(ctx, `<b>📅 Safar sanasini tanlang:</b>`, {
    parse_mode: 'HTML',
    ...generateDateKeyboard('passdate')
  });
});

bot.action(/^passdate_/, (ctx) => {
  const selectedDate = ctx.match.input.replace('passdate_', '');
  ctx.session.data.passDate = selectedDate;
  ctx.session.step = 'passenger_listing_price';

  safeEdit(ctx, `<b>💰 Taklif qilayotgan narxingizni yozib yuboring (so'mda):</b>\n<i>Masalan: 80000</i>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('← Orqaga', 'main_menu')]])
  });
});

// ===== 🔍 QIDIRUV (HAYDOVCHI VA YO'LOVCHI UCHUN TO'G'RI YO'NALISH) =====
bot.action('driver_search_passengers', (ctx) => {
  ctx.session.step = 'search_pass_from';
  safeEdit(ctx, `<b>👥 Yo'lovchilar buyurtmasini qidirish</b>\n\n<b>📍 Qayerdan?</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('Toshkent', 'spass_from_tsk'), Markup.button.callback('Termiz', 'spass_from_trz')],
      [Markup.button.callback('Qarshi', 'spass_from_qrshi')],
      [Markup.button.callback('← Orqaga', 'main_menu')]
    ])
  });
});

bot.action(/^spass_from_/, (ctx) => {
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  ctx.session.data.searchFrom = cityMap[ctx.match.input.replace('spass_from_', '')];
  ctx.session.step = 'search_pass_to';

  safeEdit(ctx, `<b>📍 Qayerga?</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('Toshkent', 'spass_to_tsk'), Markup.button.callback('Termiz', 'spass_to_trz')],
      [Markup.button.callback('Qarshi', 'spass_to_qrshi')],
      [Markup.button.callback('← Orqaga', 'driver_search_passengers')]
    ])
  });
});

bot.action(/^spass_to_/, async (ctx) => {
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  const searchTo = cityMap[ctx.match.input.replace('spass_to_', '')];
  const searchFrom = ctx.session.data.searchFrom;

  const res = await pool.query(
    'SELECT * FROM passengers_listings WHERE from_city = $1 AND to_city = $2 AND status = \'active\' ORDER BY id DESC LIMIT 5',
    [searchFrom, searchTo]
  );

  if (res.rows.length === 0) {
    return safeEdit(ctx, `<b>❌ ${searchFrom} ➔ ${searchTo} yo'nalishi bo'yicha faol yo'lovchilar topilmadi.</b>`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('← Orqaga', 'main_menu')]])
    });
  }

  let text = `<b>👥 Topilgan yo'lovchilar (${searchFrom} ➔ ${searchTo}):</b>\n\n`;
  res.rows.forEach((p, idx) => {
    text += `${idx + 1}. <b>Ism:</b> ${p.name}\n` +
            `   <b>Sana:</b> ${p.date}\n` +
            `   <b>Taklif narxi:</b> ${p.price} so'm\n` +
            `   <b>Telefon:</b> ${p.phone}\n\n`;
  });

  safeEdit(ctx, text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('← Orqaga', 'main_menu')]])
  });
});

bot.action('passenger_search', (ctx) => {
  ctx.session.step = 'search_drv_from';
  safeEdit(ctx, `<b>🔍 Safar qidirish (Haydovchi topish)</b>\n\n<b>📍 Qayerdan?</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('Toshkent', 'sdrv_from_tsk'), Markup.button.callback('Termiz', 'sdrv_from_trz')],
      [Markup.button.callback('Qarshi', 'sdrv_from_qrshi')],
      [Markup.button.callback('← Orqaga', 'main_menu')]
    ])
  });
});

bot.action(/^sdrv_from_/, (ctx) => {
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  ctx.session.data.searchDrvFrom = cityMap[ctx.match.input.replace('sdrv_from_', '')];
  ctx.session.step = 'search_drv_to';

  safeEdit(ctx, `<b>📍 Qayerga?</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('Toshkent', 'sdrv_to_tsk'), Markup.button.callback('Termiz', 'sdrv_to_trz')],
      [Markup.button.callback('Qarshi', 'sdrv_to_qrshi')],
      [Markup.button.callback('← Orqaga', 'passenger_search')]
    ])
  });
});

bot.action(/^sdrv_to_/, async (ctx) => {
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  const searchTo = cityMap[ctx.match.input.replace('sdrv_to_', '')];
  const searchFrom = ctx.session.data.searchDrvFrom;

  const res = await pool.query(
    'SELECT * FROM drivers_listings WHERE from_city = $1 AND to_city = $2 AND status = \'active\' ORDER BY id DESC LIMIT 5',
    [searchFrom, searchTo]
  );

  if (res.rows.length === 0) {
    return safeEdit(ctx, `<b>❌ ${searchFrom} ➔ ${searchTo} yo'nalishi bo'yicha bo'sh o'rindiqli haydovchilar topilmadi.</b>`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('← Orqaga', 'main_menu')]])
    });
  }

  let text = `<b>🚗 Topilgan haydovchilar (${searchFrom} ➔ ${searchTo}):</b>\n\n`;
  res.rows.forEach((d, idx) => {
    text += `${idx + 1}. <b>Mashina:</b> ${d.car_type} (${d.license_plate})\n` +
            `   <b>Sana/Vaqt:</b> ${d.date} | ${d.time}\n` +
            `   <b>Bo'sh o'rin:</b> ${d.seats} ta | <b>Narx:</b> ${d.price} so'm\n` +
            `   <b>Telefon:</b> ${d.phone}\n\n`;
  });

  safeEdit(ctx, text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('← Orqaga', 'main_menu')]])
  });
});

// ===== 📋 MENING E'LONLARIM =====
bot.action('driver_my_listings', async (ctx) => {
  const res = await pool.query('SELECT * FROM drivers_listings WHERE id = $1 AND status = \'active\' ORDER BY id DESC', [ctx.from.id]);
  if (res.rows.length === 0) {
    return safeEdit(ctx, `<b>Sizda hozircha faol e'lonlar yo'q.</b>`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('← Orqaga', 'main_menu')]])
    });
  }

  const buttons = res.rows.map(l => [Markup.button.callback(`❌ O'chirish: ${l.from_city} ➔ ${l.to_city} (${l.date})`, `del_drv_${l.id}`)]);
  buttons.push([Markup.button.callback('← Orqaga', 'main_menu')]);

  safeEdit(ctx, `<b>📋 Sizning faol e'lonlaringiz:</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(buttons)
  });
});

bot.action(/^del_drv_/, async (ctx) => {
  const listingId = ctx.match.input.replace('del_drv_', '');
  await pool.query('UPDATE drivers_listings SET status = \'closed\' WHERE id = $1 AND id_user = $2', [listingId, ctx.from.id]); // yoki oddiy id bo'yicha
  ctx.answerCbQuery("E'lon o'chirildi!");
  ctx.session.step = 'driver_main';
  safeEdit(ctx, `<b>✅ E'lon muvaffaqiyatli yopildi!</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('🏠 Bosh menyu', 'main_menu')]])
  });
});

bot.action('passenger_my_listings', async (ctx) => {
  const res = await pool.query('SELECT * FROM passengers_listings WHERE id = $1 AND status = \'active\' ORDER BY id DESC', [ctx.from.id]);
  if (res.rows.length === 0) {
    return safeEdit(ctx, `<b>Sizda hozircha faol e'lonlar yo'q.</b>`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('← Orqaga', 'main_menu')]])
    });
  }

  const buttons = res.rows.map(l => [Markup.button.callback(`❌ O'chirish: ${l.from_city} ➔ ${l.to_city} (${l.date})`, `del_pass_${l.id}`)]);
  buttons.push([Markup.button.callback('← Orqaga', 'main_menu')]);

  safeEdit(ctx, `<b>📋 Sizning faol e'lonlaringiz:</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(buttons)
  });
});

// ===== BOSH MENYU VA CHIQISH =====
bot.action('main_menu', async (ctx) => {
  const role = ctx.session.role;
  if (role === 'driver') {
    safeEdit(ctx, `<b>🚗 Haydovchi menyusi</b>`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🚗 E'lon qo'shish (Bo'sh o'rin)", 'driver_create_listing')],
        [Markup.button.callback("📋 Mening e'lonlarim", 'driver_my_listings')],
        [Markup.button.callback("👥 Yo'lovchilar buyurtmasini ko'rish", 'driver_search_passengers')],
        [Markup.button.callback('❌ Chiqish', 'exit')]
      ])
    });
  } else {
    safeEdit(ctx, `<b>👤 Yo'lovchi menyusi</b>`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Safar qidirish (Haydovchi topish)', 'passenger_search')],
        [Markup.button.callback("📝 E'lon berish (Buyurtma qoldirish)", 'passenger_create_listing')],
        [Markup.button.callback("📋 Mening e'lonlarim", 'passenger_my_listings')],
        [Markup.button.callback('❌ Chiqish', 'exit')]
      ])
    });
  }
});

bot.action('exit', (ctx) => {
  sessions.delete(ctx.from.id);
  ctx.deleteMessage().catch(() => {});
  ctx.reply('Xayr! 👋 Botdan qayta foydalanish uchun /start bosing.', Markup.removeKeyboard());
});

bot.launch().then(() => console.log('🤖 Telegram Bot muvaffaqiyatli ishga tushdi!'));
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Web server faol: PORT ${PORT}`));
