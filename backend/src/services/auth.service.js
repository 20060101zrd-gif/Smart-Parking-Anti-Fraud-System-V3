// backend/src/services/auth.service.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const CryptoUtil = require('../utils/crypto');
const keyManager = require('../config/keys');
const db = require('../data/mysql.client');
const redisClient = require('../data/redis.client');
const env = require('../config/env');
const logger = require('../utils/logger');

class AuthService {
  /**
   * 管理员登录验证与 Token 签发
   */
  async login(username, password, ip) {
    const admin = await db.get('SELECT id, password_hash, status, role FROM sys_admins WHERE username = ?', [username]);
    
    if (!admin) {
      logger.warn({ username, reason: 'user_not_found' }, '管理员登录失败');
      throw this._buildBizError(400, 40400, '账号或密码错误');
    }
    
    if (admin.status === 0) {
      logger.warn({ username, reason: 'account_banned' }, '管理员登录失败');
      throw this._buildBizError(403, 40300, '该管理员账号已被封禁');
    }

    const isValid = await CryptoUtil.verifyHash(admin.password_hash, password);
    if (!isValid) {
      logger.warn({ username, reason: 'wrong_password' }, '管理员登录失败');
      throw this._buildBizError(400, 40000, '账号或密码错误');
    }

    // 生成唯一 JTI 并签发 RS256 JWT（包含角色信息）
    const jti = crypto.randomUUID();
    const token = jwt.sign(
      { adminId: admin.id, role: admin.role },
      keyManager.privateKey,
      {
        algorithm: 'RS256',
        expiresIn: env.JWT_EXPIRES_IN,
        jwtid: jti
      }
    );

    // 记录活跃会话到 Redis（用于管理员管理页面展示在线用户）
    try {
      if (redisClient.isReady) {
        const loginIp = ip || '0.0.0.0';
        await redisClient.set(`auth:session:${admin.id}:${jti}`, loginIp, env.JWT_EXPIRES_IN_SEC || 7200);
      }
    } catch (e) {
      logger.warn({ adminId: admin.id }, 'Redis 会话记录失败（非关键）');
    }

    // 更新最后登录 IP
    try {
      await db.run('UPDATE sys_admins SET last_login_ip = ? WHERE id = ?', [ip, admin.id]);
    } catch (e) {
      logger.warn({ adminId: admin.id }, '更新登录 IP 失败');
    }

    logger.info({ adminId: admin.id, username, role: admin.role }, '管理员登录成功');

    return { token, adminId: admin.id, username, role: admin.role };
  }

  /**
   * 清除活跃会话记录（登出时调用）
   */
  async clearSession(adminId, jti) {
    try {
      if (redisClient.isReady) {
        await redisClient.del(`auth:session:${adminId}:${jti}`);
      }
    } catch (e) {
      // 非关键操作，静默失败
    }
  }

  /**
   * 凭证主动吊销 (写入 Redis 黑名单)
   */
  async revokeToken(jti, expireAt, operatorAdminId = 'system') {
    // expireAt 为 JWT Payload 中的 exp (秒级时间戳)
    const currentSeconds = Math.floor(Date.now() / 1000);
    const ttlSeconds = expireAt - currentSeconds;

    if (ttlSeconds > 0) {
      // 写入 Redis，有效期严格绑定 JWT 剩余存活期
      const success = await redisClient.set(`auth:jwt_revoked:${jti}`, operatorAdminId, ttlSeconds);
      if (!success) {
        throw this._buildBizError(500, 50000, '吊销凭证失败，缓存服务异常');
      }
    }
    return true;
  }

  // 辅助方法：构建标准业务异常供全局拦截器捕获
  _buildBizError(statusCode, code, message) {
    const err = new Error(message);
    err.isBusinessError = true;
    err.statusCode = statusCode;
    err.code = code;
    return err;
  }
}

module.exports = new AuthService();