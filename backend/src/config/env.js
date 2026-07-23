// backend/src/config/env.js
const path = require('path');

// Docker 部署：信任 docker-compose 传入的环境变量，不加载任何 .env 文件
// 裸机开发：复制 backend/.env.example → backend/.env.local 并填入本地地址后启动
const isDocker = process.env.MYSQL_HOST && process.env.MYSQL_HOST !== '127.0.0.1';

if (!isDocker) {
  // 裸机开发：加载 .env.local 覆盖文件
  require('dotenv').config({ path: path.join(__dirname, '../../.env.local'), override: true });
  // 兜底尝试 .env（兼容旧版）
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  // 项目根目录 .env
  require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
}

/** 安全读取 env 字符串值，自动剥离意外包裹的引号（' " ） */
const str = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === null) return fallback;
  // 去掉两端引号（dotenv 在某些 OS/编码下会保留引号）
  let s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s || fallback;
};

const env = {
  // 服务基础配置
  PORT: parseInt(process.env.PORT, 10) || 3000,
  
  // Redis 配置
  REDIS_HOST: str('REDIS_HOST', '127.0.0.1'),
  REDIS_PORT: parseInt(process.env.REDIS_PORT, 10) || 6379,
  REDIS_PASSWORD: str('REDIS_PASSWORD', ''),

  // MySQL 数据库配置（替代 SQLite）
  MYSQL_HOST: str('MYSQL_HOST', '127.0.0.1'),
  MYSQL_PORT: parseInt(process.env.MYSQL_PORT, 10) || 3306,
  MYSQL_USER: str('MYSQL_USER', 'parking'),
  MYSQL_PASSWORD: str('MYSQL_ROOT_PASSWORD', ''),
  MYSQL_DATABASE: str('MYSQL_DATABASE', 'parking_fraud'),

  // 手机号加密密钥（AES）
  ENCRYPT_KEY: str('ENCRYPT_KEY', 'change-me-to-a-secure-random-key-32chars'),

  // 初始超级管理员配置 (一键部署初始化用)
  ADMIN_USERNAME: str('ADMIN_USERNAME', 'admin'),
  ADMIN_PASSWORD: str('ADMIN_PASSWORD', 'Admin@123'),

  // 安全与风控参数
  JWT_EXPIRES_IN: str('JWT_EXPIRES_IN', '2h'),
  JWT_EXPIRES_IN_SEC: parseInt(process.env.JWT_EXPIRES_IN_SEC, 10) || 7200,
  KEYS_DIR: str('KEYS_DIR') || path.join(__dirname, '../../.keys'),
};

// 关键参数非空校验（如果需要强制阻断，可在此处抛出 Error）
if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
  console.warn('⚠️ [ENV] 警告: 未检测到管理员账密配置，将使用默认弱密码，请勿用于生产环境！');
}

module.exports = env;
