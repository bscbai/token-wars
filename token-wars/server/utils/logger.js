const pino = require('pino');
const config = require('../config');

const useTransport = config.NODE_ENV === 'development';

const logger = pino(
  useTransport
    ? {
        level: config.LOG_LEVEL,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : { level: config.LOG_LEVEL }
);

module.exports = logger;
