// backend/src/middlewares/captchaToken.js
// 人机验证 token 校验中间件
// 挂在需要验证码保护的路由上（如 /user/verify-captcha）
//
// 特性：
//   1. 从 req.body.captchaToken 提取一次性 token
//   2. 校验 token 是否在 Redis 中存在
//   3. 校验通过后立即消耗（删除），确保一次性
//   4. 不支持降级放行：token 缺失或无效直接拒绝

const captchaService = require('../services/captcha.service');
const { fail } = require('../utils/response');

const captchaToken = async (req, res, next) => {
  const token = req.body?.captchaToken;

  // 缺少 token
  if (!token) {
    console.warn('[CaptchaToken] 请求缺少人机验证凭证');
    return fail(res, 401, 40110, '缺少人机验证凭证，请先完成滑块验证');
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
