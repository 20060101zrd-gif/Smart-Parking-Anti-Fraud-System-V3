// backend/src/middlewares/redisBlacklist.js
const redisClient = require('../data/redis.client');
const { fail } = require('../utils/response');

const redisBlacklist = async (req, res, next) => {
  // 前置依赖 jwtAuth，确保 req.admin 中已存在 jti
  if (!req.admin || !req.admin.jti) {
    return fail(res, 401, 40100, '鉴权异常：无效的凭证标识');
  }

  // 🆕 Redis 不可用时降级放行（开发/测试环境，避免所有管理接口 50000）
  if (!redisClient.isReady) {
    console.warn('[RedisBlacklist] ⚠️ Redis 不可用，降级放行管理接口');
    return next();
  }

  try {
    // 查询 Redis 中是否存在该 JTI 对应的黑名单记录
    const isBlacklisted = await redisClient.get(`auth:jwt_revoked:${req.admin.jti}`);
    
    if (isBlacklisted) {
      return fail(res, 401, 40101, '您的账号凭证已被主动吊销，请重新登录');
    }
    
    next();
  } catch (err) {
    console.error('[RedisBlacklist] 黑名单校验查询失败:', err.message);
    return fail(res, 500, 50000, '鉴权服务内部错误');
  }
};

module.exports = redisBlacklist;