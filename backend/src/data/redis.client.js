// backend/src/data/redis.client.js
const { createClient } = require('redis');
const env = require('../config/env');

// 单次 Redis 操作超时（毫秒）
const OP_TIMEOUT_MS = 3000;
// 自动重连间隔（毫秒）
const RECONNECT_INTERVAL_MS = 5000;

class RedisWrapper {
  constructor() {
    this.client = createClient({
      socket: {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        reconnectStrategy: (retries) => Math.min(retries * 500, 5000)
      },
      password: env.REDIS_PASSWORD || undefined
    });
    
    this.isReady = false; // 降级标识：标记当前 Redis 是否可用
    this.prefix = 'pf:';  // 强制的命名空间前缀
    this._reconnectTimer = null;
    
    this._bindEvents();
  }

  _bindEvents() {
    this.client.on('connect', () => console.log('⏳ [Redis] 正在连接...'));
    this.client.on('ready', () => {
      this.isReady = true;
      this._clearReconnectTimer();
      console.log('✅ [Redis] 连接成功，缓存服务已就绪');
    });
    this.client.on('error', (err) => {
      this.isReady = false;
      console.error('❌ [Redis] 连接异常，进入降级模式:', err.message);
      this._scheduleReconnect();
    });
    this.client.on('end', () => {
      this.isReady = false;
      console.warn('⚠️ [Redis] 连接已断开');
      this._scheduleReconnect();
    });
  }

  async connect() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.client.connect();
        return; // 连接成功，退出重试
      } catch (error) {
        console.error(`❌ [Redis] 连接失败 (第 ${attempt}/3 次): ${error.message}`);
        if (attempt < 3) {
          console.log(`⏳ [Redis] 500ms 后重试...`);
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
    // 3 次全部失败 → 降级运行 + 启动后台重连
    console.error('❌ [Redis] 3 次重试全部失败，系统将以无缓存模式降级运行');
    this._scheduleReconnect();
  }

  // ── 操作超时保护 + 自动降级 ─────────────────────────────────────

  /**
   * 给 Redis 操作加超时保护。
   * 如果操作超时 → 标记 isReady=false → 启动自动重连 → 返回 safeDefault
   */
  async _withTimeout(promise, safeDefault) {
    // 注意: AbortController 在 redis@4 中可能不完全支持，
    // 使用 Promise.race 自己画超时机制
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('ETIMEOUT')), OP_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([promise, timeout]);
      clearTimeout(timeoutId);
      return result;
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.message === 'ETIMEOUT') {
        console.warn('⚠️ [Redis] 操作超时，强制降级 + 启动重连');
        this.isReady = false;
        this._scheduleReconnect();
      }
      // 其他错误也返回 safeDefault（连接断开、read ECONNRESET 等）
      return safeDefault;
    }
  }

  // ── 自动重连机制 ────────────────────────────────────────────────

  _scheduleReconnect() {
    if (this._reconnectTimer) return; // 已有重连任务在进行
    console.log('🔄 [Redis] 启动后台自动重连（每 5 秒尝试一次）...');
    this._reconnectTimer = setInterval(async () => {
      try {
        // 强制断开旧连接（清理半开 TCP socket）
        await this.client.disconnect().catch(() => {});
        await new Promise(r => setTimeout(r, 500));
        await this.client.connect();
        // isReady 将由 'ready' 事件设为 true，_clearReconnectTimer 也会被调用
      } catch (e) {
        // 仍然连不上，静默等待下一个周期
      }
    }, RECONNECT_INTERVAL_MS);
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer) {
      clearInterval(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  // 基础操作封装 (自动拼接前缀，并内置降级拦截)
  async set(key, value, ttlSeconds = null) {
    if (!this.isReady) return false;
    const fullKey = `${this.prefix}${key}`;
    try {
      let result;
      if (ttlSeconds) {
        result = await this._withTimeout(
          this.client.setEx(fullKey, ttlSeconds, String(value)),
          false
        );
      } else {
        result = await this._withTimeout(
          this.client.set(fullKey, String(value)),
          false
        );
      }
      return result !== false;  // false = 超时/失败，其他 = 成功
    } catch (e) {
      return false;
    }
  }

  async get(key) {
    if (!this.isReady) return null;
    const fullKey = `${this.prefix}${key}`;
    return this._withTimeout(this.client.get(fullKey), null);
  }

  async del(key) {
    if (!this.isReady) return false;
    const fullKey = `${this.prefix}${key}`;
    try {
      const result = await this._withTimeout(this.client.del(fullKey), false);
      return result !== false;
    } catch (e) {
      return false;
    }
  }

  /** 原子递增计数器，返回递增后的值 */
  async incr(key) {
    if (!this.isReady) return 1;  // 降级放行
    const fullKey = `${this.prefix}${key}`;
    return this._withTimeout(this.client.incr(fullKey), 1);
  }

  /** 设置 key 过期时间（秒） */
  async expire(key, ttlSeconds) {
    if (!this.isReady) return false;
    const fullKey = `${this.prefix}${key}`;
    return this._withTimeout(this.client.expire(fullKey, ttlSeconds), false);
  }

  /** 扫描匹配模式的所有 key（用于 admin 面板查询） */
  async scanKeys(pattern) {
    if (!this.isReady) return [];
    const fullPattern = `${this.prefix}${pattern}`;
    const keys = [];
    try {
      const result = await this._withTimeout(
        (async () => {
          const iter = this.client.scanIterator({ MATCH: fullPattern, COUNT: 200 });
          for await (const key of iter) { keys.push(key); }
          return keys;
        })(),
        []
      );
      return Array.isArray(result) ? result : keys;
    } catch (e) {
      return [];
    }
  }

  /** 主动健康检查 — 向 Redis 发送 PING 命令 */
  async ping() {
    try {
      await this._withTimeout(this.client.ping(), false);
      if (!this.isReady) {
        // ping 成功了但 isReady 还是 false，说明之前被超时降级了
        this.isReady = true;
        this._clearReconnectTimer();
        console.log('✅ [Redis] ping 成功，恢复服务');
      }
      return true;
    } catch (e) {
      this.isReady = false;
      this._scheduleReconnect();
      return false;
    }
  }

  /** 获取 key 的剩余 TTL（秒） */
  async ttl(key) {
    if (!this.isReady) return -2;
    const fullKey = `${this.prefix}${key}`;
    return this._withTimeout(this.client.ttl(fullKey), -2);
  }
}

module.exports = new RedisWrapper();