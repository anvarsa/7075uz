const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const initDb = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drivers (
      id BIGINT PRIMARY KEY,
      username VARCHAR(255),
      name VARCHAR(255),
      phone VARCHAR(50),
      car_type VARCHAR(100),
      baggage VARCHAR(100),
      license_plate VARCHAR(50),
      rating INT DEFAULT 5,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS passengers (
      id BIGINT PRIMARY KEY,
      username VARCHAR(255),
      name VARCHAR(255),
      phone VARCHAR(50),
      rating INT DEFAULT 5,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS listings (
      id BIGINT PRIMARY KEY,
      driver_id BIGINT,
      driver_name VARCHAR(255),
      driver_phone VARCHAR(50),
      driver_rating INT,
      car_type VARCHAR(100),
      license_plate VARCHAR(50),
      from_city VARCHAR(100),
      to_city VARCHAR(100),
      seats INT,
      seats_available INT,
      date VARCHAR(50),
      time VARCHAR(50),
      price INT,
      status VARCHAR(50) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS passenger_listings (
      id BIGINT PRIMARY KEY,
      passenger_id BIGINT,
      passenger_name VARCHAR(255),
      passenger_phone VARCHAR(50),
      from_city VARCHAR(100),
      to_city VARCHAR(100),
      seats INT,
      price INT,
      status VARCHAR(50) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('🗄️ PostgreSQL jadvallari tayyor!');
};

initDb().catch(err => console.error('DB xatosi:', err));

module.exports = pool;