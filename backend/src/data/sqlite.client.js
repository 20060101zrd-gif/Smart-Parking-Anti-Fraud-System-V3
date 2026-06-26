// backend/src/data/sqlite.client.js
const sqlite3 = require('sqlite3').verbose();
const argon2 = require('argon2');
const env = require('../config/env');

class SQLiteClient {
  constructor() {
    this.db = null;
  }

  init() {
    console.log("🛠️ 当前正在尝试连接的数据库文件路径是:", env.SQLITE_PATH);
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(env.SQLITE_PATH, (err) => {
        if (err) {
          console.error('❌ [SQLite] 数据库连接失败:', err.message);
          return reject(err);
        }
        console.log('✅ [SQLite] 数据库连接成功');
        this._initTables().then(resolve).catch(reject);
      });
    });
  }

  // 基础 SQL 封装
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }
  // 请将此方法补充到 sqlite.client.js 中（与 get 方法并列）
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async _initTables() {
    console.log('⏳ [SQLite] 正在同步数据表结构...');
    
    // 1. 管理员账号表
    await this.run(`
      CREATE TABLE IF NOT EXISTS sys_admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        status INTEGER NOT NULL DEFAULT 1,
        last_login_ip TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. 审计日志表 (高频批量写入目标)
    await this.run(`
      CREATE TABLE IF NOT EXISTS sys_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        target_resource TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. 不可逆哈希风控归档表
    await this.run(`
      CREATE TABLE IF NOT EXISTS risk_hash_archives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT UNIQUE NOT NULL,
        phone_mask TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL
      )
    `);

    await this._seedInitialAdmin();
  }

  async _seedInitialAdmin() {
    const admin = await this.get(`SELECT id FROM sys_admins WHERE username = ?`, [env.ADMIN_USERNAME]);
    if (!admin) {
      console.log(`⏳ [SQLite] 未检测到初始管理员账号 [${env.ADMIN_USERNAME}]，正在自动创建...`);
      // 使用 Argon2id 慢哈希生成密码指纹
      const hash = await argon2.hash(env.ADMIN_PASSWORD, { type: argon2.argon2id });
      await this.run(`INSERT INTO sys_admins (username, password_hash) VALUES (?, ?)`, [env.ADMIN_USERNAME, hash]);
      console.log('✅ [SQLite] 初始管理员账号注入成功');
    }
  }
}

module.exports = new SQLiteClient();