// backend/src/services/intercept-log.service.js
// 风控拦截日志服务 — 队列入队 + 批量刷盘 + 分页查询
// 非阻塞设计，不影响业务主链路

const db = require('../data/mysql.client');

/**
 * 将 Date 或 ISO 字符串转为 MySQL DATETIME 兼容格式 (YYYY-MM-DD HH:MM:SS)
 */
const toMySqlDatetime = (d) => {
  return new Date(d).toISOString().slice(0, 19).replace('T', ' ');
};

class InterceptLogService {
  constructor() {
    this.queue = [];
    this.MAX_QUEUE = 10000;
  }

  /**
   * 记录一条风控拦截日志（非阻塞入队）
   * @param {String} ip          客户端 IP
   * @param {String} deviceHash  设备指纹哈希（可选）
   * @param {String} reason      拦截原因
   * @param {String} riskLevel   风险等级: HIGH | MEDIUM | LOW
   */
  logIntercept(ip, deviceHash = '', reason, riskLevel) {
    if (this.queue.length >= this.MAX_QUEUE) {
      console.warn('[InterceptLog] 日志队列已达上限，丢弃最旧记录');
      this.queue.shift();
    }

    this.queue.push({
      ip,
      deviceHash,
      reason,
      riskLevel,
      createdAt: toMySqlDatetime(new Date())
    });
  }

  /** 提取并清空当前队列 */
  flushQueue() {
    const batch = [...this.queue];
    this.queue = [];
    return batch;
  }

  /**
   * 立即刷盘并写入数据库（用于测试/手动触发，不依赖定时器）
   * @returns {Number} 写入的条目数
   */
  async flushAndWrite() {
    const batch = this.flushQueue();
    if (batch.length === 0) return 0;

    try {
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const sql = `INSERT INTO risk_intercept_logs (ip_address, device_hash, intercept_reason, risk_level, created_at) VALUES ${placeholders}`;

      const params = [];
      batch.forEach(log => {
        params.push(log.ip, log.deviceHash, log.reason, log.riskLevel, log.createdAt);
      });

      await db.run(sql, params);
      console.log(`[InterceptLog] force-flush: ${batch.length} 条日志已写入数据库`);
      return batch.length;
    } catch (err) {
      console.error(`[InterceptLog] force-flush 失败:`, err.message);
      throw err;
    }
  }

  /**
   * B端分页查询拦截日志
   * @param {Object} opts
   * @param {Number} opts.page        页码（默认1）
   * @param {Number} opts.pageSize    每页条数（默认20，最大100）
   * @param {String} opts.ip          IP筛选（模糊匹配）
   * @param {String} opts.startDate   开始时间 ISO 字符串
   * @param {String} opts.endDate     结束时间 ISO 字符串
   * @returns {{ list, total, page, pageSize }}
   */
  async queryLogs(opts = {}) {
    const page     = Math.max(1, parseInt(opts.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(opts.pageSize) || 20));
    const offset   = (page - 1) * pageSize;

    let whereClause = 'WHERE 1=1';
    const params    = [];

    // IP 筛选
    if (opts.ip && typeof opts.ip === 'string') {
      whereClause += ' AND ip_address LIKE ?';
      params.push(`%${opts.ip.trim()}%`);
    }

    // 时间范围筛选
    if (opts.startDate) {
      whereClause += ' AND created_at >= ?';
      params.push(opts.startDate);
    }
    if (opts.endDate) {
      whereClause += ' AND created_at <= ?';
      params.push(opts.endDate);
    }

    const countSql = `SELECT COUNT(*) AS total FROM risk_intercept_logs ${whereClause}`;
    const dataSql  = `SELECT id, ip_address, device_hash, intercept_reason, risk_level, created_at
                      FROM risk_intercept_logs ${whereClause}
                      ORDER BY created_at DESC LIMIT ? OFFSET ?`;

    // mysql2 下顺序执行避免并发连接问题
    let countRow = null;
    let list = [];
    try {
      countRow = await db.get(countSql, params);
    } catch (err) {
      console.error('[InterceptLog] COUNT 查询失败:', err.message);
    }
    try {
      list = await db.all(dataSql, [...params, pageSize, offset]);
    } catch (err) {
      console.error('[InterceptLog] 分页查询失败:', err.message);
    }

    return {
      list: list || [],
      total: Number(countRow?.total) || 0,
      page,
      pageSize
    };
  }
}

module.exports = new InterceptLogService();
