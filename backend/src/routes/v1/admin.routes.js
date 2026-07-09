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

// ═══ 读写分离：写操作保持限流，读操作移除此中间件避免 Redis 瓶颈 ═══

// 写操作（保持 adminIpLimiter）
router.post('/auth/logout',            adminIpLimiter, adminController.logout);
router.post('/auth/revoke',            adminIpLimiter, adminController.revokeJwt);
router.post('/risk/unban',             adminIpLimiter, adminController.unbanRisk);
router.post('/user/force-delete',      adminIpLimiter, adminController.forceDeleteUser);
router.post('/intercept-logs/flush',  adminIpLimiter, adminController.forceFlushInterceptLogs);
router.post('/intercept-logs/clear',  adminIpLimiter, adminController.clearInterceptLogs);
router.post('/whitelist/add',         adminIpLimiter, adminController.addToWhitelist);
router.post('/whitelist/remove',      adminIpLimiter, adminController.removeFromWhitelist);
router.post('/whitelist/add-by-phone', adminIpLimiter, adminController.addToWhitelistByPhone);
router.post('/risk/clear-ip-bl',      adminIpLimiter, adminController.clearIpBlacklist);
router.put('/config',                 adminIpLimiter, configController.update);
router.post('/blacklist/add',         adminIpLimiter, adminController.addBlacklist);
router.post('/blacklist/remove',      adminIpLimiter, adminController.removeBlacklist);
router.post('/blacklist/unban-phone',    adminIpLimiter, adminController.unbanByPhone);
router.post('/blacklist/unban-hash',     adminIpLimiter, adminController.unbanByPhoneHash);
router.post('/users/kick',             adminIpLimiter, adminController.kickUser);
router.post('/users/decrypt-phones',   adminIpLimiter, adminController.decryptPhones);

// 只读操作（无 adminIpLimiter，减轻 Redis 压力）
router.get('/dashboard',              adminController.getDashboard);
router.get('/intercept-logs',         adminController.getInterceptLogs);
router.get('/whitelist',              adminController.getWhitelist);
router.get('/overview',               adminController.getOverview);
router.get('/config',                 configController.getAll);
router.get('/blacklist',              adminController.getBlacklist);
router.get('/operation-logs',         adminController.getOperationLogs);
router.get('/blacklist/search-phone',    adminController.searchBlacklistByPhone);
router.get('/users',                   adminController.getUsers);
router.get('/users/phone/:id',         adminController.getUserPhone);

module.exports = router;