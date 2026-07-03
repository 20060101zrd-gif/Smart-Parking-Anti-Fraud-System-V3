// backend/src/jobs/auditQueue.js
const auditService = require('../services/audit.service');
const db = require('../data/mysql.client');

class AuditQueueJob {
  constructor() {
    this.intervalId = null;
    this.FLUSH_INTERVAL = 2000; // 每 2 秒刷盘一次
  }

  start() {
    if (this.intervalId) return;

    console.log(`[AuditQueue] 异步审计刷盘守护进程已启动，周期: ${this.FLUSH_INTERVAL}ms`);
    this.intervalId = setInterval(async () => {
      const batch = auditService.flushQueue();
      
      if (batch.length === 0) return;

      try {
        // 构建批量插入 SQL 及其参数
        const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
        const sql = `INSERT INTO sys_audit_logs (admin_id, action_type, target_resource, ip_address, created_at) VALUES ${placeholders}`;
        
        const params = [];
        batch.forEach(log => {
          params.push(log.adminId, log.actionType, log.targetResource, log.ipAddress, log.createdAt);
        });

        await db.run(sql, params);
      } catch (err) {
        console.error(`[AuditQueue] 批量写入 MySQL 失败，丢失 ${batch.length} 条审计记录:`, err.message);
        // 发生严重写入异常时，视业务容忍度可选择将 batch 重新推回队列头部
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

module.exports = new AuditQueueJob();