require('dotenv').config();
const path = require('path');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

const JWT_SECRET = process.env.JWT_SECRET || '';
if (isProd && !JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production (see .env.example)');
}

module.exports = {
  NODE_ENV,
  isProd,
  PORT: parseInt(process.env.PORT, 10) || 3000,
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, 'data', 'tokenwars.db'),
  JWT_SECRET: JWT_SECRET || 'dev-only-insecure-secret-change-me',
  JWT_EXPIRES: process.env.JWT_EXPIRES || '7d',
  SERVER_URL: process.env.SERVER_URL || 'http://localhost:3000',
  START_EMBEDDED_SERVER: process.env.START_EMBEDDED_SERVER === '1',
};
