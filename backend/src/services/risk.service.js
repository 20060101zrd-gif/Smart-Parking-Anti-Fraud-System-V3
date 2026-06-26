// backend/src/services/risk.service.js
const CryptoUtil = require('../utils/crypto');
const redisClient = require('../data/redis.client');
const sqliteClient = require('../data/sqlite.client');

class RiskService {
  constructor() {
    this.BLACKLIST_TTL_SECONDS = 90 * 24 * 60 * 60; // 90天 (7776000秒)
  }

  /**
   * 注册与领券风控校验
   */
  async checkAndRegister(phone, name, deviceId) {
    const probeKey = `risk:hash_bl:${phone}`;

    const isBanned = await redisClient.get(probeKey);
    if (isBanned) {
      throw this._buildBizError(403, 40300, '发放拦截：命中历史注销库');
    }

    // ========== 检查是否已注册 ==========
    const registeredKey = `user:registered:${phone}`;
    const isRegistered = await redisClient.get(registeredKey);
    console.log('[调试] 查已注册标记 -> key:', registeredKey, '值:', isRegistered);

    if (isRegistered) {
      console.log('[调试] 命中已注册缓存，直接返回');
      return { hasCoupon: true, isExisting: true };
    }
    // ========== 新增结束 ==========

    // 未命中黑名单，执行常规业务逻辑...
    const mockUserId = Math.floor(Math.random() * 100000);

    // ========== 注册成功后标记已注册 ==========
    const setResult = await redisClient.set(registeredKey, '1', 30 * 24 * 60 * 60);
    console.log('[调试] 写入注册标记 -> key:', registeredKey, 'set返回:', setResult);
    const verifyValue = await redisClient.get(registeredKey);
    console.log('[调试] 写完立刻回读验证 -> 值:', verifyValue);
    // ========== 新增结束 ==========

    return { userId: mockUserId, hasCoupon: true };
  }

  /**
   * 账号注销沉淀与物理擦除 (🛡️ 增强版：带 IP 慢速防刷盾)
   */
  async cancelAccount(phone, ipAddress = 'unknown_ip') {
    // 🛡️ 1. 滑动窗口限流防线：同一 IP 10 分钟内最多允许 3 次注销请求
    const rateLimitKey = `risk:ratelimit:cancel:${ipAddress}`;
    
    const requestCount = await redisClient.incr(rateLimitKey);
    if (requestCount === 1) {
      // 首次访问，设置 600 秒（10分钟）的过期时间
      await redisClient.expire(rateLimitKey, 600);
    }

    if (requestCount > 3) {
      console.warn(`[RiskService] 拦截到异常注入攻击，封堵 IP: ${ipAddress}`);
      throw this._buildBizError(429, 42900, '操作过于频繁，触发安全熔断，请稍后再试');
    }

    // 2. 生成基于 Argon2id 的不可逆持久化指纹
    const rawFactor = CryptoUtil.buildUserFactor(phone);
    const fingerprint = await CryptoUtil.generateHash(rawFactor);
    const phoneMask = phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
    const expireDate = new Date(Date.now() + this.BLACKLIST_TTL_SECONDS * 1000).toISOString();
    
    await redisClient.del(`user:registered:${phone}`);
    
    // 3. 双写策略：写入 Redis 高速拦截层
    const probeKey = `risk:hash_bl:${phone}`;
    await redisClient.set(probeKey, '1', this.BLACKLIST_TTL_SECONDS);
    
    // 4. 双写策略：写入 SQLite 归档层
    try {
      await sqliteClient.run(
        `INSERT INTO risk_hash_archives (fingerprint, phone_mask, expires_at) VALUES (?, ?, ?)`,
        [fingerprint, phoneMask, expireDate]
      );
    } catch (err) {
      console.error('[RiskService] 写入历史归档失败:', err.message);
    }

    return true;
  }

  /**
   * 风控黑名单解封
   */
  async unbanUser(fingerprint, targetPhoneForProbe) {
    if (targetPhoneForProbe) {
      await redisClient.del(`risk:hash_bl:${targetPhoneForProbe}`);
    }
    try {
      await sqliteClient.run(`DELETE FROM risk_hash_archives WHERE fingerprint = ?`, [fingerprint]);
    } catch (err) {
      throw this._buildBizError(500, 50000, '解封操作失败，归档数据库异常');
    }
    return true;
  }

  _buildBizError(statusCode, code, message) {
    const err = new Error(message);
    err.isBusinessError = true;
    err.statusCode = statusCode;
    err.code = code;
    return err;
  }
}

module.exports = new RiskService();