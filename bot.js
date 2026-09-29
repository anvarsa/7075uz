// 7075.uz Telegram Bot & Admin Panel (PostgreSQL versiyasi)

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const path = require('path');
const pool = require('./db');

// Bot initialization
const bot = new Telegraf(process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE');

// Express App for Admin Panel
const app = express();
const PORT = process.env.PORT || 4000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// User session management
const sessions = new Map();

// Xavfsiz tahrirlash funksiyasi
async function safeEdit(ctx, text, extra) {
  try {
    return await ctx.editMessageText(text, extra);
  } catch (err) {
    if (err.description && err.description.includes('message is not modified')) {
      return;
    }
    throw err;
  }
}

// 📅 Kelgusi kunlarni generatsiya qilish funksiyasi (Jadval uchun)
function generateDateKeyboard() {
  const buttons = [];
  const today = new Date();
  
  for (let i = 0; i < 5; i++) {
    const d = new Date();
    d.setDate(today.getDate() + i);
    const dateString = d.toISOString().split('T')[0]; // YYYY-MM-DD
    
    const dayNames = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
    const label = i === 0 ? `Bugun (${dateString})` : i === 1 ? `Ertaga (${dateString})` : `${dateString} (${dayNames[d.getDay()]})`;
    
    buttons.push([Markup.button.callback(label, `date_${dateString}`)]);
  }
  buttons.push([Markup.button.callback('← Orqaga', 'main_menu')]);
  return Markup.inlineKeyboard(buttons);
}

// ===== TELEGRAM BOT MIDDLEWARE & LOGIC =====
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

bot.start(async (ctx) => {
  ctx.session.step = 'role_selection';
  ctx.replyWithHTML(
    `<b>🚗 7075.uz — Taksi Platformasi</b>\n\n` +
    `Salom, <b>${ctx.from.first_name}</b>!\n\n` +
    `Siz kimsiz?`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🚗 Haydovchi', 'role_driver'),
        Markup.button.callback('👤 Yo\'lovchi', 'role_passenger')
      ],
      [Markup.button.callback('❌ Chiqish', 'exit')]
    ])
  );
});

// 🚗 Haydovchi roli
bot.action('role_driver', async (ctx) => {
  ctx.session.role = 'driver';
  
  const driverRes = await pool.query('SELECT * FROM drivers WHERE id = $1', [ctx.from.id]);
  if (driverRes.rows.length > 0) {
    const drv = driverRes.rows[0];
    ctx.session.data.phone = drv.phone;
    ctx.session.data.name = drv.name;
    ctx.session.step = 'driver_main';
    return safeEdit(ctx, `<b>🚗 Haydovchi menyusi (Oldin ro'yxatdan o'tgansiz)</b>`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🚗 E'lon qo'shish (Bo'sh o'rin)", 'driver_create_listing')],
        [Markup.button.callback("👥 Yo'lovchilar buyurtmasini ko'rish", 'driver_search_passengers')],
        [Markup.button.callback('❌ Chiqish', 'exit')]
      ])
    });
  }

  ctx.session.step = 'driver_car_type';
  safeEdit(ctx, 
    `<b>🚗 Mashina turi</b>\n\nQaysi mashina bilan xizmat ko'rsatasiz?`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Chevrolet Gentra', 'car_gentra'), Markup.button.callback('Chevrolet Cobalt', 'car_cobalt')],
        [Markup.button.callback('Onix', 'car_onix'), Markup.button.callback('Boshqa', 'car_other')],
        [Markup.button.callback('← Orqaga', 'role_selection')]
      ])
    }
  );
});

// 👤 Yo'lovchi roli
bot.action('role_passenger', async (ctx) => {
  ctx.session.role = 'passenger';

  const passRes = await pool.query('SELECT * FROM passengers WHERE id = $1', [ctx.from.id]);
  if (passRes.rows.length > 0) {
    const pass = passRes.rows[0];
    ctx.session.data.phone = pass.phone;
    ctx.session.data.name = pass.name;
    ctx.session.step = 'passenger_main';
    return safeEdit(ctx, `<b>👤 Yo'lovchi menyusi (Xush kelibsiz, ${pass.name}!)</b>`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Safar qidirish (Haydovchi topish)', 'passenger_search')],
        [Markup.button.callback('📝 E\'lon berish (Buyurtma qoldirish)', 'passenger_create_listing')],
        [Markup.button.callback('❌ Chiqish', 'exit')]
      ])
    });
  }

  ctx.session.step = 'passenger_contact';
  ctx.deleteMessage().catch(()=>{});
  
  ctx.replyWithHTML(
    `<b>👤 Yo'lovchi ro'yxatdan o'tishi</b>\n\n` +
    `Iltimos, pastdagi <b>"📱 Telefon raqamni yuborish"</b> tugmasini bosing:`,
    Markup.keyboard([
      [Markup.button.contactRequest('📱 Telefon raqamni yuborish')]
    ]).resize().oneTime()
  );
});

bot.action('role_selection', (ctx) => {
  ctx.session.step = 'role_selection';
  safeEdit(ctx, 
    `<b>🚗 7075.uz — Taksi Platformasi</b>\n\nSiz kimsiz?`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🚗 Haydovchi', 'role_driver'), Markup.button.callback('👤 Yo\'lovchi', 'role_passenger')]]) }
  );
});

bot.action(/^car_/, (ctx) => {
  const carType = ctx.match.input.replace('car_', '');
  const carMap = { gentra: 'Chevrolet Gentra', cobalt: 'Chevrolet Cobalt', onix: 'Onix', other: 'Boshqa' };
  ctx.session.data.carType = carMap[carType] || 'Boshqa';
  ctx.session.step = 'driver_baggage';
  safeEdit(ctx, 
    `<b>🎒 Bagaj hajmi</b>\n\nMashingizda qancha bagaj sig'imi bor?`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('Kichik (5kg)', 'baggage_small'), Markup.button.callback('O\'rtacha (20kg)', 'baggage_medium')], [Markup.button.callback('Katta (50kg)', 'baggage_large'), Markup.button.callback('← Orqaga', 'role_driver')]]) }
  );
});

bot.action(/^baggage_/, (ctx) => {
  const baggageKey = ctx.match.input.replace('baggage_', '');
  const baggageMap = { small: 'Kichik (5kg)', medium: 'O\'rtacha (20kg)', large: 'Katta (50kg)' };
  ctx.session.data.baggage = baggageMap[baggageKey];
  ctx.session.step = 'driver_license_plate';
  safeEdit(ctx, 
    `<b>🎫 Davlat raqami</b>\n\nMashinaning davlat raqamini kiriting:\n<i>Masalan: 01A123AA</i>`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('← Orqaga', 'role_driver')]]) }
  );
});

// ===== HAYDIVCHI: E'lon qo'shish qadamlari =====
bot.action('driver_create_listing', (ctx) => {
  ctx.session.step = 'listing_from';
  safeEdit(ctx, 
    `<b>🚗 Haydovchi e'loni</b>\n\n<b>📍 Qayerdan yo'lga chiqasiz?</b>`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('Toshkent', 'listing_from_tsk'), Markup.button.callback('Termiz', 'listing_from_trz')], [Markup.button.callback('Qarshi', 'listing_from_qrshi')]]) }
  );
});

bot.action(/^listing_from_/, (ctx) => {
  const fromCity = ctx.match.input.replace('listing_from_', '');
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  ctx.session.data.from = cityMap[fromCity];
  ctx.session.step = 'listing_to';
  safeEdit(ctx, 
    `<b>📍 Qayerga borasiz?</b>`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('Toshkent', 'listing_to_tsk'), Markup.button.callback('Termiz', 'listing_to_trz')], [Markup.button.callback('Qarshi', 'listing_to_qrshi')]]) }
  );
});

bot.action(/^listing_to_/, (ctx) => {
  const toCity = ctx.match.input.replace('listing_to_', '');
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  ctx.session.data.to = cityMap[toCity];
  ctx.session.step = 'listing_seats';
  safeEdit(ctx, 
    `<b>👥 Qancha bo'sh o'rindiq bor?</b>`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('1', 'seats_1'), Markup.button.callback('2', 'seats_2'), Markup.button.callback('3', 'seats_3'), Markup.button.callback('4', 'seats_4')]]) }
  );
});

bot.action(/^seats_/, (ctx) => {
  const seats = ctx.match.input.replace('seats_', '');
  ctx.session.data.seats = parseInt(seats);
  ctx.session.step = 'listing_date';
  
  safeEdit(ctx, `<b>📅 Safar sanasini tanlang:</b>`, { 
    parse_mode: 'HTML', 
    ...generateDateKeyboard() 
  });
});

bot.action(/^date_/, (ctx) => {
  const selectedDate = ctx.match.input.replace('date_', '');
  
  if (ctx.session.role === 'passenger') {
    ctx.session.data.passDate = selectedDate;
    ctx.session.step = 'passenger_listing_price';
    return safeEdit(ctx, 
      `<b>💰 Taklif qilayotgan narxingiz (1 kishi uchun, so'mda):</b>\n<i>Masalan: 80000</i>`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('← Orqaga', 'passenger_create_listing')]]) }
    );
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
  safeEdit(ctx, 
    `<b>💰 Narxni kiriting</b>\n\n1 ta o'rindiq uchun narxni raqamlarda kiriting:\n<i>Masalan: 80000</i>`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('← Orqaga', 'driver_create_listing')]]) }
  );
});

// ===== YO'LOVCHI: E'lon berish qadamlari =====
bot.action('passenger_create_listing', (ctx) => {
  ctx.session.step = 'passenger_listing_from';
  safeEdit(ctx, 
    `<b>📝 Yo'lovchi e'loni</b>\n\n<b>📍 Qayerdan yo'lga chiqasiz?</b>`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('Toshkent', 'pass_from_tsk'), Markup.button.callback('Termiz', 'pass_from_trz')], [Markup.button.callback('Qarshi', 'pass_from_qrshi')]]) }
  );
});

bot.action(/^pass_from_/, (ctx) => {
  const fromCity = ctx.match.input.replace('pass_from_', '');
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  ctx.session.data.passFrom = cityMap[fromCity];
  ctx.session.step = 'passenger_listing_to';
  safeEdit(ctx, 
    `<b>📍 Qayerga borasiz?</b>`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('Toshkent', 'pass_to_tsk'), Markup.button.callback('Termiz', 'pass_to_trz')], [Markup.button.callback('Qarshi', 'pass_to_qrshi')]]) }
  );
});

bot.action(/^pass_to_/, (ctx) => {
  const toCity = ctx.match.input.replace('pass_to_', '');
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  ctx.session.data.passTo = cityMap[toCity];
  ctx.session.step = 'passenger_listing_seats';
  safeEdit(ctx, 
    `<b>👥 Nechta kishisiz (o'rindiq)?</b>`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('1', 'pass_seats_1'), Markup.button.callback('2', 'pass_seats_2'), Markup.button.callback('3', 'pass_seats_3')]]) }
  );
});

bot.action(/^pass_seats_/, (ctx) => {
  const seats = ctx.match.input.replace('pass_seats_', '');
  ctx.session.data.passSeats = parseInt(seats);
  ctx.session.step = 'passenger_listing_date';
  
  safeEdit(ctx, `<b>📅 Safar sanasini tanlang:</b>`, { 
    parse_mode: 'HTML', 
    ...generateDateKeyboard() 
  });
});

// ===== YO'LOVCHI: Haydovchi e'lonlarini qidirish menyusi =====
bot.action('passenger_search', (ctx) => {
  ctx.session.step = 'search_from';
  safeEdit(ctx, 
    `<b>🔍 Safar qidirish (Haydovchilar topish)</b>\n\n<b>📍 Qayerdan?</b>`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('Toshkent', 'search_from_tsk'), Markup.button.callback('Termiz', 'search_from_trz')], [Markup.button.callback('Qarshi', 'search_from_qrshi')]]) }
  );
});

bot.action(/^search_from_/, (ctx) => {
  const fromCity = ctx.match.input.replace('search_from_', '');
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  ctx.session.data.searchFrom = cityMap[fromCity];
  ctx.session.step = 'search_to';
  safeEdit(ctx, `<b>📍 Qayerga borasiz?</b>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('Toshkent', 'search_to_tsk'), Markup.button.callback('Termiz', 'search_to_trz')], [Markup.button.callback('Qarshi', 'search_to_qrshi')]]) });
});

bot.action(/^search_to_/, async (ctx) => {
  const toCity = ctx.match.input.replace('search_to_', '');
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  ctx.session.data.searchTo = cityMap[toCity];
  
  const res = await pool.query(
    "SELECT * FROM listings WHERE from_city = $1 AND to_city = $2 AND status = 'active' AND seats_available > 0 ORDER BY created_at DESC",
    [ctx.session.data.searchFrom, ctx.session.data.searchTo]
  );
  const matches = res.rows;

  if (matches.length === 0) {
    return safeEdit(ctx, `❌ Ushbu yo'nalish bo'yicha mos haydovchilar topilmadi.`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔍 Qayta qidirish', 'passenger_search')], [Markup.button.callback('🏠 Bosh menyu', 'main_menu')]]) });
  }
  ctx.session.searchResults = matches;
  ctx.session.currentListingIndex = 0;
  showListing(ctx);
});

function showListing(ctx) {
  const matches = ctx.session.searchResults;
  const index = ctx.session.currentListingIndex || 0;
  const listing = matches[index];
  if (!listing) return;

  const text = `<b>🚗 Mashina:</b> ${listing.car_type} (${listing.license_plate})\n` +
               `<b>Yo'nalish:</b> ${listing.from_city} → ${listing.to_city}\n\n` +
               `👤 <b>Haydovchi:</b> ${listing.driver_name} (${listing.driver_phone}) (⭐ ${listing.driver_rating}/5)\n` +
               `📅 <b>Sana/Vaqt:</b> ${listing.date} ${listing.time}\n` +
               `👥 <b>Bo'sh joy:</b> ${listing.seats_available} ta\n` +
               `💰 <b>Narx:</b> ${Number(listing.price).toLocaleString()} so'm`;
  
  const buttons = [[Markup.button.callback('✅ Band qilish', `book_listing_${listing.id}`), Markup.button.callback('❌ O\'tkazib yuborish', 'skip_listing')]];
  if (index < matches.length - 1) buttons.push([Markup.button.callback("➡️ Keyingi e'lon", "next_listing")]);
  buttons.push([Markup.button.callback('🏠 Bosh menyu', 'main_menu')]);

  safeEdit(ctx, text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
}

bot.action('next_listing', (ctx) => {
  ctx.session.currentListingIndex = (ctx.session.currentListingIndex || 0) + 1;
  showListing(ctx);
});

bot.action('skip_listing', (ctx) => {
  safeEdit(ctx, "E'lon o'tkazib yuborildi.", Markup.inlineKeyboard([[Markup.button.callback('🔍 Qayta qidirish', 'passenger_search')]]));
});

// ===== HAYDIVCHI: Yo'lovchi e'lonlarini ko'rish =====
bot.action('driver_search_passengers', (ctx) => {
  ctx.session.step = 'driver_search_from';
  safeEdit(ctx, 
    `<b>👥 Yo'lovchilar buyurtmalarini ko'rish</b>\n\n<b>📍 Qayerdan ketasiz?</b>`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('Toshkent', 'd_search_from_tsk'), Markup.button.callback('Termiz', 'd_search_from_trz')], [Markup.button.callback('Qarshi', 'd_search_from_qrshi')]]) }
  );
});

bot.action(/^d_search_from_/, (ctx) => {
  const fromCity = ctx.match.input.replace('d_search_from_', '');
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  ctx.session.data.dSearchFrom = cityMap[fromCity];
  ctx.session.step = 'driver_search_to';
  safeEdit(ctx, `<b>📍 Qayerga borasiz?</b>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('Toshkent', 'd_search_to_tsk'), Markup.button.callback('Termiz', 'd_search_to_trz')], [Markup.button.callback('Qarshi', 'd_search_to_qrshi')]]) });
});

bot.action(/^d_search_to_/, async (ctx) => {
  const toCity = ctx.match.input.replace('d_search_to_', '');
  const cityMap = { tsk: 'Toshkent', trz: 'Termiz', qrshi: 'Qarshi' };
  ctx.session.data.dSearchTo = cityMap[toCity];
  
  const res = await pool.query(
    "SELECT * FROM passenger_listings WHERE from_city = $1 AND to_city = $2 AND status = 'active' ORDER BY created_at DESC",
    [ctx.session.data.dSearchFrom, ctx.session.data.dSearchTo]
  );
  const matches = res.rows;

  if (matches.length === 0) {
    return safeEdit(ctx, `❌ Ushbu yo'nalish bo'yicha yo'lovchi e'lonlari topilmadi.`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔍 Qayta qidirish', 'driver_search_passengers')], [Markup.button.callback('🏠 Bosh menyu', 'main_menu')]]) });
  }
  ctx.session.passengerSearchResults = matches;
  ctx.session.currentPassListingIndex = 0;
  showPassengerListing(ctx);
});

function showPassengerListing(ctx) {
  const matches = ctx.session.passengerSearchResults;
  const index = ctx.session.currentPassListingIndex || 0;
  const listing = matches[index];
  if (!listing) return;

  const text = `<b>👤 Yo'lovchi e'loni:</b>\n` +
               `<b>Yo'nalish:</b> ${listing.from_city} → ${listing.to_city}\n` +
               `👤 <b>Ism:</b> ${listing.passenger_name} (${listing.passenger_phone})\n` +
               `👥 <b>O'rindiqlar:</b> ${listing.seats} ta\n` +
               `💰 <b>Taklif narxi:</b> ${Number(listing.price).toLocaleString()} so'm`;
  
  const buttons = [[Markup.button.callback('✅ Bog\'lanish / Olish', `accept_passenger_${listing.id}`), Markup.button.callback('❌ O\'tkazish', 'skip_pass_listing')]];
  if (index < matches.length - 1) buttons.push([Markup.button.callback("➡️ Keyingi e'lon", "next_pass_listing")]);
  buttons.push([Markup.button.callback('🏠 Bosh menyu', 'main_menu')]);

  safeEdit(ctx, text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
}

bot.action('next_pass_listing', (ctx) => {
  ctx.session.currentPassListingIndex = (ctx.session.currentPassListingIndex || 0) + 1;
  showPassengerListing(ctx);
});

bot.action('skip_pass_listing', (ctx) => {
  safeEdit(ctx, "E'lon o'tkazib yuborildi.", Markup.inlineKeyboard([[Markup.button.callback('🔍 Qayta qidirish', 'driver_search_passengers')]]));
});

bot.action(/^accept_passenger_/, async (ctx) => {
  const listingId = parseInt(ctx.match.input.replace('accept_passenger_', ''));
  const listingRes = await pool.query('SELECT * FROM passenger_listings WHERE id = $1', [listingId]);
  const listing = listingRes.rows[0];

  const driverRes = await pool.query('SELECT * FROM drivers WHERE id = $1', [ctx.from.id]);
  const driver = driverRes.rows[0] || { name: ctx.from.first_name, phone: 'Noma\'lum', car_type: 'Mashina', license_plate: '000' };

  if (!listing) return ctx.reply('❌ E\'lon topilmadi.');

  bot.telegram.sendMessage(listing.passenger_id, `<b>🔔 Haydovchi sizning e'loningizni oldi!</b>\n\n🚗 <b>Mashina:</b> ${driver.car_type} (${driver.license_plate})\n👤 <b>Haydovchi:</b> ${driver.name}\n📞 <b>Tel:</b> ${driver.phone}`, {
    parse_mode: 'HTML'
  }).catch(()=>{});

  ctx.replyWithHTML(`<b>✅ Ma'lumot yo'lovchiga yuborildi!</b>`, Markup.inlineKeyboard([[Markup.button.callback('🏠 Bosh menyu', 'main_menu')]]));
});

// ===== CONTACT HANDLER =====
bot.on('contact', async (ctx) => {
  const phone = ctx.message.contact.phone_number;
  const formattedPhone = phone.startsWith('+') ? phone : '+' + phone;
  const contactName = `${ctx.message.contact.first_name || ''} ${ctx.message.contact.last_name || ''}`.trim() || ctx.from.first_name;

  if (ctx.session.role === 'passenger' && ctx.session.step === 'passenger_contact') {
    ctx.session.data.phone = formattedPhone;
    ctx.session.data.name = contactName;

    await pool.query(
      `INSERT INTO passengers (id, username, name, phone, rating) 
       VALUES ($1, $2, $3, $4, 5) 
       ON CONFLICT (id) DO UPDATE SET name = $3, phone = $4`,
      [ctx.from.id, ctx.from.username, contactName, formattedPhone]
    );
    
    ctx.session.step = 'passenger_main';

    return ctx.replyWithHTML(
      `<b>✅ Xush kelibsiz, ${contactName}!</b>`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Safar qidirish (Haydovchi topish)', 'passenger_search')],
        [Markup.button.callback('📝 E\'lon berish (Buyurtma qoldirish)', 'passenger_create_listing')]
      ])
    );
  } 
  else if (ctx.session.role === 'driver' && ctx.session.step === 'driver_contact') {
    ctx.session.data.phone = formattedPhone;
    ctx.session.data.name = contactName;

    await pool.query(
      `INSERT INTO drivers (id, username, name, phone, car_type, baggage, license_plate, rating) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, 5) 
       ON CONFLICT (id) DO UPDATE SET name = $3, phone = $4, car_type = $5, baggage = $6, license_plate = $7`,
      [ctx.from.id, ctx.from.username, contactName, formattedPhone, ctx.session.data.carType, ctx.session.data.baggage, ctx.session.data.licensePlate]
    );
    
    ctx.session.step = 'driver_main';

    return ctx.replyWithHTML(
      `<b>✅ Ro'yxatdan o'tish yakunlandi!</b>`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🚗 E'lon qo'shish (Bo'sh o'rin)", 'driver_create_listing')],
        [Markup.button.callback("👥 Yo'lovchilarni qidirish", 'driver_search_passengers')]
      ])
    );
  }
});

// ===== TEXT HANDLER =====
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  
  if (ctx.session.role === 'driver') {
    if (ctx.session.step === 'driver_license_plate') {
      if (!/^\d{2}[A-Za-z]\d{3}[A-Za-z]{2}$/.test(text.replace(/\s/g, ''))) return ctx.reply(`❌ Noto'g'ri format! Masalan: 01A123AA`);
      ctx.session.data.licensePlate = text.toUpperCase();
      ctx.session.step = 'driver_contact';
      
      return ctx.replyWithHTML(
        `<b>📞 Telefon raqamingizni yuboring:</b>`,
        Markup.keyboard([
          [Markup.button.contactRequest('📱 Telefon raqamni yuborish')]
        ]).resize().oneTime()
      );
    } 
    else if (ctx.session.step === 'listing_price_input') {
      const price = parseInt(text.replace(/\D/g, ''));
      if (isNaN(price) || price <= 0) return ctx.reply(`❌ Noto'g'ri qiymat! Narxni kiriting.`);
      ctx.session.data.price = price;
      
      const driverRes = await pool.query('SELECT * FROM drivers WHERE id = $1', [ctx.from.id]);
      const driver = driverRes.rows[0] || { name: ctx.from.first_name, phone: '+998000000000', rating: 5, car_type: 'Mashina', license_plate: '01A777AA' };
      
      const listingId = Date.now();
      await pool.query(
        `INSERT INTO listings (id, driver_id, driver_name, driver_phone, driver_rating, car_type, license_plate, from_city, to_city, seats, seats_available, date, time, price, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'active')`,
        [listingId, ctx.from.id, driver.name, driver.phone, driver.rating || 5, driver.car_type, driver.license_plate, ctx.session.data.from, ctx.session.data.to, ctx.session.data.seats, ctx.session.data.seats, ctx.session.data.date, ctx.session.data.time, price]
      );

      ctx.session.step = 'driver_main';
      return ctx.replyWithHTML(`<b>✅ E'loningiz joylashtirildi!</b>\nYo'nalish: ${ctx.session.data.from} → ${ctx.session.data.to}\nSana: ${ctx.session.data.date} (${ctx.session.data.time})\nNarxi: ${price} so'm`, Markup.inlineKeyboard([[Markup.button.callback('🏠 Bosh menyu', 'main_menu')]]));
    }
  } 
  else if (ctx.session.role === 'passenger') {
    if (ctx.session.step === 'passenger_listing_price') {
      const price = parseInt(text.replace(/\D/g, ''));
      if (isNaN(price) || price <= 0) return ctx.reply(`❌ Noto'g'ri qiymat! Raqamlarda kiriting.`);
      ctx.session.data.passPrice = price;
      
      const passRes = await pool.query('SELECT * FROM passengers WHERE id = $1', [ctx.from.id]);
      const passenger = passRes.rows[0] || { name: ctx.from.first_name, phone: '+998000000000' };
      
      const passListingId = Date.now();
      await pool.query(
        `INSERT INTO passenger_listings (id, passenger_id, passenger_name, passenger_phone, from_city, to_city, seats, date, price, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')`,
        [passListingId, ctx.from.id, passenger.name, passenger.phone, ctx.session.data.passFrom, ctx.session.data.passTo, ctx.session.data.passSeats, ctx.session.data.passDate, price]
      );

      ctx.session.step = 'passenger_main';
      return ctx.replyWithHTML(`<b>✅ Buyurtmangiz joylashtirildi!</b>\nYo'nalish: ${ctx.session.data.passFrom} → ${ctx.session.data.passTo}\nSana: ${ctx.session.data.passDate}\nTaklif narxi: ${price} so'm`, Markup.inlineKeyboard([[Markup.button.callback('🏠 Bosh menyu', 'main_menu')]]));
    }
  }
});

// ===== BOSH MENYU =====
bot.action('main_menu', (ctx) => {
  const role = ctx.session.role;
  if (role === 'driver') {
    safeEdit(ctx, `<b>🚗 Haydovchi menyusi</b>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback("🚗 E'lon qo'shish (Bo'sh o'rin)", 'driver_create_listing')],
      [Markup.button.callback("👥 Yo'lovchilar buyurtmasini ko'rish", 'driver_search_passengers')],
      [Markup.button.callback('❌ Chiqish', 'exit')]
    ]) });
  } else {
    safeEdit(ctx, `<b>👤 Yo'lovchi menyusi</b>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('🔍 Safar qidirish (Haydovchi topish)', 'passenger_search')],
      [Markup.button.callback("📝 E'lon berish (Buyurtma qoldirish)", 'passenger_create_listing')],
      [Markup.button.callback('❌ Chiqish', 'exit')]
    ]) });
  }
});

bot.action('exit', (ctx) => {
  sessions.delete(ctx.from.id);
  ctx.deleteMessage().catch(()=>{});
  ctx.reply('Xayr! 👋', Markup.removeKeyboard());
});

// ===== WEB ADMIN PANEL ROUTES =====
app.get('/admin', async (req, res) => {
  try {
    const driversRes = await pool.query('SELECT * FROM drivers ORDER BY created_at DESC');
    const passengersRes = await pool.query('SELECT * FROM passengers ORDER BY created_at DESC');
    const listingsRes = await pool.query('SELECT * FROM listings ORDER BY created_at DESC');
    const passListingsRes = await pool.query('SELECT * FROM passenger_listings ORDER BY created_at DESC');

    const DB = {
      drivers: driversRes.rows,
      passengers: passengersRes.rows,
      listings: listingsRes.rows.map(l => ({
        ...l,
        from: l.from_city,
        to: l.to_city,
        seatsAvailable: l.seats_available,
        driverName: l.driver_name,
        driverPhone: l.driver_phone,
        driverRating: l.driver_rating,
        carType: l.car_type,
        licensePlate: l.license_plate
      })),
      passengerListings: passListingsRes.rows.map(l => ({
        ...l,
        from: l.from_city,
        to: l.to_city,
        passengerName: l.passenger_name,
        passengerPhone: l.passenger_phone
      })),
      matches: []
    };

    res.render('admin', { DB });
  } catch (err) {
    console.error(err);
    res.status(500).send("Bazadan ma'lumotlarni o'qishda xatolik yuz berdi");
  }
});

app.post('/admin/listing/delete/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  await pool.query('DELETE FROM listings WHERE id = $1', [id]);
  res.redirect('/admin');
});

app.post('/admin/broadcast', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.redirect('/admin');

  try {
    const drivers = await pool.query('SELECT DISTINCT id FROM drivers');
    const passengers = await pool.query('SELECT DISTINCT id FROM passengers');

    const userIds = new Set();
    drivers.rows.forEach(row => userIds.add(row.id));
    passengers.rows.forEach(row => userIds.add(row.id));

    for (const chatId of userIds) {
      try {
        await bot.telegram.sendMessage(chatId, `📢 **Adminstratsiyadan xabar:**\n\n${message}`, { parse_mode: 'Markdown' });
      } catch (err) {
        console.error(`Xabar yuborilmadi (${chatId}):`, err.message);
      }
    }

    res.redirect('/admin');
  } catch (err) {
    console.error('Broadcast xatoligi:', err);
    res.status(500).send('Xabar yuborishda xatolik yuz berdi');
  }
});

// ===== LAUNCH BOTH =====
bot.launch().then(() => {
  console.log('🤖 Telegram Bot ishga tushdi!');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Veb Admin Panel ishga tushdi: port ${PORT}`);
});

process.once('SIGINT', () => {
  bot.stop('SIGINT');
  process.exit(0);
});
process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  process.exit(0);
});
