// backend/src/routes/v1/admin.routes.js
const express = require('express');
const router = express.Router();
const adminController = require('../../controllers/admin.controller');
const configController = require('../../controllers/config.controller');

// 引入中间件
const rateLimiter = require('../../middlewares/rateLimiter');
const jwtAuth = require('../../middlewares/jwtAuth');
const redisBlacklist = require('../../middlewares/redisBlacklist');

// 实例化管理员全局防抖限流器 (单IP 30次/分钟)
const adminIpLimiter = rateLimiter('admin_ip');

// --- 基础登录接口 (免鉴权) ---
router.post('/login', adminIpLimiter, adminController.login);
// 自动化测试专用：login + 返回 token 明文
router.post('/login/token', adminIpLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      const { fail } = require('../../utils/response');
      return fail(res, 400, 40000, '账号或密码不可为空');
    }
    const authService = require('../../services/auth.service');
    const { token, adminId, username: adminName } = await authService.login(username, password);
    res.cookie('admin_token', token, { httpOnly: true, sameSite: 'strict', maxAge: 2*60*60*1000, path: '/' });
    const { success } = require('../../utils/response');
    return success(res, { adminId, username: adminName, token }, '登录成功');
  } catch (err) { next(err); }
});

// --- 强管控接口 (JWT验签 + Redis黑名单双重校验) ---
router.use(jwtAuth);
router.use(redisBlacklist);

// 已有接口
router.post('/auth/logout',            adminIpLimiter, adminController.logout);
router.post('/auth/revoke',            adminIpLimiter, adminController.revokeJwt);
router.post('/risk/unban',             adminIpLimiter, adminController.unbanRisk);
router.post('/user/force-delete',      adminIpLimiter, adminController.forceDeleteUser);
router.get('/dashboard',              adminIpLimiter, adminController.getDashboard);
router.get('/intercept-logs',         adminIpLimiter, adminController.getInterceptLogs);
router.post('/intercept-logs/flush',  adminIpLimiter, adminController.forceFlushInterceptLogs);
router.post('/intercept-logs/clear',  adminIpLimiter, adminController.clearInterceptLogs);
router.get('/whitelist',              adminIpLimiter, adminController.getWhitelist);
router.post('/whitelist/add',         adminIpLimiter, adminController.addToWhitelist);
router.post('/whitelist/remove',      adminIpLimiter, adminController.removeFromWhitelist);
router.post('/whitelist/add-by-phone', adminIpLimiter, adminController.addToWhitelistByPhone);
router.post('/risk/clear-ip-bl',      adminIpLimiter, adminController.clearIpBlacklist);

// 🆕 模块三：系统概览
router.get('/overview',               adminIpLimiter, adminController.getOverview);

// 🆕 模块三：风控规则配置
router.get('/config',                 adminIpLimiter, configController.getAll);
router.put('/config',                 adminIpLimiter, configController.update);

// 🆕 模块三：黑名单管理
router.get('/blacklist',              adminIpLimiter, adminController.getBlacklist);
router.post('/blacklist/add',         adminIpLimiter, adminController.addBlacklist);
router.post('/blacklist/remove',      adminIpLimiter, adminController.removeBlacklist);

// 🆕 模块三：操作日志
router.get('/operation-logs',         adminIpLimiter, adminController.getOperationLogs);

// 🆕 黑名单 — 手机号搜索 & 解封
router.get('/blacklist/search-phone',    adminIpLimiter, adminController.searchBlacklistByPhone);
router.post('/blacklist/unban-phone',    adminIpLimiter, adminController.unbanByPhone);
router.post('/blacklist/unban-hash',     adminIpLimiter, adminController.unbanByPhoneHash);

// 🆕 用户管理
router.get('/users',                   adminIpLimiter, adminController.getUsers);
router.get('/users/phone/:id',         adminIpLimiter, adminController.getUserPhone);
router.post('/users/decrypt-phones',   adminIpLimiter, adminController.decryptPhones);
router.post('/users/kick',             adminIpLimiter, adminController.kickUser);

module.exports = router;