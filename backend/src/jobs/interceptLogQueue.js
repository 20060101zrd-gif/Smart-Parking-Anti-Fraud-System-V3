// backend/src/jobs/interceptLogQueue.js
// 拦截日志异步刷盘定时任务 — 每2秒批量写入 MySQL

const interceptLogService = require('../services/intercept-log.service');
const db = require('../data/mysql.client');

class InterceptLogQueueJob {
  constructor() {
    this.intervalId = null;
    this.FLUSH_INTERVAL = 2000; // 2秒
  }

  start() {
    if (this.intervalId) return;

    console.log(`[InterceptLogQueue] 异步拦截日志刷盘守护进程已启动，周期: ${this.FLUSH_INTERVAL}ms`);
    this.intervalId = setInterval(async () => {
      const batch = interceptLogService.flushQueue();

      if (batch.length === 0) return;

      try {
        const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
        const sql = `INSERT INTO risk_intercept_logs (ip_address, device_hash, intercept_reason, risk_level, created_at) VALUES ${placeholders}`;

        const params = [];
        batch.forEach(log => {
          params.push(log.ip, log.deviceHash, log.reason, log.riskLevel, log.createdAt);
        });

        await db.run(sql, params);
      } catch (err) {
        console.error(`[InterceptLogQueue] 批量写入失败，丢失 ${batch.length} 条拦截日志:`, err.message);
      }
    }, this.FLUSH_INTERVAL);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

module.exports = new InterceptLogQueueJob();
