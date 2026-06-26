// backend/src/controllers/admin.controller.js

const authService = require('../services/auth.service');

const riskService = require('../services/risk.service');

const auditService = require('../services/audit.service');

const sqliteClient = require('../data/sqlite.client');

const { success, fail } = require('../utils/response');




class AdminController {

  // 管理员登录

  async login(req, res, next) {

    try {

      const { username, password } = req.body;




      if (!username || !password) {

        return fail(res, 400, 40000, '账号或密码不可为空');

      }




      // 调用服务层进行账密校验与 JWT 签发

      const { token, adminId, username: adminName } = await authService.login(username, password);




      // 安全规范：强管控凭证写入 HttpOnly Cookie，阻止前端 JS 窃取

      res.cookie('admin_token', token, {

        httpOnly: true,

        sameSite: 'strict',

        maxAge: 2 * 60 * 60 * 1000, // 2小时 (与 JWT 有效期一致)

        path: '/'

      });




      // 响应体中绝对不包含 token

      return success(res, { adminId, username: adminName }, '登录成功');

    } catch (err) {

      next(err);

    }

  }

  // 管理员退出登录

  async logout(req, res, next) {

    try {

      // jwtAuth 中间件已将解析后的载荷挂载到 req.admin

      // 其中 exp 为 JWT 标准声明的过期时间戳（秒）

      const { jti, exp, adminId } = req.admin;




      // 1. 将当前 JWT 的 JTI 写入 Redis 吊销黑名单

      await authService.revokeToken(jti, exp, adminId);




      // 2. 记录安全审计日志

      auditService.logAction(adminId, 'LOGOUT', jti, req.ip);




      // 3. 彻底清除客户端 HttpOnly Cookie

      res.cookie('admin_token', '', {

        httpOnly: true,

        sameSite: 'strict',

        maxAge: 0, // 设置生命周期为 0 立即失效

        path: '/'

      });




      return success(res, { success: true }, '退出登录成功');

    } catch (err) {

      next(err);

    }

  }

  // 凭证主动吊销

  async revokeJwt(req, res, next) {

    try {

      const { targetJti, expireAt } = req.body;




      if (!targetJti || !expireAt) {

        return fail(res, 400, 40000, '吊销目标参数不完整');

      }




      await authService.revokeToken(targetJti, expireAt, req.admin.adminId);

      

      // 记录审计日志

      auditService.logAction(req.admin.adminId, 'REVOKE_JWT', targetJti, req.ip);




      return success(res, { revoked: true }, '凭证已成功吊销');

    } catch (err) {

      next(err);

    }

  }




  // 风控黑名单解封

  async unbanRisk(req, res, next) {

    try {

      const { fingerprint } = req.body;




      if (!fingerprint) {

        return fail(res, 400, 40000, '必须提供目标哈希指纹');

      }




      // 调用风控服务解除拦截状态 (由于此处无手机号明文，仅解封指纹)

      await riskService.unbanUser(fingerprint, null);




      // 记录审计日志

      auditService.logAction(req.admin.adminId, 'UNBAN_USER', fingerprint, req.ip);




      return success(res, { success: true }, '黑名单解封成功');

    } catch (err) {

      next(err);

    }

  }




  // 强制用户删除与拉黑

  async forceDeleteUser(req, res, next) {

    try {

      const { phone, reason = '管理员强制抹除' } = req.body;




      if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {

        return fail(res, 400, 40000, '无效的手机号参数');

      }




      await riskService.cancelAccount(phone);




      // 记录审计日志

      auditService.logAction(req.admin.adminId, 'FORCE_DELETE_USER', phone, req.ip);




      return success(res, { success: true }, '用户已被强制擦除并列入黑名单');

    } catch (err) {

      next(err);

    }

  }




  // 监控大盘数据查询

  async getDashboard(req, res, next) {

    try {

      const page = parseInt(req.query.page) || 1;

      const pageSize = parseInt(req.query.pageSize) || 20;

      const offset = (page - 1) * pageSize;




      // 并行查询三类核心大盘数据

      const [blacklists, auditLogs] = await Promise.all([

        sqliteClient.all(`SELECT fingerprint, phone_mask, created_at, expires_at FROM risk_hash_archives ORDER BY created_at DESC LIMIT ? OFFSET ?`, [pageSize, offset]),

        sqliteClient.all(`SELECT admin_id, action_type, target_resource, ip_address, created_at FROM sys_audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?`, [pageSize, offset])

      ]);




      // 构造大盘聚合响应 (活跃用户涉及业务表，此处因物理擦除逻辑仅做 mock 或留空)

      const dashboardData = {

        activeUsers: [], // 视业务是否建立独立的用户表补充

        blacklists,

        auditLogs

      };




      return success(res, dashboardData, '大盘数据拉取成功');

    } catch (err) {

      next(err);

    }

  }

}




module.exports = new AdminController();             