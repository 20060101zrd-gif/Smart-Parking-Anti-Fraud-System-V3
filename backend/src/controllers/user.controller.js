// backend/src/controllers/user.controller.js
const riskService = require('../services/risk.service');
const { success, fail } = require('../utils/response');

class UserController {
  async register(req, res, next) {
    try {
      // 提取业务参数 (deviceId 为可选增强风控因子)
      const { phone, name, deviceId = '' } = req.body;

      // 1. 基础参数与边界校验
      if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
        return fail(res, 400, 40000, '无效的手机号参数');
      }
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return fail(res, 400, 40000, '姓名参数缺失或格式不合法');
      }

      // 🆕 提取客户端真实 IP（兼容反向代理），归一化 IPv6 映射格式
      let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
      if (ip && ip.startsWith('::ffff:')) ip = ip.slice(7);
      if (ip === '::1') ip = '127.0.0.1';

      // 2. 调用服务层执行风控检测与发券逻辑（IP频控已由 rateLimiter('reg_ip') 中间件前置拦截）
      const result = await riskService.checkAndRegister(phone, name, deviceId, ip);

      // 3. 返回发券成功响应
      return success(res, result, '注册校验通过，已成功发放停车券');
    } catch (err) {
      next(err);
    }
  }

  /**
   * 🆕 滑块人机验证注册接口（中风险场景入口）
   * POST /api/v1/user/verify-captcha
   * Body: { phone, name, deviceId, captchaToken }
   *
   * 前置条件：captchaToken 已被 captchaToken 中间件校验并消耗
   * 无需再做二次 mock 验证，直接执行注册业务逻辑
   */
  async verifyCaptcha(req, res, next) {
    try {
      const { phone, name, deviceId = '' } = req.body;
      let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
      if (ip && ip.startsWith('::ffff:')) ip = ip.slice(7);
      if (ip === '::1') ip = '127.0.0.1';

      // 参数校验
      if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
        return fail(res, 400, 40000, '无效的手机号参数');
      }
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return fail(res, 400, 40000, '姓名参数缺失或格式不合法');
      }

      // captchaToken 已由 captchaToken 中间件校验并消耗，此处直接执行业务
      const result = await riskService.checkAndRegister(phone, name, deviceId, ip);
      return success(res, result, '人机验证通过，注册成功，已发放停车券');
    } catch (err) {
      next(err);
    }
  }

  async cancel(req, res, next) {
    try {
      const { phone, deviceId = '' } = req.body;

      if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
        return fail(res, 400, 40000, '无效的手机号参数');
      }

      // 🚀 提取请求者的真实 IP 地址 (兼容 Nginx 代理和直接访问)，归一化 IPv6 映射格式
      let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
      if (ip && ip.startsWith('::ffff:')) ip = ip.slice(7);
      if (ip === '::1') ip = '127.0.0.1';

      // 🚀 加 15 秒超时防止 Argon2id 计算导致请求悬挂
      const result = await Promise.race([
        riskService.cancelAccount(phone, ip, deviceId),
        new Promise((_, reject) => setTimeout(() => reject(new Error('CANCEL_TIMEOUT')), 15000))
      ]);

      return success(res, { success: true }, '账号已注销，个人信息已完成合规擦除');
    } catch (err) {
      if (err.message === 'CANCEL_TIMEOUT') {
        return fail(res, 504, 50400, '注销请求超时，请稍后重试');
      }
      next(err);
    }
  }
}

module.exports = new UserController();