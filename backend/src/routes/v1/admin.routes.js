// backend/src/routes/v1/admin.routes.js
const express = require('express');
const router = express.Router();
const adminController = require('../../controllers/admin.controller');

// 引入中间件
const rateLimiter = require('../../middlewares/rateLimiter');
const jwtAuth = require('../../middlewares/jwtAuth');
const redisBlacklist = require('../../middlewares/redisBlacklist');

// 实例化管理员全局防抖限流器 (单IP 30次/分钟)
const adminIpLimiter = rateLimiter('admin_ip');

// --- 基础登录接口 (免鉴权) ---
router.post(
  '/login',
  adminIpLimiter,
  adminController.login
);

// --- 强管控管控接口 (必须通过 JWT验签 + Redis黑名单双重校验) ---
router.use(jwtAuth);
router.use(redisBlacklist);

// 此时 req.admin 已存在，且确认未被吊销
router.post('/auth/logout', adminIpLimiter, adminController.logout);
router.post('/auth/revoke', adminIpLimiter, adminController.revokeJwt);
router.post('/risk/unban', adminIpLimiter, adminController.unbanRisk);
router.post('/user/force-delete', adminIpLimiter, adminController.forceDeleteUser);
router.get('/dashboard', adminIpLimiter, adminController.getDashboard);

module.exports = router;