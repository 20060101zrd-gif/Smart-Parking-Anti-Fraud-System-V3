// backend/src/index.js
const auditQueue = require('./jobs/auditQueue');
const express = require('express');
const path = require('path');
const env = require('./config/env');
const keyManager = require('./config/keys');
const sqliteClient = require('./data/sqlite.client');
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

    // 2. 初始化 SQLite 数据库与表结构
    await sqliteClient.init();

    // 3. 连接 Redis 高速缓存 (自带降级，不阻塞主线程)
    await redisClient.connect();
    auditQueue.start();//确保高危操作日志能每2秒批量落盘
    
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
      console.log(`🛡️  [Server] 管理面板直达: http://localhost:${env.PORT}/index.html\n`);
    });

  } catch (error) {
    console.error('\n💥 [Fatal Error] 系统启动失败，关键基础设施异常:');
    console.error(error);
    process.exit(1);
  }
}

// 触发启动
bootstrap();