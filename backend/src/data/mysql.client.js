// backend/src/data/mysql.client.js
const mysql = require('mysql2/promise');
const argon2 = require('argon2');
const env = require('../config/env');

class MySQLClient {
  constructor() {
    this.pool = null;
  }

  /**
   * 初始化连接池 + 建表 + 种子数据
   */
  async init() {
    const config = {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      database: env.MYSQL_DATABASE,
      charset: 'utf8mb4',
      // 连接池参数
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
      connectTimeout: 3000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 3000, // 3 秒后开始 TCP keepalive 探测，快速发现僵尸连接
    };

    // ── 连接重试：间隔 500ms，最多 3 次 ──
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        this.pool = mysql.createPool(config);
        // 验证连接可用
        const conn = await this.pool.getConnection();
        conn.release();
        console.log('✅ [MySQL] 连接池创建成功');
        break;
      } catch (err) {
        lastErr = err;
        console.error(`❌ [MySQL] 连接失败 (第 ${attempt}/3 次): ${err.message}`);
        if (attempt < 3) {
          console.log(`⏳ [MySQL] 500ms 后重试...`);
          await this._sleep(500);
        }
      }
    }

    if (!this.pool) {
      console.error('💥 [MySQL] 3 次重试全部失败，数据库不可用');
      throw lastErr;
    }

    // 建表 & 种子
    await this._initTables();
  }

  // ── 基础 SQL 封装 ──────────────────────────────────────────

  /**
   * 执行 INSERT / UPDATE / DELETE
   * 使用 query() 而非 execute()，避免 MySQL prepared statement
   * 对多行 INSERT 参数绑定的兼容性问题
   * @returns {Promise<{id: number, changes: number}>}
   */
  async run(sql, params = []) {
    const [result] = await this.pool.query(sql, params);
    return { id: result.insertId, changes: result.affectedRows };
  }

  /**
   * 查询单行
   * @returns {Promise<Object|null>}
   */
  async get(sql, params = []) {
    const [rows] = await this.pool.query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * 查询多行
   * 使用 query() 而非 execute() 以避免 MySQL prepared statement
   * 对 LIMIT/OFFSET 占位符的限制
   * @returns {Promise<Array<Object>>}
   */
  async all(sql, params = []) {
    const [rows] = await this.pool.query(sql, params);
    return rows;
  }

  // ── 建表 ───────────────────────────────────────────────────

  async _initTables() {
    console.log('⏳ [MySQL] 正在同步数据表结构...');

    // 1. 管理员账号表
    await this.run(`
      CREATE TABLE IF NOT EXISTS sys_admins (
        id              INT           AUTO_INCREMENT PRIMARY KEY,
        username        VARCHAR(128)  NOT NULL UNIQUE,
        password_hash   VARCHAR(255)  NOT NULL,
        status          TINYINT       NOT NULL DEFAULT 1,
        last_login_ip   VARCHAR(45),
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 2. 审计日志表
    await this.run(`
      CREATE TABLE IF NOT EXISTS sys_audit_logs (
        id              INT           AUTO_INCREMENT PRIMARY KEY,
        admin_id        INT           NOT NULL,
        action_type     VARCHAR(64)   NOT NULL,
        target_resource VARCHAR(255)  NOT NULL,
        ip_address      VARCHAR(45)   NOT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_admin    (admin_id),
        INDEX idx_audit_created  (created_at DESC),
        INDEX idx_audit_action   (action_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 3. 用户注册表
    await this.run(`
      CREATE TABLE IF NOT EXISTS sys_users (
        id              INT           AUTO_INCREMENT PRIMARY KEY,
        phone           VARCHAR(255)  NOT NULL,
        phone_hash      VARCHAR(64)   NOT NULL,
        device_hash     VARCHAR(64)   DEFAULT '',
        name            VARCHAR(64)   NOT NULL,
        status          TINYINT       NOT NULL DEFAULT 1,
        registered_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        cancelled_at    DATETIME,
        INDEX idx_users_phone_hash  (phone_hash),
        INDEX idx_users_device_hash (device_hash)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 4. 设备指纹黑名单表
    await this.run(`
      CREATE TABLE IF NOT EXISTS sys_blacklist (
        id                  INT           AUTO_INCREMENT PRIMARY KEY,
        device_fingerprint  VARCHAR(128)  NOT NULL UNIQUE,
        phone_hash          VARCHAR(64),
        reason              VARCHAR(255)  NOT NULL DEFAULT '',
        created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_blacklist_phone (phone_hash)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 4.5 白名单持久化表（双写 Redis + MySQL）
    await this.run(`
      CREATE TABLE IF NOT EXISTS sys_whitelist (
        id              INT           AUTO_INCREMENT PRIMARY KEY,
        type            VARCHAR(10)   NOT NULL COMMENT 'ip | device',
        value           VARCHAR(128)  NOT NULL,
        remark          VARCHAR(255)  NOT NULL DEFAULT '',
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by      INT           DEFAULT NULL,
        UNIQUE KEY uq_whitelist_type_value (type, value)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 5. 不可逆哈希风控归档表
    await this.run(`
      CREATE TABLE IF NOT EXISTS risk_hash_archives (
        id              INT           AUTO_INCREMENT PRIMARY KEY,
        fingerprint     VARCHAR(128)  NOT NULL UNIQUE,
        phone_hash      VARCHAR(64)   DEFAULT '' COMMENT '手机号加盐SHA256哈希',
        phone_mask      VARCHAR(16)   NOT NULL DEFAULT '',
        reason          VARCHAR(255)  NOT NULL DEFAULT '',
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at      DATETIME      NOT NULL,
        INDEX idx_hash_archives_phone (phone_hash),
        INDEX idx_hash_archives_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 5.1 手机号黑名单映射表
    await this.run(`
      CREATE TABLE IF NOT EXISTS phone_blacklist_map (
        id              INT           AUTO_INCREMENT PRIMARY KEY,
        phone_hash      VARCHAR(64)   NOT NULL UNIQUE,
        fingerprint     VARCHAR(128)  NOT NULL,
        phone_mask      VARCHAR(16)   NOT NULL DEFAULT '',
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at      DATETIME      NOT NULL,
        INDEX idx_phone_bl_hash (phone_hash)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 兼容旧表：自动添加phone_hash字段（如果不存在）
    try {
      await this.run(`ALTER TABLE risk_hash_archives ADD COLUMN phone_hash VARCHAR(64) DEFAULT '' AFTER fingerprint`);
      await this.run(`ALTER TABLE risk_hash_archives ADD INDEX idx_hash_archives_phone (phone_hash)`);
      console.log('✅ [MySQL] 已为risk_hash_archives表自动添加phone_hash字段');
    } catch (e) {
      // 字段已存在，忽略错误
    }

    // 6. 风控拦截日志表
    await this.run(`
      CREATE TABLE IF NOT EXISTS risk_intercept_logs (
        id               INT           AUTO_INCREMENT PRIMARY KEY,
        ip_address       VARCHAR(45)   NOT NULL,
        device_hash      VARCHAR(64)   DEFAULT '',
        intercept_reason VARCHAR(255)  NOT NULL,
        risk_level       VARCHAR(10)   NOT NULL,
        created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_intercept_created (created_at DESC),
        INDEX idx_intercept_ip      (ip_address),
        INDEX idx_intercept_level   (risk_level)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 7. 风控规则配置表
    await this.run(`
      CREATE TABLE IF NOT EXISTS sys_config (
        id              INT           AUTO_INCREMENT PRIMARY KEY,
        config_key      VARCHAR(64)   NOT NULL UNIQUE,
        config_value    VARCHAR(255)  NOT NULL,
        updated_by      VARCHAR(64)   DEFAULT 'system',
        updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 8. 管理员操作日志表
    await this.run(`
      CREATE TABLE IF NOT EXISTS sys_operation_logs (
        id              INT           AUTO_INCREMENT PRIMARY KEY,
        admin_id        INT           NOT NULL,
        action_type     VARCHAR(64)   NOT NULL,
        target_resource VARCHAR(255)  NOT NULL,
        detail          TEXT,
        ip_address      VARCHAR(45)   NOT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_oplog_admin   (admin_id),
        INDEX idx_oplog_action  (action_type),
        INDEX idx_oplog_created (created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ [MySQL] 数据表结构同步完成');

    // 种子管理员 + 默认风控配置
    await this._seedInitialAdmin();
    await this._seedDefaultConfig();
  }

  async _seedDefaultConfig() {
    const configService = require('../services/config.service');
    try {
      await configService.seedDefaults();
    } catch (e) {
      // 配置种子非关键路径
    }
  }

  async _seedInitialAdmin() {
    const admin = await this.get(
      'SELECT id FROM sys_admins WHERE username = ?',
      [env.ADMIN_USERNAME]
    );
    if (!admin) {
      console.log(`⏳ [MySQL] 未检测到初始管理员账号 [${env.ADMIN_USERNAME}]，正在自动创建...`);
      const hash = await argon2.hash(env.ADMIN_PASSWORD, { type: argon2.argon2id });
      await this.run(
        'INSERT INTO sys_admins (username, password_hash) VALUES (?, ?)',
        [env.ADMIN_USERNAME, hash]
      );
      console.log('✅ [MySQL] 初始管理员账号注入成功');
    }
  }

  // ── 工具 ───────────────────────────────────────────────────

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 健康检查 — 创建独立短连接进行 SELECT 1（带 connectTimeout）
   * 使用独立连接而非连接池，避免容器 pause 后池中旧连接 TCP 半开挂死
   */
  async healthCheck() {
    let conn;
    try {
      conn = await mysql.createConnection({
        host: env.MYSQL_HOST,
        port: env.MYSQL_PORT,
        user: env.MYSQL_USER,
        password: env.MYSQL_PASSWORD,
        database: env.MYSQL_DATABASE,
        connectTimeout: 3000,
      });
      await conn.execute('SELECT 1');
      return true;
    } catch (e) {
      return false;
    } finally {
      if (conn) {
        try { await conn.end(); } catch {}
      }
    }
  }

  /**
   * 优雅关闭连接池
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      console.log('✅ [MySQL] 连接池已关闭');
    }
  }

  /**
   * 连接池预热 — 容器 pause/unpause 恢复后，主动清空并重建连接池中的僵尸连接。
   * 通过执行 SELECT 1 触发 mysql2 自动检测和替换死连接。
   * 应在健康探针检测到 MySQL 恢复后立即调用。
   */
  async warmupPool() {
    if (!this.pool) return;
    try {
      const conn = await this.pool.getConnection();
      await conn.ping();             // mysql2 内置 ping，检测连接是否存活
      await conn.query('SELECT 1');  // 二次确认
      conn.release();
      return true;
    } catch (e) {
      // 池中连接已失效（容器 pause/unpause 导致），
      // 错误会被 mysql2 捕获并自动创建新连接，重试一次
      console.warn('⚠️ [MySQL] 连接池首次查询失败（可能僵尸连接），自动恢复中...');
      try {
        const conn = await this.pool.getConnection();
        await conn.ping();
        conn.release();
        return true;
      } catch (e2) {
        console.error('❌ [MySQL] 连接池恢复失败:', e2.message);
        return false;
      }
    }
  }
}

module.exports = new MySQLClient();
