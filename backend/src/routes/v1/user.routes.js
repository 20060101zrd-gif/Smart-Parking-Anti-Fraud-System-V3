// backend/src/routes/v1/user.routes.js
const express = require('express');
const router = express.Router();
const userController = require('../../controllers/user.controller');
const rateLimiter = require('../../middlewares/rateLimiter');

// 实例化限流中间件
const globalIpLimiter = rateLimiter('global_ip'); // 单 IP 10次/秒
const phoneLimiter = rateLimiter('phone');        // 单手机号 1次/分钟

/**
 * @route   POST /api/v1/user/register
 * @desc    用户注册与发券风控校验
 * @access  Public
 */
router.post(
  '/register',
  globalIpLimiter,
  phoneLimiter,
  userController.register
);

/**
 * @route   POST /api/v1/user/cancel
 * @desc    合规注销与风控指纹沉淀
 * @access  Public
 */
router.post(
  '/cancel',
  globalIpLimiter,
  phoneLimiter,
  userController.cancel
);

module.exports = router;