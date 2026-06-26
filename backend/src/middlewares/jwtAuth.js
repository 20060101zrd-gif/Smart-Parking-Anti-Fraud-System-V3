// backend/src/middlewares/jwtAuth.js
const jwt = require('jsonwebtoken');
const keyManager = require('../config/keys');
const { fail } = require('../utils/response');

const jwtAuth = (req, res, next) => {
  // 依赖 cookie-parser 中间件解析的结果
  const token = req.cookies?.admin_token;

  if (!token) {
    return fail(res, 401, 40100, '未授权访问：凭证缺失');
  }

  try {
    // 强制指定算法白名单 RS256，防范空签名与降级攻击
    const decoded = jwt.verify(token, keyManager.publicKey, {
      algorithms: ['RS256']
    });

    // 将解析出的载荷（包含 adminId 和 jti）挂载到 request 对象
    req.admin = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return fail(res, 401, 40100, '未授权访问：凭证已过期，请重新登录');
    }
    console.warn('[JWT] 凭证解析失败或遭篡改:', err.message);
    return fail(res, 401, 40100, '未授权访问：凭证无效');
  }
};

module.exports = jwtAuth;