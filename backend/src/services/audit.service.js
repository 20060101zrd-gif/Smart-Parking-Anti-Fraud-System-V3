// backend/src/services/audit.service.js

class AuditService {
  constructor() {
    this.queue = [];
    this.MAX_QUEUE_SIZE = 5000; // 溢出保护阈值
  }

  /**
   * 记录高危操作日志 (非阻塞)
   * @param {Number} adminId 操作者管理员 ID
   * @param {String} actionType 动作类型 (BAN_USER, UNBAN_USER, REVOKE_JWT 等)
   * @param {String} targetResource 操作对象
   * @param {String} ipAddress 操作者 IP
   */
  logAction(adminId, actionType, targetResource, ipAddress) {
    // 溢出保护：极端并发下若写入任务卡死，主动丢弃旧日志，保主业务内存不爆
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      console.warn('[AuditService] 审计队列已达上限，主动丢弃最旧的数据');
      this.queue.shift(); 
    }

    this.queue.push({
      adminId,
      actionType,
      targetResource,
      ipAddress,
      createdAt: new Date().toISOString()
    });
  }

  // 供定时任务提取并清空当前队列
  flushQueue() {
    const currentBatch = [...this.queue];
    this.queue = [];
    return currentBatch;
  }
}

// 导出单例，确保全系统共享同一个队列
module.exports = new AuditService();