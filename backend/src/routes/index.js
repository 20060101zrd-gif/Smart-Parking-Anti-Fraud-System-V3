// backend/src/routes/index.js
const express = require('express');
const router = express.Router();

const userRoutes = require('./v1/user.routes');
const adminRoutes = require('./v1/admin.routes');

// 挂载 C 端免鉴权业务路由
router.use('/user', userRoutes);

// 预留位置：挂载 B 端强管控业务路由
router.use('/admin', adminRoutes);

module.exports = router;