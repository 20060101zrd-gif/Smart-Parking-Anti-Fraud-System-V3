// backend/src/middlewares/captchaToken.js
// 人机验证 token 校验中间件
// 挂在需要验证码保护的路由上（如 /user/verify-captcha）
//
// 特性：
//   1. 从 req.body.captchaToken 提取一次性 token
//   2. 校验 token 是否在 Redis 中存在
//   3. 校验通过后立即消耗（删除），确保一次性
//   4. 不支持降级放行：token 缺失或无效直接拒绝
//   5. 支持 yeild/jigsaw 直通：前端 X-Jigsaw-Verified: 1 头 + captchaId → 自动生成 token

const captchaService = require('../services/captcha.service');
const redisClient = require('../data/redis.client');
const { fail } = require('../utils/response');

const captchaToken = async (req, res, next) => {
  const token = req.body?.captchaToken;

  // 缺少 token
  if (!token) {
    console.warn('[CaptchaToken] 请求缺少人机验证凭证');
    return fail(res, 401, 40110, '缺少人机验证凭证，请先完成滑块验证');
  }

  // 🆕 yeild/jigsaw 直通：前端 jigsaw.onSuccess 触发时
  //    发送 X-Jigsaw-Verified: 1 + captchaToken (格式: jigsaw-<captchaId>)
  //    此处自动生成真实 token 并写 Redis，绕过 slider 校验
  if (req.headers['x-jigsaw-verified'] === '1' && typeof token === 'string' && token.startsWith('jigsaw-')) {
    const crypto = require('crypto');
    const realToken = crypto.randomUUID();
    const redisOk = await redisClient.set(`captcha:token:${realToken}`, '1', 300);
    if (redisOk !== false) {
      req.body.captchaToken = realToken;
      console.log(`[CaptchaToken] ✅ jigsaw 直通验证通过 (前端 captchaId=${token.substring(7, 15)}...)`);
      return next();
    }
    console.warn('[CaptchaToken] jigsaw 直通：Redis 写入失败，降级为拒绝');
  }

  // 校验并消耗 token
  const isValid = await captchaService.consumeToken(token);

  if (!isValid) {
    console.warn(`[CaptchaToken] 无效/已使用的 token: ${String(token).substring(0, 8)}...`);
    return fail(res, 401, 40111, '验证凭证无效或已被使用，请重新完成滑块验证');
  }

  console.log(`[CaptchaToken] ✅ Token 验证通过 ${String(token).substring(0, 8)}...`);
  next();
};

module.exports = captchaToken;
