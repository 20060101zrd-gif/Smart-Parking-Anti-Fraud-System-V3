// backend/src/middlewares/errorHandler.js
const { fail } = require('../utils/response');

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  // 业务异常 — 静默处理，不打印堆栈
  if (err.isBusinessError) {
    return fail(res, err.statusCode || 400, err.code || 40000, err.message);
  }

  // 参数校验异常
  if (err.status === 400 || err.name === 'ValidationError') {
    return fail(res, 400, 40000, err.message || '请求参数校验失败');
  }

  // 真正需要排查的系统异常才打印堆栈
  console.error('[Error Handler] 捕获到系统异常:');
  console.error(err.stack);

  return fail(res, 500, 50000, '服务器内部错误，请联系系统管理员');
};

module.exports = errorHandler;