// backend/src/utils/logger.js
// 结构化日志 — 开发环境 pretty-print，生产环境输出 JSON
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(process.env.NODE_ENV === 'production'
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});

module.exports = logger;
