// backend/src/controllers/captcha.controller.js
// 滑动拼图人机验证控制器

const captchaService = require('../services/captcha.service');
const riskService   = require('../services/risk.service');
const { success, fail } = require('../utils/response');

class CaptchaController {
  /**
   * GET /api/v1/captcha/generate
   * 生成滑动验证码
   * 返回: { captchaId, canvas, puzzle, expiresIn }
   */
  async generate(req, res, next) {
    try {
      const data = await captchaService.generate();
      return success(res, data, '验证码生成成功');
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/captcha/verify
   * 校验滑块位置
   * Body: { captchaId, sliderX }
   * 成功: 返回一次性 token，5分钟内有效
   * 失败: 记录到风控系统，累计失败触发 IP 封禁
   */
  async verify(req, res, next) {
    try {
      const { captchaId, sliderX } = req.body;
      let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
      if (ip && ip.startsWith('::ffff:')) ip = ip.slice(7);
      if (ip === '::1') ip = '127.0.0.1';

      // 参数快速校验
      if (!captchaId || sliderX === undefined || sliderX === null) {
        return fail(res, 400, 40005, '缺少验证码 ID 或滑块位置参数');
      }

      // 调用拼图校验逻辑
      const result = await captchaService.verify(captchaId, Number(sliderX));

      if (!result.success) {
        // 🛡️ 验证失败 → 风控系统记录（累计 3 次触发 24h IP 封禁）
        const failCount = await riskService.recordCaptchaFailure(ip);
        return fail(res, 400, result.code, result.message, {
          failCount,
          maxRetry: 3,
          deviation: result.deviation
        });
      }

      // ✅ 验证通过 → 风控系统清零失败计数
      await riskService.recordCaptchaSuccess(ip);

      return success(res, {
        token:     result.token,
        expiresIn: result.expiresIn,
        deviation: result.deviation
      }, '验证通过');
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new CaptchaController();
