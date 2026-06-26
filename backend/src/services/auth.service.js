// backend/src/services/auth.service.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const CryptoUtil = require('../utils/crypto');
const keyManager = require('../config/keys');
const sqliteClient = require('../data/sqlite.client');
const redisClient = require('../data/redis.client');
const env = require('../config/env');

class AuthService {
  /**
   * 管理员登录验证与 Token 签发
   */
  async login(username, password) {
    const admin = await sqliteClient.get('SELECT id, password_hash, status FROM sys_admins WHERE username = ?', [username]);
    
    if (!admin) {
      throw this._buildBizError(400, 40400, '账号或密码错误');
    }
    
    if (admin.status === 0) {
      throw this._buildBizError(403, 40300, '该管理员账号已被封禁');
    }

    const isValid = await CryptoUtil.verifyHash(admin.password_hash, password);
    if (!isValid) {
      throw this._buildBizError(400, 40000, '账号或密码错误');
    }

    // 生成唯一 JTI 并签发 RS256 JWT
    const jti = crypto.randomUUID();
    const token = jwt.sign(
      { adminId: admin.id },
      keyManager.privateKey,
      {
        algorithm: 'RS256',
        expiresIn: env.JWT_EXPIRES_IN,
        jwtid: jti
      }
    );

    return { token, adminId: admin.id, username };
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