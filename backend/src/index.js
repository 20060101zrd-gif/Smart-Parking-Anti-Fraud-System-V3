// backend/src/index.js
const auditQueue = require('./jobs/auditQueue');
const interceptLogQueue = require('./jobs/interceptLogQueue');
const express = require('express');
const path = require('path');
const env = require('./config/env');
const keyManager = require('./config/keys');
const mysqlClient = require('./data/mysql.client');
const redisClient = require('./data/redis.client');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// --- 中间件初始化 ---
// 解析 JSON 请求体
app.use(express.json()); 
// 解析 Cookie (后续鉴权需要)
// 备注: 需在 package.json 引入 cookie-parser, 当前暂用占位
const cookieParser = require('cookie-parser');
app.use(cookieParser()); 

// --- 系统启动编排 ---
async function bootstrap() {
  console.log('\n======================================');
  console.log('🚀 智能停车防刷券风控系统 - 启动序列');
  console.log('======================================\n');

  try {
    // 1. 加载或生成 RS256 密钥对
    keyManager.loadOrGenerateKeys();

    // 2. 初始化 MySQL 数据库与表结构
    await mysqlClient.init();

    // 3. 连接 Redis 高速缓存 (自带降级，不阻塞主线程)
    await redisClient.connect();
    auditQueue.start();//确保高危操作日志能每2秒批量落盘
    interceptLogQueue.start();//🆕 风控拦截日志每2秒异步刷盘
    
    // 4. 挂载前端静态资源 (Web 管理面板)
    // 映射根目录 public 文件夹，消灭跨域问题
    app.use(express.static(path.join(__dirname, '../public')));

    // 5. 挂载 API 路由 (暂留空，后续叠加)
    app.use('/api/v1', require('./routes'));

    // 6. 全局异常处理兜底中间件
    app.use(errorHandler);

    // 7. 启动 HTTP 监听
    app.listen(env.PORT,'0.0.0.0', () => {
      console.log(`\n🎉 [Server] 核心后端服务启动成功!`);
      console.log(`📡 [Server] 本地访问地址: http://localhost:${env.PORT}`);
      console.log(`🛡️  [Server] 管理面板:     http://localhost:${env.PORT}/index.html`);
      console.log(`📱 [Server] 手机注册页:   http://localhost:${env.PORT}/app.html`);
      console.log(`👥 [Server] 用户管理:     http://localhost:${env.PORT}/users.html\n`);
    });

  } catch (error) {
    console.error('\n💥 [Fatal Error] 系统启动失败，关键基础设施异常:');
    console.error(error);
    process.exit(1);
  }
}

// 触发启动
bootstrap();

// ── 优雅关闭 ──────────────────────────────────────────────────
const shutdown = async (signal) => {
  console.log(`\n⚠️  收到 ${signal} 信号，正在优雅关闭...`);
  
  // 1. 停止定时任务（审计日志 + 拦截日志刷盘）
  auditQueue.stop();
  interceptLogQueue.stop();
  
  // 2. 关闭 MySQL 连接池（等待进行中的查询完成）
  try { await mysqlClient.close(); } catch (e) { console.error('MySQL 关闭异常:', e.message); }
  
  // 3. 断开 Redis 连接
  try { await redisClient.client.quit(); } catch (e) { console.error('Redis 关闭异常:', e.message); }
  
  console.log('✅ 所有资源已释放，服务安全退出');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));