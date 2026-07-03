// backend/src/routes/index.js
const express = require('express');
const router = express.Router();
const net = require('net');
const env = require('../config/env');
const redisClient = require('../data/redis.client');
const mysqlClient = require('../data/mysql.client');

const userRoutes    = require('./v1/user.routes');
const adminRoutes   = require('./v1/admin.routes');
const captchaRoutes = require('./v1/captcha.routes');

// 存活探针 — 仅确认进程在运行
router.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

/**
 * MySQL 探针：建立 TCP 连接后等待 greeting 包
 * MySQL 协议在连接建立后会立即由服务端发送握手 greeting，
 * 若容器 pause 则 MySQL 进程冻结，greeting 永不发送 → timeout → down
 */
function probeMySQL(timeoutMs) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(t); s.destroy(); resolve(ok); };
    const t = setTimeout(() => finish(false), timeoutMs);
    s.on('data', () => finish(true));
    s.on('error', () => finish(false));
    s.connect(env.MYSQL_PORT, env.MYSQL_HOST);
  });
}

/**
 * Redis 探针：建立 TCP 连接后发送 PING，等待 +PONG
 * Docker pause 冻结 Redis 进程 → PING 无响应 → timeout → down
 */
function probeRedis(timeoutMs) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(t); s.destroy(); resolve(ok); };
    const t = setTimeout(() => finish(false), timeoutMs);
    s.on('data', () => finish(true));
    s.on('error', () => finish(false));
    s.on('connect', () => s.write('PING\r\n'));
    s.connect(env.REDIS_PORT, env.REDIS_HOST);
  });
}

// 记录上一次探针状态，用于检测「刚恢复」事件
let _prevMysqlUp = true;
let _prevRedisUp = true;

// 就绪探针 — 原生 TCP 探测，3s 硬超时
router.get('/health/ready', async (req, res) => {
  const TIMEOUT = 3000;
  const [mysqlAlive, redisAlive] = await Promise.all([
    probeMySQL(TIMEOUT),
    probeRedis(TIMEOUT),
  ]);
  const checks = {
    mysql: mysqlAlive ? 'up' : 'down',
    redis: redisAlive ? 'up' : 'down',
  };

  // ── 自动预热连接池：MySQL 刚从 down 恢复时，主动清除僵尸连接 ──
  if (mysqlAlive && !_prevMysqlUp) {
    console.log('🔄 [Health] MySQL 刚恢复，正在预热连接池...');
    mysqlClient.warmupPool().then(ok => {
      if (ok) console.log('✅ [Health] MySQL 连接池恢复');
      else console.warn('⚠️ [Health] MySQL 连接池恢复延迟');
    }).catch(() => {});
  }
  // ── Redis 恢复检测：触发 ping 重连 ──
  if (redisAlive && !_prevRedisUp) {
    console.log('🔄 [Health] Redis 刚恢复，正在触发重连...');
    redisClient.ping().then(ok => {
      if (ok) console.log('✅ [Health] Redis 连接恢复');
    }).catch(() => {});
  }

  _prevMysqlUp = mysqlAlive;
  _prevRedisUp = redisAlive;

  const allUp = mysqlAlive && redisAlive;
  return res.status(allUp ? 200 : 503).json({ status: allUp ? 'ok' : 'degraded', checks });
});

// 人机验证路由
router.use('/captcha', captchaRoutes);

// 挂载 C 端免鉴权业务路由
router.use('/user', userRoutes);

// 预留位置：挂载 B 端强管控业务路由
router.use('/admin', adminRoutes);

module.exports = router;