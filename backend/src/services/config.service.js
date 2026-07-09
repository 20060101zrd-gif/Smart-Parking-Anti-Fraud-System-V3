// backend/src/services/config.service.js
// 风控规则配置服务 — MySQL 持久化 + Redis 热加载

const db = require('../data/mysql.client');
const redisClient = require('../data/redis.client');

class ConfigService {
  /** 默认风控阈值 */
  static DEFAULTS = {
    device_register_limit:    3,     // 单设备注册上限
    device_cancel_limit:      1,     // 单设备注销次数上限
    ip_register_limit:        5,     // 单IP每分钟注册上限
    captcha_fail_max:         3,     // 验证码连续失败触发IP封禁次数
    ip_blocklist_ttl_hours:   24,    // IP临时黑名单有效期(小时)
    device_blacklist_ttl_days: 90,   // 设备黑名单有效期(天)
    hash_archive_ttl_days:    90,    // 注销沉淀库有效期(天)
    captcha_answer_ttl_sec:   60,    // 验证码答案有效期(秒)
    captcha_token_ttl_sec:    300,   // 验证token有效期(秒)
  };

  /**
   * 读取所有配置项（优先 Redis，回源 MySQL）
   */
  async getAll() {
    // 1. 尝试从 Redis 批量读取
    if (redisClient.isReady) {
      try {
        const cached = await redisClient.get('config:all');
        if (cached) return JSON.parse(cached);
      } catch {}
    }

    // 2. 回源 MySQL
    const rows = await db.all('SELECT config_key, config_value FROM sys_config ORDER BY id');
    const config = { ...ConfigService.DEFAULTS };
    for (const r of rows) {
      config[r.config_key] = isNaN(Number(r.config_value)) ? r.config_value : Number(r.config_value);
    }

    // 3. 写入 Redis 缓存（10 秒，避免配置变更后长时间不生效）
    if (redisClient.isReady) {
      try { await redisClient.set('config:all', JSON.stringify(config), 10); } catch (e) {
        console.error('[ConfigService] Redis 缓存写入失败:', e.message);
      }
    }

    return config;
  }

  /**
   * 更新单个配置项（写入 MySQL + 清除 Redis 缓存使其回源）
   */
  async update(key, value, operator) {
    const allowed = Object.keys(ConfigService.DEFAULTS);
    if (!allowed.includes(key)) {
      throw Object.assign(new Error(`未知配置项: ${key}`), { isBusinessError: true, statusCode: 400, code: 40000 });
    }

    const numVal = Number(value);
    if (isNaN(numVal) || numVal < 0) {
      throw Object.assign(new Error(`配置值必须为非负数字`), { isBusinessError: true, statusCode: 400, code: 40000 });
    }

    // Upsert
    await db.run(
      `INSERT INTO sys_config (config_key, config_value, updated_by, updated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
      [key, String(numVal), operator || 'system']
    );

    // 清除 Redis 缓存（下一次读取时回源 MySQL）
    if (redisClient.isReady) {
      try {
        await redisClient.del('config:all');
        console.log(`[ConfigService] 规则 [${key}] 已更新为 ${numVal}，Redis 缓存已清除`);
      } catch (e) {
        console.error('[ConfigService] Redis 缓存清除失败:', e.message);
      }

      // 🆕 修改 device_cancel_limit 时自动清零所有设备注销计数器
      if (key === 'device_cancel_limit') {
        try {
          const keys = await redisClient.scanKeys('risk:cancel_count:device:*');
          if (keys.length > 0) {
            // 去掉 prefix 前缀后逐个删除（del 方法内部会再加前缀）
            for (const fullKey of keys) {
              const shortKey = fullKey.replace(/^pf:/, '');
              await redisClient.del(shortKey);
            }
            console.log(`[ConfigService] 已清零 ${keys.length} 个设备注销计数器`);
          } else {
            console.log('[ConfigService] 无设备注销计数器需要清零');
          }
        } catch (e) {
          console.error('[ConfigService] 清零设备注销计数器失败:', e.message);
        }
      }
    }

    return { key, value: numVal };
  }

  /**
   * 批量初始化默认配置（首次部署调用）
   */
  async seedDefaults() {
    for (const [key, val] of Object.entries(ConfigService.DEFAULTS)) {
      await db.run(
        `INSERT IGNORE INTO sys_config (config_key, config_value) VALUES (?, ?)`,
        [key, String(val)]
      );
    }
  }
}

module.exports = new ConfigService();
