// backend/src/controllers/config.controller.js
// 风控规则配置控制器

const configService = require('../services/config.service');
const db = require('../data/mysql.client');
const { success, fail } = require('../utils/response');

class ConfigController {
  /** GET /api/v1/admin/config — 获取所有风控规则 */
  async getAll(req, res, next) {
    try {
      const config = await configService.getAll();
      return success(res, config, '风控规则读取成功');
    } catch (err) {
      next(err);
    }
  }

  /** PUT /api/v1/admin/config — 修改单个风控阈值 */
  async update(req, res, next) {
    try {
      const { key, value } = req.body;
      if (!key) return fail(res, 400, 40000, '缺少配置项 key');
      if (value === undefined || value === null) return fail(res, 400, 40000, '缺少配置值 value');

      const result = await configService.update(key, value, req.admin.username || 'admin');

      // 记录操作日志
      await db.run(
        `INSERT INTO sys_operation_logs (admin_id, action_type, target_resource, detail, ip_address)
         VALUES (?, 'UPDATE_CONFIG', ?, ?, ?)`,
        [req.admin.adminId, key, `修改为 ${value}`, req.ip || '127.0.0.1']
      ).catch(() => {});

      return success(res, result, `规则 [${key}] 已更新为 ${value}`);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ConfigController();
