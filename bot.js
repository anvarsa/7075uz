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

// 🔧 Xavfsiz tahrirlash (Message modification error bermasligi uchun)
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
function generateDateKeyboard() {
  const buttons = [];
  const today = new Date();
  const dayNames = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];

  for (let i = 0; i < 5; i++) {
    const d = new Date();
    d.setDate(today.getDate() + i);
    const dateString = d.toISOString().split('T')[0];
    const label = i === 0 ? `Bugun (${dateString})` : i === 1 ? `Ertaga (${dateString})` : `${dateString} (${dayNames[d.getDay()]})`;
    buttons.push([Markup.button.callback(label, `date_${dateString}`)]);
  }
  buttons.push([Markup.button.callback('← Orqaga', 'main_menu')]);
  return Markup.inlineKeyboard(buttons);
}

// ===== MIDDLEWARE (Sessiya boshqaruvi) =====
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

// ===== 1. AVTORIZATSIYA & /START =====
bot.start(async (ctx) => {
  const userId = ctx.from.id;

  try {
    // 1. Haydovchilikka tekshirish
    const driverRes = await pool.query('SELECT * FROM drivers WHERE id = $1', [userId]);
    if (driverRes.rows.length > 0) {
      const drv = driverRes.rows[0];
      ctx.session.role = 'driver';
      ctx.session.data = { name: drv.name, phone: drv.phone, carType: drv.car_type, baggage: drv.baggage, licensePlate: drv.license_plate };
      ctx.session.step = 'driver_main';
      return ctx.replyWithHTML(`<b>🚗 Haydovchi menyusi (Xush kelibsiz, ${drv.name}!)</b>`, {
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🚗 E'lon qo'shish (Bo'sh o'rin)", 'driver_create_listing')],
          [Markup.button.callback("👥 Yo'lovchilar buyurtmasini ko'rish", 'driver_search_passengers')],
          [Markup.button.callback('❌ Chiqish', 'exit')]
        ])
      });
    }

    // 2. Yo'lovchilikka tekshirish
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
          [Markup.button.callback('❌ Chiqish', 'exit')]
        ])
      });
    }
  } catch (err) {
    console.error("DB Error on start:", err);
  }

  // 3. Bazada yo'q bo'lsa -> Rol tanlash
  ctx.session.step = 'role_selection';
  ctx.replyWithHTML(
    `<b>🚗 7075.uz — Taksi Platformasi</b>\n\nSalom, <b>${ctx.from.first_name}</b>!\n\nSiz kimsiz?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🚗 Haydovchi', 'role_driver'), Markup.button.callback('👤 Yo\'lovchi', 'role_passenger')],
      [Markup.button.callback('❌ Chiqish', 'exit')]
    ])
  );
});

// Rol tanlash bosh oynasi
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

// ===== 🚗 HAYDOVCHI RO'YXATDAN O'TISHI =====
bot.action('role_driver', async (ctx) => {
  ctx.session.role = 'driver';
  const driverRes = await pool.query('SELECT * FROM drivers WHERE id = $1', [ctx.from.id]);

  if (driverRes.rows.length > 0) {
    return ctx.deleteMessage().then(() => ctx.replyWithHTML(`<b>🚗 Haydovchi menyusi</b>`, Markup.inlineKeyboard([
      [Markup.button.callback("🚗 E'lon qo'shish (Bo'sh o'rin)", 'driver_create_listing')],
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

// ===== 👤 YO'LOVCHI RO'YXATDAN O'TISHI =====
bot.action('role_passenger', async (ctx) => {
  ctx.session.role = 'passenger';
  const passRes = await pool.query('SELECT * FROM passengers WHERE id = $1', [ctx.from.id]);

  if (passRes.rows.length > 0) {
    return ctx.deleteMessage().then(() => ctx.replyWithHTML(`<b>👤 Yo'lovchi menyusi</b>`, Markup.inlineKeyboard([
      [Markup.button.callback('🔍 Safar qidirish (Haydovchi topish)', 'passenger_search')],
      [Markup.button.callback("📝 E'lon berish (Buyurtma qoldirish)", 'passenger_create_listing')],
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

// ===== 📞 KONTAKT QABUL QILISH =====
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
      [Markup.button.callback('❌ Chiqish', 'exit')]
    ]));
  }
});

// ===== MASHINA VA BAGAJ TANLASH =====
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

// ===== 💬 MATNLI INPUTLARNI TUTIB OLISH (TEXT HANDLER) =====
bot.on('text', async (ctx) => {
  const step = ctx.session.step;
  const text = ctx.message.text.trim();

  // 1. Haydovchi davlat raqamini kiritganda -> Bazaga saqlaymiz
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
      [Markup.button.callback("👥 Yo'lovchilar buyurtmasini ko'rish", 'driver_search_passengers')],
      [Markup.button.callback('❌ Chiqish', 'exit')]
    ]));
  }

  // 2. Narx kiritganda
  if (step === 'listing_price_input' || step === 'passenger_listing_price') {
    const price = parseInt(text.replace(/\D/g, ''));
    if (isNaN(price)) {
      return ctx.reply('⚠️ Iltimos, narxni faqat raqamlarda kiriting (masalan: 80000):');
    }

    ctx.session.data.price = price;
    ctx.session.step = 'main_menu';

    return ctx.replyWithHTML(`<b>🎉 E'lon muvaffaqiyatli yaratildi!</b>\n\n<b>Narx:</b> ${price} so'm`, Markup.inlineKeyboard([
      [Markup.button.callback('🏠 Bosh menyu', 'main_menu')]
    ]));
  }
});

// ===== HAYDOVCHI E'LON YARATISH =====
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
    ...generateDateKeyboard()
  });
});

// ===== 👤 YO'LOVCHI E'LON YARATISH & QIDIRUV =====
bot.action('passenger_create_listing', (ctx) => {
  ctx.session.step = 'passenger_listing_from';
  safeEdit(ctx, `<b>📝 Yo'lovchi e'loni</b>\n\n<b>📍 Qayerdan yo'lga chiqasiz?</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('Toshkent', 'pass_from_tsk'), Markup.button.callback('Termiz', 'pass_from_trz')],
      [Markup.button.callback('Qarshi', 'pass_from_qrshi')],
      [Markup.button.callback('← Orqaga', 'main_menu')]
    ])
  });
});

bot.action('passenger_search', (ctx) => {
  ctx.session.step = 'search_from';
  safeEdit(ctx, `<b>🔍 Safar qidirish</b>\n\n<b>📍 Qayerdan?</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('Toshkent', 'search_from_tsk'), Markup.button.callback('Termiz', 'search_from_trz')],
      [Markup.button.callback('Qarshi', 'search_from_qrshi')],
      [Markup.button.callback('← Orqaga', 'main_menu')]
    ])
  });
});

// ===== SANA VA VAQT HANDLERLARI =====
bot.action(/^date_/, (ctx) => {
  const selectedDate = ctx.match.input.replace('date_', '');

  if (ctx.session.role === 'passenger') {
    ctx.session.data.passDate = selectedDate;
    ctx.session.step = 'passenger_listing_price';
    return safeEdit(ctx, `<b>💰 Taklif qilayotgan narxingizni yozib yuboring (so'mda):</b>\n<i>Masalan: 80000</i>`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('← Orqaga', 'main_menu')]])
    });
  }

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

// ===== BOSH MENYU VA CHIQISH =====
bot.action('main_menu', async (ctx) => {
  const role = ctx.session.role;
  if (role === 'driver') {
    safeEdit(ctx, `<b>🚗 Haydovchi menyusi</b>`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🚗 E'lon qo'shish (Bo'sh o'rin)", 'driver_create_listing')],
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

// Bot va Express Serverni ishga tushirish
bot.launch().then(() => console.log('🤖 Telegram Bot muvaffaqiyatli ishga tushdi!'));
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Web server faol: PORT ${PORT}`));
