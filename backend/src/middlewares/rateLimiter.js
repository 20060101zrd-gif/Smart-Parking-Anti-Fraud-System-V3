// backend/src/middlewares/rateLimiter.js
const redisClient = require('../data/redis.client');
const { fail } = require('../utils/response');

/**
 * 工厂函数，生成指定类型的限流中间件
 * @param {String} type 限流策略类型 ('global_ip', 'phone', 'admin_ip')
 */
const rateLimiter = (type) => {
  return async (req, res, next) => {
    // 降级策略：如果 Redis 处于异常断开状态，为避免阻塞，直接放行请求
    if (!redisClient.isReady) {
      return next();
    }

    let key, limit, windowSeconds, errorMessage;

    // 匹配限流策略参数
    if (type === 'global_ip') {
      key = `limit:ip:${req.ip}`;
      limit = 10;
      windowSeconds = 1; // 单 IP 每秒 10 次
      errorMessage = '请求过于频繁，请稍后再试';
    } else if (type === 'phone') {
      const phone = req.body?.phone;
      if (!phone) return next(); // 无手机号参数交由后续参数校验中间件处理
      key = `limit:phone:${phone}`;
      limit = 1;
      windowSeconds = 5; // 单手机号每5秒 1 次
      errorMessage = '操作过于频繁，请5秒后再试';
    } else if (type === 'admin_ip') {
      key = `limit:admin_ip:${req.ip}`;
      limit = 30;
      windowSeconds = 60; // 管理员单 IP 每分钟 30 次
      errorMessage = '管理员接口请求超限，请稍后再试';
    } else {
      return next();
    }

    try {
      // 通过 Redis 原生客户端调用原子递增
      // 注意：redisClient.client 是底层的 redis 实例
      const fullKey = `${redisClient.prefix}${key}`;
      const current = await redisClient.client.incr(fullKey);

      // 如果是当前时间窗口的第一次请求，设置过期时间
      if (current === 1) {
        await redisClient.client.expire(fullKey, windowSeconds);
      }

      if (current > limit) {
        return fail(res, 429, 40029, errorMessage);
      }

      next();
    } catch (err) {
      console.error('[RateLimiter] 计数异常，执行降级放行:', err.message);
      next();
    }
  };
};

module.exports = rateLimiter;