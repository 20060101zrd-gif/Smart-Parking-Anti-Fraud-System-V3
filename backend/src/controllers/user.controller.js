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

      // 2. 调用服务层执行风控哈希碰撞与发券逻辑
      const result = await riskService.checkAndRegister(phone, name, deviceId);

      // 3. 返回发券成功响应
      return success(res, result, '注册校验通过，已成功发放停车券');
    } catch (err) {
      next(err);
    }
  }

  async cancel(req, res, next) {
    try {
      const { phone } = req.body;

      if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
        return fail(res, 400, 40000, '无效的手机号参数');
      }

      // 🚀 新增：提取请求者的真实 IP 地址 (兼容 Nginx 代理和直接访问)
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;

      // 🚀 修改：将提取到的 ip 传给服务层，激活滑动窗口限流防线
      await riskService.cancelAccount(phone, ip);

      return success(res, { success: true }, '账号已注销，个人信息已完成合规擦除');
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new UserController();