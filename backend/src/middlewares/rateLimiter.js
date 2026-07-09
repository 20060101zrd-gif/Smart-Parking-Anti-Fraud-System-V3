// backend/src/middlewares/rateLimiter.js
const redisClient = require('../data/redis.client');
const { fail } = require('../utils/response');
const interceptLog = require('../services/intercept-log.service');
const whitelistService = require('../services/whitelist.service');
const configService = require('../services/config.service');
const logger = require('../utils/logger');

/**
 * 提取客户端真实 IP（兼容 Nginx / CDN 反向代理）
 * 🆕 归一化 IPv4-mapped IPv6 地址（::ffff:x.x.x.x → x.x.x.x, ::1 → 127.0.0.1）
 */
const extractIp = (req) => {
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
  if (ip && ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
};

// 🆕 内存降级计数器（Redis 不可用时使用）
const _memoryCounters = new Map();
const _memoryTimers = new Map();
function _memoryIncr(key, windowSeconds) {
  const now = Date.now();
  let entry = _memoryCounters.get(key);
  if (!entry || now >= entry.expiresAt) {
    entry = { count: 1, expiresAt: now + windowSeconds * 1000 };
    _memoryCounters.set(key, entry);
  } else {
    entry.count++;
  }
  // 清理 timer
  const oldTimer = _memoryTimers.get(key);
  if (oldTimer) clearTimeout(oldTimer);
  _memoryTimers.set(key, setTimeout(() => {
    _memoryCounters.delete(key);
    _memoryTimers.delete(key);
  }, windowSeconds * 1000));
  return entry.count;
}
function _memoryGet(key) {
  const entry = _memoryCounters.get(key);
  if (!entry || Date.now() >= entry.expiresAt) return null;
  return entry;
}
function _memoryDel(key) {
  _memoryCounters.delete(key);
  const t = _memoryTimers.get(key);
  if (t) { clearTimeout(t); _memoryTimers.delete(key); }
}

/**
 * 工厂函数，生成指定类型的限流中间件
 * @param {String} type 限流策略类型
 *   - 'global_ip'    全局IP限流：10次/秒
 *   - 'phone'        手机号限流：1次/5秒
 *   - 'admin_ip'     管理后台IP限流：30次/分钟
 *   - 'ip_bl'        IP临时黑名单检查（无滑动窗口，仅查黑名单）
 *   - 'reg_ip'       注册IP限流：5次/分钟，超限触发中风险人机验证
 */
const rateLimiter = (type) => {
  return async (req, res, next) => {
    // ═══════════════════════════════════════════════
    // ⬜ 白名单放行：IP/设备在白名单中，跳过一切限流和黑名单
    // 🆕 结果挂到 req 上，避免 riskService 重复查询
    // ═══════════════════════════════════════════════
    if (redisClient.isReady) {
      try {
        const ip = extractIp(req);
        const deviceId = req.body?.deviceId || '';
        const isWhitelisted = await whitelistService.isWhitelisted(ip, deviceId);
        req._isWhitelisted = isWhitelisted;
        req._whitelistChecked = true;
        if (isWhitelisted) {
          return next();
        }
      } catch {
        req._whitelistChecked = false;
      }
    }

    // ── ip_bl 类型：纯黑名单查询，不依赖 Redis 可用性 ──
    if (type === 'ip_bl') {
      if (!redisClient.isReady) return next();
      try {
        const ip = extractIp(req);
        const isBlacklisted = await redisClient.get(`risk:ip_bl:${ip}`);
        if (isBlacklisted) {
          interceptLog.logIntercept(ip, '', 'IP命中24小时临时黑名单', 'HIGH');
          return fail(res, 403, 40302, 'IP已被临时封禁（24小时），请稍后再试');
        }
        return next();
      } catch (err) {
        console.error('[RateLimiter::ip_bl] 黑名单查询异常，降级放行:', err.message);
        return next();
      }
    }

    // ── 其余类型：Redis 不可用时改用内存计数器降级 ──
    const useMemoryFallback = !redisClient.isReady;

    let key, limit, windowSeconds, statusCode = 429, errorCode = 40029, errorMessage;

    // 匹配限流策略参数
    if (type === 'global_ip') {
      key = `limit:ip:${req.ip}`;
      limit = 10;
      windowSeconds = 1;
      errorMessage = '请求过于频繁，请稍后再试';
    } else if (type === 'phone') {
      const phone = req.body?.phone;
      if (!phone) return next();
      key = `limit:phone:${phone}`;
      limit = 1;
      windowSeconds = 5;
      errorMessage = '操作过于频繁，请5秒后再试';
    } else if (type === 'admin_ip') {
      key = `limit:admin_ip:${req.ip}`;
      limit = 120;
      windowSeconds = 60;
      errorMessage = '管理员接口请求超限，请稍后再试';
    } else if (type === 'reg_ip') {
      // 🆕 注册IP维度限流：1分钟N次（N 从风控规则配置面板动态读取），超限触发中风险人机验证（401而非429）
      let cfg;
      try { cfg = await configService.getAll(); } catch {}
      const ip = extractIp(req);
      key = `limit:reg_ip:${ip}`;
      limit = (cfg && cfg.ip_register_limit) || 5;
      windowSeconds = 60;
      statusCode = 401;
      errorCode = 40101;
      errorMessage = '操作频繁，需要人机验证，请完成滑块验证码';
    } else {
      return next();
    }

    // 🆕 内存降级路径
    if (useMemoryFallback) {
      const ip = extractIp(req);
      const current = _memoryIncr(key, windowSeconds);
      if (current > limit) {
        const riskLevel = type === 'reg_ip' ? 'MEDIUM' : 'LOW';
        interceptLog.logIntercept(ip, '', errorMessage, riskLevel);
        return fail(res, statusCode, errorCode, errorMessage);
      }
      return next();
    }

    try {
      const current = await redisClient.incr(key);

      if (current === 1) {
        await redisClient.expire(key, windowSeconds);
      }

      if (current > limit) {
        // 埋点拦截日志：根据限流类型区分风险等级
        const riskLevel = type === 'reg_ip' ? 'MEDIUM' : 'LOW';
        const ip = extractIp(req);
        logger.warn({ ip, type, limit, current, riskLevel }, '限流触发');
        interceptLog.logIntercept(ip, '', errorMessage, riskLevel);
        return fail(res, statusCode, errorCode, errorMessage);
      }

      next();
    } catch (err) {
      console.error('[RateLimiter] 计数异常，执行降级放行:', err.message);
      next();
    }
  };
};

module.exports = rateLimiter;