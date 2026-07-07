// backend/src/routes/v1/user.routes.js
const express = require('express');
const router = express.Router();
const userController = require('../../controllers/user.controller');
const rateLimiter = require('../../middlewares/rateLimiter');
const captchaToken = require('../../middlewares/captchaToken');   // 🆕 验证码 token 校验

// 实例化限流中间件
const globalIpLimiter  = rateLimiter('global_ip');  // 单 IP 10次/秒
const phoneLimiter     = rateLimiter('phone');       // 单手机号 1次/5秒
const ipBlacklist      = rateLimiter('ip_bl');       // IP临时黑名单检查
const regIpLimiter     = rateLimiter('reg_ip');      // 注册IP限流 5次/分钟 → 中风险

/**
 * @route   POST /api/v1/user/register
 * @desc    用户注册与发券风控校验（三级风险分级）
 * @access  Public
 * 中间件链: ip_bl → reg_ip → global_ip → phone → controller
 */
router.post(
  '/register',
  ipBlacklist,       // 1️⃣ 先查IP临时黑名单（24h封禁）
  regIpLimiter,      // 2️⃣ 再查IP注册频控（5次/分钟 → 401人机验证）
  globalIpLimiter,   // 3️⃣ 全局IP防刷（10次/秒）
  phoneLimiter,      // 4️⃣ 手机号频控（1次/5秒）
  userController.register
);

/**
 * @route   POST /api/v1/user/verify-captcha
 * @desc    滑块人机验证提交（中风险场景，注册频控超限后使用）
 *          必须携带有效的 captchaToken（由 POST /api/v1/captcha/verify 签发）
 * @access  Public
 * 中间件链: captchaToken → ip_bl → global_ip → phone → controller
 *          先校验一次性 token，再检查 IP 黑名单，确保 40110/40111 优先返回
 */
router.post(
  '/verify-captcha',
  captchaToken,      // 1️⃣ 🆕 校验一次性验证 token（token 无效则 401）
  ipBlacklist,       // 2️⃣ IP黑名单中的直接拒绝
  globalIpLimiter,   // 3️⃣ 全局IP防刷
  phoneLimiter,      // 4️⃣ 手机号频控
  userController.verifyCaptcha
);

/**
 * @route   POST /api/v1/user/cancel
 * @desc    合规注销与风控指纹沉淀
 * @access  Public
 */
router.post(
  '/cancel',
  globalIpLimiter,
  userController.cancel
);

module.exports = router;