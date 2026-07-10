// backend/src/services/whitelist.service.js
// 风控白名单服务 — 支持按 IP / 设备指纹双维度
// 双写策略：Redis (O(1)高速查询) + MySQL (持久化恢复)
// 🆕 Redis 不可用时自动降级到内存 Set

const redisClient = require('../data/redis.client');
const db = require('../data/mysql.client');

class WhitelistService {
  constructor() {
    this._memIps = new Set();
    this._memDevices = new Set();
  }

  // ═══════════════════════════════════════════════
  //  IP 白名单 CRUD
  // ═══════════════════════════════════════════════

  async addIp(ip, remark = '', createdBy = null) {
    if (!redisClient.isReady) { this._memIps.add(ip); console.log(`[Whitelist] ✅ IP 白名单（内存）: ${ip}`); return true; }
    const ok = await redisClient.set(`whitelist:ip:${ip}`, remark, null);
    if (!ok) throw new Error('写入 Redis 失败');
    try { await redisClient.client.sAdd(`${redisClient.prefix}whitelist:ip:all`, ip); } catch {}
    // 🆕 双写 MySQL
    try {
      await db.run(
        `INSERT INTO sys_whitelist (type, value, remark, created_by) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE remark = VALUES(remark)`,
        ['ip', ip, remark, createdBy || null]
      );
    } catch (e) { console.error('[Whitelist] MySQL 写入 IP 失败:', e.message); }
    console.log(`[Whitelist] ✅ IP 已加入白名单: ${ip}`);
    return true;
  }

  async removeIp(ip) {
    if (!redisClient.isReady) { this._memIps.delete(ip); return true; }
    const ok = await redisClient.del(`whitelist:ip:${ip}`);
    if (!ok) throw new Error('删除失败，该 IP 不在白名单中');
    try { await redisClient.client.sRem(`${redisClient.prefix}whitelist:ip:all`, ip); } catch {}
    // 🆕 同步 MySQL
    try { await db.run(`DELETE FROM sys_whitelist WHERE type = 'ip' AND value = ?`, [ip]); } catch (e) {}
    console.log(`[Whitelist] ❌ IP 已移出白名单: ${ip}`);
    return true;
  }

  async listIps() {
    if (!redisClient.isReady) return [...this._memIps];
    try {
      const members = await redisClient.client.sMembers(`${redisClient.prefix}whitelist:ip:all`);
      // 🆕 Redis 为空时从 MySQL 恢复
      if (!members || members.length === 0) {
        const rows = await db.all(`SELECT value FROM sys_whitelist WHERE type = 'ip'`);
        return rows.map(r => r.value);
      }
      return members || [];
    } catch { return []; }
  }

  // ═══════════════════════════════════════════════
  //  设备指纹白名单 CRUD
  // ═══════════════════════════════════════════════

  async addDevice(deviceHash, remark = '', createdBy = null) {
    if (!redisClient.isReady) { this._memDevices.add(deviceHash); return true; }
    const ok = await redisClient.set(`whitelist:device:${deviceHash}`, remark, null);
    if (!ok) throw new Error('写入 Redis 失败');
    try { await redisClient.client.sAdd(`${redisClient.prefix}whitelist:device:all`, deviceHash); } catch {}
    // 🆕 双写 MySQL
    try {
      await db.run(
        `INSERT INTO sys_whitelist (type, value, remark, created_by) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE remark = VALUES(remark)`,
        ['device', deviceHash, remark, createdBy || null]
      );
    } catch (e) { console.error('[Whitelist] MySQL 写入 device 失败:', e.message); }
    console.log(`[Whitelist] ✅ 设备已加入白名单: ${(deviceHash || '').substring(0, 16)}...`);
    return true;
  }

  async removeDevice(deviceHash) {
    if (!redisClient.isReady) { this._memDevices.delete(deviceHash); return true; }
    const ok = await redisClient.del(`whitelist:device:${deviceHash}`);
    if (!ok) throw new Error('删除失败，该设备不在白名单中');
    try { await redisClient.client.sRem(`${redisClient.prefix}whitelist:device:all`, deviceHash); } catch {}
    // 🆕 同步 MySQL
    try { await db.run(`DELETE FROM sys_whitelist WHERE type = 'device' AND value = ?`, [deviceHash]); } catch (e) {}
    console.log(`[Whitelist] ❌ 设备已移出白名单: ${(deviceHash || '').substring(0, 16)}...`);
    return true;
  }

  async listDevices() {
    if (!redisClient.isReady) return [...this._memDevices];
    try {
      const members = await redisClient.client.sMembers(`${redisClient.prefix}whitelist:device:all`);
      // 🆕 Redis 为空时从 MySQL 恢复
      if (!members || members.length === 0) {
        const rows = await db.all(`SELECT value FROM sys_whitelist WHERE type = 'device'`);
        return rows.map(r => r.value);
      }
      return members || [];
    } catch { return []; }
  }

  /** 🆕 获取白名单总数（供概览页使用） */
  async countAll() {
    try {
      const row = await db.get(`SELECT COUNT(*) AS cnt FROM sys_whitelist`);
      return row?.cnt || 0;
    } catch { return 0; }
  }

  // ═══════════════════════════════════════════════
  //  白名单命中检测（O(1) — 供中间件/风控层调用）
  // ═══════════════════════════════════════════════

  async isIpWhitelisted(ip) {
    if (!ip) return false;
    const redisVal = await redisClient.get(`whitelist:ip:${ip}`);
    if (redisVal) return true;
    if (!redisClient.isReady) return this._memIps.has(ip);
    return false;
  }

  async isDeviceWhitelisted(deviceHash) {
    if (!deviceHash) return false;
    const redisVal = await redisClient.get(`whitelist:device:${deviceHash}`);
    if (redisVal) return true;
    if (!redisClient.isReady) return this._memDevices.has(deviceHash);
    return false;
  }

  // ═══════════════════════════════════════════════
  //  手机号哈希白名单
  // ═══════════════════════════════════════════════

  async addPhoneHash(phoneHash, createdBy = null) {
    if (!phoneHash) return false;
    if (!redisClient.isReady) { this._memDevices.add('PHONE:' + phoneHash); return true; }
    const ok = await redisClient.set(`whitelist:phone:${phoneHash}`, '1', null);
    if (!ok) throw new Error('写入 Redis 失败');
    try { await db.run(
      `INSERT INTO sys_whitelist (type, value, remark, created_by) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE remark = VALUES(remark)`,
      ['phone', phoneHash, '通过手机号添加', createdBy || null]
    ); } catch {}
    return true;
  }

  async removePhoneHash(phoneHash) {
    if (!phoneHash) return false;
    if (!redisClient.isReady) { this._memDevices.delete('PHONE:' + phoneHash); return true; }
    await redisClient.del(`whitelist:phone:${phoneHash}`);
    try { await db.run(`DELETE FROM sys_whitelist WHERE type = 'phone' AND value = ?`, [phoneHash]); } catch {}
    return true;
  }

  async isPhoneWhitelisted(phoneHash) {
    if (!phoneHash) return false;
    const redisVal = await redisClient.get(`whitelist:phone:${phoneHash}`);
    if (redisVal) return true;
    if (!redisClient.isReady) return this._memDevices.has('PHONE:' + phoneHash);
    return false;
  }

  async isWhitelisted(ip, deviceHash, phoneHash) {
    if (ip        && await this.isIpWhitelisted(ip))         return true;
    if (deviceHash && await this.isDeviceWhitelisted(deviceHash)) return true;
    if (phoneHash && await this.isPhoneWhitelisted(phoneHash)) return true;
    return false;
  }
}

module.exports = new WhitelistService();
