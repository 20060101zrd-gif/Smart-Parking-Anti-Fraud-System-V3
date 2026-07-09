// backend/src/services/risk.service.js
const CryptoUtil = require('../utils/crypto');
const encryption = require('../utils/encryption');
const redisClient = require('../data/redis.client');
const db = require('../data/mysql.client');
const interceptLog = require('./intercept-log.service');
const whitelistService = require('./whitelist.service');
const configService = require('./config.service');
const logger = require('../utils/logger');

class RiskService {
  constructor() {
    this.BLACKLIST_TTL_SECONDS = 90 * 24 * 60 * 60; // 90天 (7776000秒)
    // ── IP临时黑名单 & 验证失败追踪 ──
    this.IP_BLACKLIST_TTL = 60;                       // 默认 1 分钟封禁（可通过面板调整 ip_blocklist_ttl_hours）
    this.CAPTCHA_FAIL_WINDOW = 10 * 60;              // 10分钟失败计数窗口
    this.CAPTCHA_FAIL_MAX = 3;                       // 连续失败3次触发拉黑
    // 🆕 内存降级（Redis 不可用时）
    this._memHashBl    = new Set();  // phone blacklist
    this._memDeviceBl   = new Set();  // device blacklist
    this._memIpBl       = new Map();  // IP blacklist → reason
    this._memCaptchaFail = new Map(); // IP → fail count
    this._memCancelCount = new Map(); // IP → cancel count
    this._memTimers     = new Map();  // TTL cleanup timers
  }

  _memSetWithTTL(key, value, ttlSeconds) {
    const v = value === true ? true : value;
    // ip_bl map
    if (this._memIpBl.has(key)) {
      this._memIpBl.set(key, v);
    } else {
      this._memIpBl.set(key, v);
    }
    // cancel count
    const oldTimer = this._memTimers.get(key);
    if (oldTimer) clearTimeout(oldTimer);
    this._memTimers.set(key, setTimeout(() => {
      this._memIpBl.delete(key);
      this._memTimers.delete(key);
    }, ttlSeconds * 1000));
  }

  /**
   * 注册与领券风控校验 — 三级风险分级处置
   * @param {String} phone    手机号
   * @param {String} name     姓名
   * @param {String} deviceId 设备指纹（可选）
   * @param {String} ip       客户端IP（可选）
   */
  async checkAndRegister(phone, name, deviceId, ip, req = {}) {
    // ═══════════════════════════════════════════════
    // ⬜ 白名单放行：优先读取 rateLimiter 中间件已缓存的结果，避免重复 Redis 查询
    // ═══════════════════════════════════════════════
    const isWhitelisted = req._isWhitelisted === true || await whitelistService.isWhitelisted(ip, deviceId);
    if (isWhitelisted) {
      logger.debug({ ip, deviceId: (deviceId || '').substring(0, 12) }, '白名单放行');
      // 直接走正常注册流程
      const registeredKey = `user:registered:${phone}`;
      const isRegistered = await redisClient.get(registeredKey);
      if (isRegistered) return { hasCoupon: true, isExisting: true };
      const mockUserId = Math.floor(Math.random() * 100000);
      await redisClient.set(registeredKey, '1', 30 * 24 * 60 * 60);
      // 🆕 白名单放行路径也写入 MySQL
      try {
        const encryptedPhone = encryption.encrypt(phone);
        const phoneHash = encryption.hashPhone(phone);
        await db.run(
          `INSERT INTO sys_users (phone, phone_hash, device_hash, name, status)
           VALUES (?, ?, ?, ?, 1)`,
          [encryptedPhone, phoneHash, deviceId || '', name]
        );
      } catch (err) { /* 非阻塞 */ }
      return { userId: mockUserId, hasCoupon: true };
    }

    // ═══════════════════════════════════════════════
    // 🔴 高风险检测-1：设备指纹在90天黑名单内
    // ═══════════════════════════════════════════════
    if (deviceId) {
      const deviceBlKey = `risk:device_bl:${deviceId}`;
      let isDeviceBanned = await redisClient.get(deviceBlKey);
      // 🆕 Redis 降级 → 内存检查
      if (!isDeviceBanned && !redisClient.isReady && this._memDeviceBl.has(deviceId)) {
        isDeviceBanned = '1'; // simulate found
      }
      if (isDeviceBanned) {
        logger.warn({ deviceId: deviceId.substring(0, 16), ip }, '高风险拦截 → 设备指纹黑名单命中');
        interceptLog.logIntercept(ip, deviceId, '设备指纹在90天黑名单内', 'HIGH');
        throw this._buildBizError(403, 40301, '风控拦截：设备存在高风险特征，注册已被拒绝');
      }
    }

    // ═══════════════════════════════════════════════
    // 🟡 中风险检测-2：单设备注册数量上限（从风控规则配置面板动态读取）
    // ═══════════════════════════════════════════════
    if (deviceId) {
      try {
        const cfg = await configService.getAll();
        const deviceLimit = cfg.device_register_limit || 3;
        const row = await db.get(
          `SELECT COUNT(*) AS cnt FROM sys_users WHERE device_hash = ? AND status = 1`,
          [deviceId]
        );
        if (row && row.cnt >= deviceLimit) {
          logger.warn({ deviceId: deviceId.substring(0, 16), cnt: row.cnt, limit: deviceLimit, ip }, '中风险拦截 → 单设备注册超限');
          interceptLog.logIntercept(ip, deviceId, `单设备注册超限 (${row.cnt}/${deviceLimit})`, 'MEDIUM');
          throw this._buildBizError(403, 40301, '风控拦截：当前设备关联账号已超限，该设备注册的活跃账号数量已达上限');
        }
      } catch (err) {
        if (err.isBusinessError) throw err;
        logger.warn({ err: err.message }, '设备注册计数查询失败，降级放行');
      }
    }

    // ═══════════════════════════════════════════════
    // 🔴 高风险检测-3：手机号命中历史注销沉淀库（基于 SHA256 phone_hash）
    // ═══════════════════════════════════════════════
    const phoneHash = encryption.hashPhone(phone);
    const probeKey = `risk:hash_bl:${phoneHash}`;
    let isBanned = await redisClient.get(probeKey);
    // 🆕 Redis 降级 → 内存检查
    if (!isBanned && !redisClient.isReady && this._memHashBl.has(phoneHash)) {
      isBanned = '1';
    }
    // 🆕 MySQL 兜底：用 phone_hash (SHA256) 精确匹配历史注销沉淀库
    if (!isBanned) {
      try {
        const dbBl = await db.get(
          `SELECT 1 AS hit FROM phone_blacklist_map WHERE phone_hash = ? AND expires_at > NOW() LIMIT 1`,
          [phoneHash]
        );
        if (dbBl) {
          isBanned = '1';
          logger.warn({ phoneHash: phoneHash.substring(0, 12) }, '高风险拦截 → 历史注销库命中（MySQL 兜底）');
        }
      } catch (e) { /* 非阻塞 */ }
    }
    if (isBanned) {
      logger.warn({ phone: phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') }, '高风险拦截 → 手机号命中历史注销库');
      interceptLog.logIntercept(ip, deviceId, '手机号命中历史注销沉淀库', 'HIGH');
      throw this._buildBizError(403, 40300, '风控拦截：命中历史注销库');
    }

    // ═══════════════════════════════════════════════
    // 🟢 低风险：无异常特征，正常执行注册/领券业务
    //    注：IP维度频控已移至 rateLimiter('reg_ip') 中间件处理
    // ═══════════════════════════════════════════════
    logger.debug('低风险放行 → 设备指纹与手机号均无异常特征');

    // 检查是否已注册（Redis 缓存命中则直接返回）
    const registeredKey = `user:registered:${phone}`;
    const isRegistered = await redisClient.get(registeredKey);

    if (isRegistered) {
      return { hasCoupon: true, isExisting: true };
    }

    // 未命中黑名单，执行常规业务逻辑
    const mockUserId = Math.floor(Math.random() * 100000);

    // 注册成功后标记已注册（30天过期）
    await redisClient.set(registeredKey, '1', 30 * 24 * 60 * 60);

    // 🆕 异步写入 MySQL 用户表（手机号 AES 加密 + SHA256 哈希）
    try {
      const encryptedPhone = encryption.encrypt(phone);
      const phoneHash = encryption.hashPhone(phone);
      await db.run(
        `INSERT INTO sys_users (phone, phone_hash, device_hash, name, status)
         VALUES (?, ?, ?, ?, 1)`,
        [encryptedPhone, phoneHash, deviceId || '', name]
      );
      logger.debug({ phoneHash: phoneHash.substring(0, 8) }, '用户已写入 MySQL');
    } catch (err) {
      console.error('[RiskService] MySQL 写入用户失败（不影响注册主流程）:', err.message);
    }

    return { userId: mockUserId, hasCoupon: true };
  }

  /**
   * 账号注销沉淀与物理擦除 (🛡️ 增强版：带 IP 慢速防刷盾 + 设备指纹拉黑)
   * @param {String} phone     手机号
   * @param {String} ipAddress 客户端IP
   * @param {String} deviceId  设备指纹（可选，用于同步拉黑设备）
   */
  async cancelAccount(phone, ipAddress = 'unknown_ip', deviceId = '') {
    // 🆕 注销次数上限变量（函数级作用域，白名单/非白名单路径均可用）
    let cancelLimit = 1;
    let currentCancelCount = 0;

    // ⬜ 白名单放行：IP/设备在白名单中，跳过注销频控和注销次数限制
    if (await whitelistService.isWhitelisted(ipAddress, deviceId)) {
      console.log(`[RiskService] ⬜ 白名单放行 cancel ip=${ipAddress} deviceId=${(deviceId || '').substring(0, 12)}...`);
    } else {
      // 🛡️ 1. 滑动窗口限流防线：同一 IP 10 分钟内最多允许 20 次注销请求
      const rateLimitKey = `risk:ratelimit:cancel:${ipAddress}`;

      // 🆕 Redis 降级 → 内存计数器
      if (!redisClient.isReady) {
        const entry = this._memCancelCount.get(ipAddress) || { count: 0, expiresAt: 0 };
        if (Date.now() >= entry.expiresAt) {
          entry.count = 1;
          entry.expiresAt = Date.now() + 600 * 1000;
        } else {
          entry.count++;
        }
        this._memCancelCount.set(ipAddress, entry);
        if (entry.count > 20) {
          console.warn(`[RiskService] 拦截请求，封堵 IP: ${ipAddress} [内存]`);
          interceptLog.logIntercept(ipAddress, deviceId, '注销请求频率超限（10分钟>20次）', 'MEDIUM');
          throw this._buildBizError(429, 42900, '操作过于频繁，触发安全熔断，请稍后再试');
        }
      } else {
        const requestCount = await redisClient.incr(rateLimitKey);
        if (requestCount === 1) {
          await redisClient.expire(rateLimitKey, 600);
        }
        if (requestCount > 20) {
          console.warn(`[RiskService] 拦截到异常注入攻击，封堵 IP: ${ipAddress}`);
          interceptLog.logIntercept(ipAddress, deviceId, '注销请求频率超限（10分钟>20次）', 'MEDIUM');
          throw this._buildBizError(429, 42900, '操作过于频繁，触发安全熔断，请稍后再试');
        }
      }


      // 🆕 2. 设备注销次数上限检查（从风控规则配置面板动态读取）
      if (deviceId) {
        try {
          const cfg = await configService.getAll();
          cancelLimit = cfg.device_cancel_limit || 1;
          const cancelCountKey = `risk:cancel_count:device:${deviceId}`;
          if (!redisClient.isReady) {
            const entry = this._memCancelCount.get(`device:${deviceId}`) || { count: 0 };
            entry.count++;
            this._memCancelCount.set(`device:${deviceId}`, entry);
            currentCancelCount = entry.count;
          } else {
            currentCancelCount = await redisClient.incr(cancelCountKey);
            if (currentCancelCount === 1) {
              await redisClient.expire(cancelCountKey, this.BLACKLIST_TTL_SECONDS);
            }
          }
          // 🆕 注销次数达到上限时自动拉黑设备（不拦截本次注销，仅阻止未来注册）
          if (currentCancelCount >= cancelLimit) {
            logger.warn({ deviceId: deviceId.substring(0, 16), cancelCount: currentCancelCount, limit: cancelLimit, ip: ipAddress }, '设备注销次数达标 → 自动拉黑设备');
            await this._blacklistDevice(deviceId, deviceId, '注销次数达标自动拉黑');
          }
        } catch (err) {
          if (err.isBusinessError) throw err;
          logger.warn({ err: err.message }, '设备注销计数查询失败，降级放行');
        }
      }
    }

    // 3. 生成快速 SHA-256 持久化指纹（避免 Argon2id 阻塞事件循环）
    const crypto = require('crypto');
    const factor = CryptoUtil.buildUserFactor(phone, deviceId || '');
    const fingerprint = crypto.createHash('sha256').update(factor).digest('hex');
    const phoneHash = encryption.hashPhone(phone);
    const expireDate = new Date(Date.now() + this.BLACKLIST_TTL_SECONDS * 1000).toISOString().slice(0, 19).replace('T', ' ');
    
    await redisClient.del(`user:registered:${phone}`);
    
    // 4. 双写策略：Redis 高速拦截层使用 phone_hash 作为 key
    const probeKey = `risk:hash_bl:${phoneHash}`;
    const redisBlOk = await redisClient.set(probeKey, fingerprint, this.BLACKLIST_TTL_SECONDS);

    // 🆕 Redis 降级 → 内存缓存
    if (!redisBlOk) {
      this._memHashBl.add(phoneHash);
      console.log(`[RiskService] ⚠️ Redis 不可用，内存标记 phone_hash=${phoneHash.substring(0, 12)}...`);
    }


    // 5. 双写策略：写入 MySQL 归档层（phone_hash 精确匹配）
    try {
      // 写入风险哈希归档表（保留fingerprint用于旧逻辑兼容，存储phone_hash用于快速匹配）
      await db.run(
        `INSERT INTO risk_hash_archives (fingerprint, phone_hash, phone_mask, expires_at) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE phone_hash = VALUES(phone_hash), phone_mask = VALUES(phone_mask), expires_at = VALUES(expires_at)`,
        [fingerprint, phoneHash, '', expireDate]
      );
      // 🆕 写入手机号黑名单映射表（phone_hash → 反向查找用，不存储任何手机号明文/脱敏信息）
      await db.run(
        `INSERT INTO phone_blacklist_map (phone_hash, fingerprint, phone_mask, expires_at) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE fingerprint = VALUES(fingerprint), phone_mask = VALUES(phone_mask), expires_at = VALUES(expires_at)`,
        [phoneHash, fingerprint, '', expireDate]
      );
      // 🆕 合规擦除：从 sys_users 物理删除该用户记录（仅保留 phone_hash 于黑名单归档）
      await db.run(
        `DELETE FROM sys_users WHERE phone_hash = ?`,
        [phoneHash]
      );
    } catch (err) {
      console.error('[RiskService] 写入历史归档失败:', err.message);
    }

    return true;
  }

  /**
   * 🆕 记录滑块验证失败，连续失败达阈值自动加入 IP 临时黑名单
   * @param {String} ip 客户端 IP
   * @returns {Number} 当前失败次数
   */
  async recordCaptchaFailure(ip) {
    if (!ip) return 0;

    // 🆕 从风控规则配置面板动态读取阈值
    let captchaFailMax = this.CAPTCHA_FAIL_MAX;
    let ipBlTtl = this.IP_BLACKLIST_TTL;
    try {
      const cfg = await configService.getAll();
      captchaFailMax = cfg.captcha_fail_max || 3;
      ipBlTtl = (cfg.ip_blocklist_ttl_hours || 24) * 3600;
    } catch {}

    // 🆕 Redis 降级 → 内存计数器
    if (!redisClient.isReady) {
      const entry = this._memCaptchaFail.get(ip) || { count: 0 };
      entry.count++;
      this._memCaptchaFail.set(ip, entry);
      const c = entry.count;
      console.warn(`[RiskService] IP ${ip} 滑块验证失败 (${c}/${captchaFailMax}) [内存]`);
      if (c >= captchaFailMax) {
        this._memSetWithTTL(`ipbl:${ip}`, `captcha_fail_x${c}`, ipBlTtl);
        interceptLog.logIntercept(ip, '', `连续${c}次滑块验证失败，自动加入IP临时黑名单`, 'MEDIUM');
      }
      return c;
    }

    const failKey = `risk:captcha_fail:${ip}`;
    const fullKey = `${redisClient.prefix}${failKey}`;

    try {
      const count = await redisClient.client.incr(fullKey);
      if (count === 1) {
        await redisClient.client.expire(fullKey, this.CAPTCHA_FAIL_WINDOW);
      }
      console.warn(`[RiskService] IP ${ip} 滑块验证失败 (${count}/${captchaFailMax})`);
      if (count >= captchaFailMax) {
        await redisClient.set(`risk:ip_bl:${ip}`, `captcha_fail_x${count}`, ipBlTtl);
        console.warn(`[RiskService] ⛔ IP ${ip} 连续${count}次验证失败，已自动加入临时黑名单`);
        interceptLog.logIntercept(ip, '', `连续${count}次滑块验证失败，自动加入IP临时黑名单`, 'MEDIUM');
      }
      return count;
    } catch (err) {
      console.error('[RiskService] 验证失败计数异常:', err.message);
      return 0;
    }
  }

  async recordCaptchaSuccess(ip) {
    if (!ip) return;
    // 🆕 内存降级清理
    if (!redisClient.isReady) { this._memCaptchaFail.delete(ip); return; }
    await redisClient.del(`risk:captcha_fail:${ip}`);
    console.log(`[RiskService] IP ${ip} 验证成功，失败计数已清零`);
  }

  async isIpBlacklisted(ip) {
    if (!ip) return false;
    const redisVal = await redisClient.get(`risk:ip_bl:${ip}`);
    if (redisVal) return true;
    // 🆕 内存降级
    if (!redisClient.isReady) return this._memIpBl.has(`ipbl:${ip}`);
    return false;
  }

  async clearIpBlacklist(ip) {
    if (!ip) return false;
    // 🆕 内存降级清理
    this._memIpBl.delete(`ipbl:${ip}`);
    const deleted = await redisClient.del(`risk:ip_bl:${ip}`);
    console.log(`[RiskService] 🔓 IP 临时黑名单已解除: ${ip}`);
    return deleted;
  }

  /**
   * 风控黑名单解封
   */
  async unbanUser(fingerprint, targetPhoneForProbe) {
    // 🆕 清除 Redis 手机号哈希黑名单
    if (targetPhoneForProbe) {
      await redisClient.del(`risk:hash_bl:${targetPhoneForProbe}`);
    }
    // 🆕 清除 Redis 设备黑名单（直接用 fingerprint 作为 key）
    try {
      await redisClient.del(`risk:device_bl:${fingerprint}`);
    } catch (err) { /* Redis 不可用 */ }
    try {
      await db.run(`DELETE FROM risk_hash_archives WHERE fingerprint = ?`, [fingerprint]);
      // 🆕 同步清理 sys_blacklist 中匹配该设备指纹的行
      await db.run(`DELETE FROM sys_blacklist WHERE device_fingerprint = ?`, [fingerprint]).catch(() => {});
      // 🆕 同步清理 sys_blacklist 中通过 phone_hash 关联的旧数据
      await db.run(`DELETE FROM sys_blacklist WHERE phone_hash IN (SELECT phone_hash FROM sys_users WHERE device_hash = ?)`, [fingerprint]).catch(() => {});
    } catch (err) {
      throw this._buildBizError(500, 50000, '解封操作失败，归档数据库异常');
    }
    return true;
  }

  /** 🆕 设备黑名单写入（Redis + MySQL 双写），供正常注销和超限拦截共用 */
  async _blacklistDevice(deviceId, phoneHash, reason) {
    const devOk = await redisClient.set(`risk:device_bl:${deviceId}`, '1', this.BLACKLIST_TTL_SECONDS);
    if (!devOk) {
      this._memDeviceBl.add(deviceId);
    }
    try {
      await db.run(
        `INSERT INTO sys_blacklist (device_fingerprint, phone_hash, reason, created_at) VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE phone_hash = VALUES(phone_hash), reason = VALUES(reason), created_at = VALUES(created_at)`,
        [deviceId, phoneHash, reason]
      );
    } catch (e) {
      console.error('[RiskService] 写入 sys_blacklist 失败（非阻塞）:', e.message);
    }
  }

  _buildBizError(statusCode, code, message) {
    const err = new Error(message);
    err.isBusinessError = true;
    err.statusCode = statusCode;
    err.code = code;
    return err;
  }

  /**
   * 🆕 通过手机号明文查询用户记录（自动解密 phone 字段）
   * @param {String} phone 手机号明文
   * @returns {Object|null} 用户记录（phone 字段已解密为明文）
   */
  async findUserByPhone(phone) {
    const phoneHash = encryption.hashPhone(phone);
    const row = await db.get(
      `SELECT id, phone, phone_hash, device_hash, name, status, registered_at, cancelled_at
       FROM sys_users WHERE phone_hash = ?`,
      [phoneHash]
    );
    if (!row) return null;
    // 解密 phone 字段，对业务层透明
    try {
      row.phone = encryption.decrypt(row.phone);
    } catch (err) {
      console.error('[RiskService] 解密手机号失败:', err.message);
    }
    return row;
  }
}

module.exports = new RiskService();