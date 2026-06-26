// backend/src/data/redis.client.js
const { createClient } = require('redis');
const env = require('../config/env');

class RedisWrapper {
  constructor() {
    this.client = createClient({
      socket: {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        reconnectStrategy: false
      },
      password: env.REDIS_PASSWORD || undefined
    });
    
    this.isReady = false; // 降级标识：标记当前 Redis 是否可用
    this.prefix = 'pf:';  // 强制的命名空间前缀
    
    this._bindEvents();
  }

  _bindEvents() {
    this.client.on('connect', () => console.log('⏳ [Redis] 正在连接...'));
    this.client.on('ready', () => {
      this.isReady = true;
      console.log('✅ [Redis] 连接成功，缓存服务已就绪');
    });
    this.client.on('error', (err) => {
      this.isReady = false;
      console.error('❌ [Redis] 连接异常，进入降级模式:', err.message);
    });
    this.client.on('end', () => {
      this.isReady = false;
      console.warn('⚠️ [Redis] 连接已断开');
    });
  }

  async connect() {
    try {
      await this.client.connect();
    } catch (error) {
      console.error('❌ [Redis] 初始连接失败，系统将以无缓存模式降级运行');
      // 不抛出异常，防止应用崩溃
    }
  }

  // 基础操作封装 (自动拼接前缀，并内置降级拦截)
  async set(key, value, ttlSeconds = null) {
    if (!this.isReady) return false;
    const fullKey = `${this.prefix}${key}`;
    try {
      if (ttlSeconds) {
        await this.client.setEx(fullKey, ttlSeconds, String(value));
      } else {
        await this.client.set(fullKey, String(value));
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async get(key) {
    if (!this.isReady) return null;
    const fullKey = `${this.prefix}${key}`;
    try {
      return await this.client.get(fullKey);
    } catch (e) {
      return null;
    }
  }

  async del(key) {
    if (!this.isReady) return false;
    const fullKey = `${this.prefix}${key}`;
    try {
      await this.client.del(fullKey);
      return true;
    } catch (e) {
      return false;
    }
  }
}

module.exports = new RedisWrapper();