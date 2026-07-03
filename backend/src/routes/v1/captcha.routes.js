// backend/src/routes/v1/captcha.routes.js
// 滑动拼图人机验证路由

const express = require('express');
const router = express.Router();
const captchaController = require('../../controllers/captcha.controller');
const rateLimiter = require('../../middlewares/rateLimiter');

const globalIpLimiter = rateLimiter('global_ip');   // 单 IP 10次/秒

/**
 * @route   GET /api/v1/captcha/generate
 * @desc    生成滑动拼图验证码参数
 * @access  Public
 * @returns { captchaId, canvas, puzzle, expiresIn }
 */
router.get(
  '/generate',
  globalIpLimiter,
  captchaController.generate
);

/**
 * @route   POST /api/v1/captcha/verify
 * @desc    校验滑块位置，通过后签发一次性验证 token
 * @access  Public
 * @body    { captchaId, sliderX }
 * @returns { token, expiresIn, deviation }
 */
router.post(
  '/verify',
  globalIpLimiter,
  captchaController.verify
);

module.exports = router;
