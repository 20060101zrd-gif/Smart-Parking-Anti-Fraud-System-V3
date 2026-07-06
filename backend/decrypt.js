#!/usr/bin/env node
// ──────────────────────────────────────────────────────────
//  一键解密工具 -- 查看所有用户的手机号
//  用法：
//    node decrypt.js              脱敏模式（默认全部）
//    node decrypt.js --full       完整手机号
//    node decrypt.js --limit=10   只看最近10条
//    node decrypt.js --help       查看帮助
// ──────────────────────────────────────────────────────────
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');
const encryption = require('./src/utils/encryption');
const env = require('./src/config/env');

const showFull = process.argv.includes('--full');
const showHelp = process.argv.includes('--help');
const limitArg  = process.argv.find(a => a.startsWith('--limit='));
const limit     = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1]) || 0) : 0;

if (showHelp) {
  console.log(`
╔═══════════════════════════════════════════════════╗
║  Parking Guard -- 用户手机号一键解密工具 v3.0      ║
╠═══════════════════════════════════════════════════╣
║                                                   ║
║  用法：                                            ║
║    node decrypt.js               脱敏模式（全部）   ║
║    node decrypt.js --full        完整手机号         ║
║    node decrypt.js --limit=10    只看最近 N 条      ║
║    node decrypt.js --help        查看本帮助          ║
║                                                   ║
║  前提：.env 已配置 ENCRYPT_KEY，Docker 正在运行    ║
║  安全：默认脱敏（138****5678），防止截屏泄露        ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
`);
  process.exit(0);
}

// 日期格式化：MySQL DATETIME --> YYYY-MM-DD HH:mm:ss
const fmtDate = (v) => {
  if (!v) return '-';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 19).replace('T', ' ');
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

async function main() {
  const isDockerHostname = env.MYSQL_HOST === 'mysql' || env.MYSQL_HOST === 'parking-mysql' || env.MYSQL_HOST === 'parking-mysql-1';
  const host = isDockerHostname ? '127.0.0.1' : env.MYSQL_HOST;
  const port = isDockerHostname ? 3307 : (env.MYSQL_PORT || 3306);

  console.log(`\n数据库连接: ${host}:${port} / ${env.MYSQL_DATABASE}`);

  const pool = mysql.createPool({
    host, port,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    charset: 'utf8mb4',
  });

  // 先查总数
  const [countRow] = await pool.query('SELECT COUNT(*) AS total FROM sys_users');
  const total = countRow[0]?.total || 0;

  if (total === 0) {
    console.log('\n没有找到用户记录，请先注册一些用户再运行本工具。\n');
    await pool.end();
    return;
  }

  // 查询：不传 limit 则全量
  const sql = limit > 0
    ? `SELECT id, phone, phone_hash, name, status, registered_at FROM sys_users ORDER BY id DESC LIMIT ?`
    : `SELECT id, phone, phone_hash, name, status, registered_at FROM sys_users ORDER BY id DESC`;
  const [rows] = limit > 0
    ? await pool.query(sql, [limit])
    : await pool.query(sql);

  const shown = rows.length;
  const mode  = showFull ? '完整模式' : '脱敏模式';

  console.log(`\n${shown} / ${total} 条记录  [${mode}]  ${limit > 0 ? '(限制 ' + limit + ' 条)' : ''}\n`);
  console.log('='.repeat(120));
  console.log('ID    | 姓名       | 手机号               | phone_hash(前16位)       | 状态   | 注册时间');
  console.log('='.repeat(120));

  for (const row of rows) {
    let phone = '(解密失败)';
    try {
      phone = encryption.decrypt(row.phone);
      if (!showFull) {
        phone = phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
      }
    } catch (e) {
      phone = (row.phone || '').substring(0, 16) + '...(解密失败)';
    }

    const hash16  = (row.phone_hash || '').substring(0, 16);
    const status  = row.status === 1 ? '正常' : '已注销';
    const regTime = fmtDate(row.registered_at);

    console.log(
      `${String(row.id).padEnd(5)} | ${(row.name || '-').padEnd(10)} | ${phone.padEnd(20)} | ${hash16.padEnd(24)} | ${status.padEnd(6)} | ${regTime}`
    );
  }

  console.log('='.repeat(120));
  console.log(`\n  node decrypt.js              -> 脱敏模式，全部 (${total} 条)`);
  console.log(`  node decrypt.js --full       -> 完整手机号`);
  console.log(`  node decrypt.js --limit=10   -> 只看最近 10 条`);
  console.log(`  解密密钥: ENCRYPT_KEY=${(env.ENCRYPT_KEY || '').slice(0, 4)}*** (来自 .env 文件)\n`);

  await pool.end();
}

main().catch(err => {
  console.error('运行错误:', err.message);
  process.exit(1);
});
