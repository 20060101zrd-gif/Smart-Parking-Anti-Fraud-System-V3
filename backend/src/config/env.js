// backend/src/config/env.js
require('dotenv').config();
const path = require('path');

const env = {
  // 服务基础配置
  PORT: parseInt(process.env.PORT, 10) || 3000,
  
  // Redis 配置
  REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
  REDIS_PORT: parseInt(process.env.REDIS_PORT, 10) || 6379,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
  
  // SQLite 数据库路径
  SQLITE_PATH: process.env.SQLITE_PATH || path.join(__dirname, '../../../database.sqlite'),
  
  // 初始超级管理员配置 (一键部署初始化用)
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'Admin@123',
  
  // 安全与风控参数
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '2h', // JWT 有效期
  KEYS_DIR: process.env.KEYS_DIR || path.join(__dirname, '../../.keys'), // RS256 密钥对存放目录
};

// 关键参数非空校验（如果需要强制阻断，可在此处抛出 Error）
if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
  console.warn('⚠️ [ENV] 警告: 未检测到管理员账密配置，将使用默认弱密码，请勿用于生产环境！');
}

module.exports = env;