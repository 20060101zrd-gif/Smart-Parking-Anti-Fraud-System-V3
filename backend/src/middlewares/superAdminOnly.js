// backend/src/middlewares/superAdminOnly.js
// Restrict routes to super_admin role only

const { fail } = require('../utils/response');

module.exports = function superAdminOnly(req, res, next) {
  if (!req.admin || req.admin.role !== 'super_admin') {
    return fail(res, 403, 40300, '权限不足：仅超级管理员可执行此操作');
  }
  next();
};
