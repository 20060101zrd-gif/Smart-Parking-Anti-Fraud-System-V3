// backend/src/middlewares/errorHandler.js
const { fail } = require('../utils/response');

const errorHandler = (err, req, res, next) => {
  // 控制台打印完整堆栈，供开发与日志系统抓取
  console.error('[Error Handler] 捕获到全局异常:');
  console.error(err.stack);

  // 如果 headers 已经被发送给客户端，直接交回给 Express 原生处理
  if (res.headersSent) {
    return next(err);
  }

  // 1. 参数校验异常 (针对后续业务中可能抛出的标准参数错误)
  if (err.status === 400 || err.name === 'ValidationError') {
    return fail(res, 400, 40000, err.message || '请求参数校验失败');
  }

  // 2. 自定义业务异常 (约定如果 error 对象携带 isBusinessError 标志)
  if (err.isBusinessError) {
    return fail(res, err.statusCode || 400, err.code || 40000, err.message);
  }

  // 3. 兜底系统异常，隐藏底层错误细节
  return fail(res, 500, 50000, '服务器内部错误，请联系系统管理员');
};

module.exports = errorHandler;