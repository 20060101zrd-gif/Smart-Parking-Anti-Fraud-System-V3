// backend/src/utils/response.js

/**
 * 统一成功响应
 * @param {Object} res Express Response 对象
 * @param {any} data 核心业务数据
 * @param {String} message 提示信息
 * @param {Number} code 业务状态码
 */
const success = (res, data = null, message = '操作成功', code = 20000) => {
  return res.status(200).json({
    code,
    message,
    data,
    timestamp: Date.now()
  });
};

/**
 * 统一失败响应
 * @param {Object} res Express Response 对象
 * @param {Number} statusCode HTTP 状态码 (如 400, 401, 403, 500)
 * @param {Number} code 业务错误码 (如 40000, 40101)
 * @param {String} message 错误提示信息
 * @param {any} data 附加错误数据
 */
const fail = (res, statusCode = 400, code = 40000, message = '请求失败', data = null) => {
  return res.status(statusCode).json({
    code,
    message,
    data,
    timestamp: Date.now()
  });
};

module.exports = {
  success,
  fail
};