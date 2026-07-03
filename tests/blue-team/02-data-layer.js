// tests/blue-team/02-data-layer.js
// ================================================================
// 模块二：数据层验收脚本（独立运行）
// 运行: node tests/blue-team/02-data-layer.js
// ================================================================
// 8 个用例：表结构校验 / 读写一致性 / 并发写入 / 事务回滚 /
//          Redis持久化 / 手机号密文存储 / 手机号明文返回 / 索引验证
// ================================================================

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const mysql = require('mysql2/promise');
const { createClient } = require('redis');
const axios = require('axios');
const crypto = require('crypto');

// ─── 配置（全部从 .env 读取，宿主连接用 docker-compose 映射端口）─
const API_PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${API_PORT}/api/v1`;
// .env 里的 MYSQL_HOST/MYSQL_PORT 是 Docker 内部地址，宿主机必须用 127.0.0.1:3307
const DB_HOST = process.env.MYSQL_EXTERNAL_HOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.MYSQL_EXTERNAL_PORT, 10) || 3307;
const MYSQL_CFG = {
  host:     DB_HOST,
  port:     DB_PORT,
  user:     process.env.MYSQL_USER     || 'parking',
  password: process.env.MYSQL_ROOT_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'parking_fraud',
};
// .env 里的 REDIS_HOST=redis 是 Docker 内部地址，宿主机用 127.0.0.1
const REDIS_HOST_EXT = process.env.REDIS_EXTERNAL_HOST || '127.0.0.1';
const REDIS_PORT_EXT = process.env.REDIS_EXTERNAL_PORT || process.env.REDIS_PORT || 6379;
const REDIS_URL = `redis://${REDIS_HOST_EXT}:${REDIS_PORT_EXT}`;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';
const ENCRYPT_KEY = process.env.ENCRYPT_KEY || 'change-me-to-a-secure-random-key-32chars';
const PHONE_HASH_SALT = process.env.PHONE_HASH_SALT || 'parking-fraud-phone-salt-2026-secure-v1';
// 与后端 encryption.js hashPhone() 保持一致的加盐哈希
function hashPhone(phone) {
  return crypto.createHash('sha256').update(PHONE_HASH_SALT + phone + PHONE_HASH_SALT).digest('hex');
}

// ─── 颜色 ────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m'
};

// ─── 跟踪 ────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function assert(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  ${c.green}✓${c.reset} ${name}`); }
  else { failed++; failures.push({ name, detail }); console.log(`  ${c.red}✗${c.reset} ${name}${detail ? c.dim + ' — ' + detail + c.reset : ''}`); }
  return condition;
}

function title(text) {
  console.log(`\n${c.bold}${c.cyan}━━━ ${text} ━━━${c.reset}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = axios.create({ baseURL: BASE, validateStatus: () => true, timeout: 10000 });

// 生成不重复的 11 位手机号（兼容 VARCHAR(16) 列宽）
const RUN_ID = String(Date.now() % 100000).padStart(5, '0');
const genPhone = (suffix) => `138${RUN_ID}${String(suffix).padStart(3, '0')}`;

// ─── 共享连接（用例间复用）────────────────────────────────────────
let conn = null;
let redisCli = null;

async function getConn() {
  if (!conn) {
    conn = await mysql.createConnection({
      host: MYSQL_CFG.host, port: MYSQL_CFG.port,
      user: MYSQL_CFG.user, password: MYSQL_CFG.password,
      database: MYSQL_CFG.database,
    });
  }
  return conn;
}

async function getRedis() {
  if (!redisCli) {
    redisCli = createClient({ url: REDIS_URL, password: REDIS_PASSWORD || undefined });
    await redisCli.connect();
  }
  return redisCli;
}

// ═════════════════════════════════════════════════════════════════
//  用例1：表结构一致性校验
// ═════════════════════════════════════════════════════════════════
async function case01_tableSchema() {
  const db = await getConn();

  const expected = {
    sys_admins:   ['id','username','password_hash','status','last_login_ip','created_at'],
    sys_users:    ['id','phone','phone_hash','device_hash','name','status','registered_at','cancelled_at'],
    sys_blacklist:['id','device_fingerprint','phone_hash','reason','created_at'],
    risk_hash_archives: ['id','fingerprint','phone_mask','created_at','expires_at'],
    risk_intercept_logs:['id','ip_address','device_hash','intercept_reason','risk_level','created_at'],
    sys_audit_logs:['id','admin_id','action_type','target_resource','ip_address','created_at'],
  };

  let allOk = true;
  for (const [table, wantCols] of Object.entries(expected)) {
    try {
      const [rows] = await db.execute(`DESCRIBE ${table}`);
      const gotCols = rows.map(r => r.Field).sort();
      const wantSorted = [...wantCols].sort();
      const match = gotCols.length >= wantSorted.length && wantSorted.every(c => gotCols.includes(c));
      if (!match) allOk = false;
    } catch (e) { allOk = false; }
  }
  assert('1. 表结构一致性校验', allOk,
    allOk ? '6 张核心表字段符合预期' : '部分表缺失或字段不匹配');
}

// ═════════════════════════════════════════════════════════════════
//  用例2：数据读写一致性
// ═════════════════════════════════════════════════════════════════
async function case02_readWriteConsistency() {
  const db = await getConn();
  const testPhone = genPhone('101');
  const testName = '读写一致性测试';
  const testHash = crypto.createHash('sha256').update(testPhone).digest('hex');

  // 写入
  await db.execute(
    `INSERT INTO sys_users (phone, phone_hash, device_hash, name, status)
     VALUES (?, ?, ?, ?, 1)`,
    [testPhone, testHash, 'device-rw-test', testName]
  );

  // 读取
  const [rows] = await db.execute(
    `SELECT phone, phone_hash, device_hash, name, status FROM sys_users WHERE phone_hash = ?`,
    [testHash]
  );

  // 清理
  await db.execute(`DELETE FROM sys_users WHERE phone_hash = ?`, [testHash]);

  const ok = rows.length === 1
    && rows[0].phone === testPhone
    && rows[0].phone_hash === testHash
    && rows[0].name === testName
    && rows[0].status === 1;
  assert('2. 数据读写一致性', ok,
    ok ? '写入后按 hash 查询，字段值完全匹配' : `rows=${rows.length}`);
}

// ═════════════════════════════════════════════════════════════════
//  用例3：MySQL 并发写入
// ═════════════════════════════════════════════════════════════════
async function case03_concurrentWrite() {
  const db = await getConn();
  const deviceId = `device-concurrent-${RUN_ID}`;

  // 并发插入 10 条
  const phones = [];
  const tasks = [];
  for (let i = 0; i < 10; i++) {
    const phone = genPhone(`2${String(i).padStart(2, '0')}`);
    phones.push(phone);
    tasks.push(
      db.execute(
        `INSERT INTO sys_users (phone, phone_hash, device_hash, name, status)
         VALUES (?, ?, ?, ?, 1)`,
        [phone, crypto.createHash('sha256').update(phone).digest('hex'),
         deviceId, `并发用户${i}`]
      )
    );
  }

  const results = await Promise.allSettled(tasks);
  const allInserted = results.every(r => r.status === 'fulfilled');
  const insertedCount = results.filter(r => r.status === 'fulfilled').length;

  // 查询验证
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS cnt FROM sys_users WHERE device_hash = ?`,
    [deviceId]
  );

  // 清理
  for (const phone of phones) {
    await db.execute(
      `DELETE FROM sys_users WHERE phone_hash = ?`,
      [crypto.createHash('sha256').update(phone).digest('hex')]
    ).catch(() => {});
  }

  const ok = allInserted && Number(rows[0].cnt) === 10;
  assert('3. MySQL 并发写入', ok,
    ok ? '10 条并发写入全部成功' : `inserted=${insertedCount} dbCount=${rows[0]?.cnt}`);
}

// ═════════════════════════════════════════════════════════════════
//  用例4：事务回滚验证
// ═════════════════════════════════════════════════════════════════
async function case04_transactionRollback() {
  const db = await getConn();
  const p1 = genPhone('401'), p2 = genPhone('402');
  const h1 = crypto.createHash('sha256').update(p1).digest('hex');
  const h2 = crypto.createHash('sha256').update(p2).digest('hex');

  // 开启事务（START TRANSACTION 不能用 prepared statement，用 query）
  await db.query('START TRANSACTION');
  await db.execute(
    `INSERT INTO sys_users (phone, phone_hash, device_hash, name, status)
     VALUES (?, ?, ?, ?, 1)`, [p1, h1, 'device-rollback', '回滚测试1']
  );
  await db.execute(
    `INSERT INTO sys_users (phone, phone_hash, device_hash, name, status)
     VALUES (?, ?, ?, ?, 1)`, [p2, h2, 'device-rollback', '回滚测试2']
  );
  // 主动回滚
  await db.query('ROLLBACK');

  // 验证两条数据均未写入
  const [r1] = await db.execute(`SELECT id FROM sys_users WHERE phone_hash = ?`, [h1]);
  const [r2] = await db.execute(`SELECT id FROM sys_users WHERE phone_hash = ?`, [h2]);

  const ok = r1.length === 0 && r2.length === 0;
  assert('4. 事务回滚验证', ok,
    ok ? '事务回滚后两条数据均未写入' : `row1=${r1.length} row2=${r2.length}`);
}

// ═════════════════════════════════════════════════════════════════
//  用例5：Redis 持久化验证
// ═════════════════════════════════════════════════════════════════
async function case05_redisPersistence() {
  try {
    const rds = await getRedis();
    const testKey = `pf:test:persist:${Date.now()}`;
    const testVal = `persist-value-${Date.now()}`;

    // 写入 + 设置 TTL（模拟持久化）
    await rds.set(testKey, testVal);
    await rds.expire(testKey, 60);
    await rds.bgSave();  // 触发 RDB 持久化
    await sleep(500);

    // 读取验证
    const val = await rds.get(testKey);
    const ttl = await rds.ttl(testKey);

    // 清理
    await rds.del(testKey);

    const ok = val === testVal && ttl > 0;
    assert('5. Redis 持久化验证', ok,
      ok ? `写入成功，读取值正确，TTL=${ttl}s` : `val=${val} ttl=${ttl}`);
  } catch (e) {
    assert('5. Redis 持久化验证', false, `Redis 连接异常: ${e.message}`);
  }
}

// ═════════════════════════════════════════════════════════════════
//  用例6：手机号密文存储验证
// ═════════════════════════════════════════════════════════════════
async function case06_phoneEncryptedStorage() {
  const phone = genPhone('601');
  const db = await getConn();

  // 通过 API 注册（处理频控，最多重试 3 次）
  let regResp;
  for (let attempt = 0; attempt < 3; attempt++) {
    regResp = await api.post('/user/register', { phone, name: '密文测试', deviceId: 'device-enc-test' });
    if (regResp.data.code === 20000) break;
    if (regResp.data.code === 40101) { await sleep(61000); continue; } // 等频控过期
    break;
  }

  if (regResp.data.code !== 20000) {
    return assert('6. 手机号密文存储验证', false, `API 注册失败 code=${regResp.data.code}`);
  }

  await sleep(500); // 等待 MySQL 异步写入

  // 直连 DB 查询 phone 字段（使用与后端一致的加盐哈希）
  const phoneHash = hashPhone(phone);
  const [rows] = await db.execute(
    `SELECT phone FROM sys_users WHERE phone_hash = ?`, [phoneHash]
  );

  let ok = false;
  let detail = '未找到记录';
  if (rows.length > 0) {
    const dbPhone = rows[0].phone;
    // 密文格式应为 iv:cipher（含 ':' 分隔符，且不等于明文）
    ok = dbPhone.includes(':') && dbPhone !== phone;
    detail = ok
      ? `phone 字段为密文 (${dbPhone.substring(0, 24)}...)`
      : `phone 字段疑似明文: ${dbPhone}`;
  }

  assert('6. 手机号密文存储验证', ok, detail);
}

// ═════════════════════════════════════════════════════════════════
//  用例7：手机号明文返回验证
// ═════════════════════════════════════════════════════════════════
async function case07_phonePlaintextReturn() {
  const phone = genPhone('701');
  const db = await getConn();

  // 通过 API 注册（处理频控）
  let regResp;
  for (let attempt = 0; attempt < 3; attempt++) {
    regResp = await api.post('/user/register', { phone, name: '明文返回测试', deviceId: 'device-plain-test' });
    if (regResp.data.code === 20000) break;
    if (regResp.data.code === 40101) { await sleep(61000); continue; }
    break;
  }

  if (regResp.data.code !== 20000) {
    return assert('7. 手机号明文返回验证', false, `API 注册失败 code=${regResp.data.code}`);
  }

  await sleep(500);

  // 直连 DB 查询 + 用正确密钥解密（使用与后端一致的加盐哈希）
  const phoneHash = hashPhone(phone);
  const [rows] = await db.execute(
    `SELECT phone FROM sys_users WHERE phone_hash = ?`, [phoneHash]
  );

  let ok = false;
  let detail = '未找到记录';
  if (rows.length > 0) {
    const encrypted = rows[0].phone;
    try {
      const secretKey = crypto.createHash('sha256').update(ENCRYPT_KEY).digest();
      const [ivHex, cipherHex] = encrypted.split(':');
      const decipher = crypto.createDecipheriv('aes-256-cbc', secretKey, Buffer.from(ivHex, 'hex'));
      let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      ok = decrypted === phone;
      detail = ok ? '解密后手机号与注册时一致' : `解密结果不匹配: ${decrypted}`;
    } catch (e) {
      detail = `解密失败: ${e.message}`;
    }
  }

  assert('7. 手机号明文返回验证', ok, detail);
}

// ═════════════════════════════════════════════════════════════════
//  用例8：索引生效验证
// ═════════════════════════════════════════════════════════════════
async function case08_indexVerification() {
  const db = await getConn();

  // 先确保表中有数据
  const phone = genPhone('801');
  const phoneHash = crypto.createHash('sha256').update(phone).digest('hex');
  await db.execute(
    `INSERT INTO sys_users (phone, phone_hash, device_hash, name, status)
     VALUES (?, ?, ?, ?, 1)`,
    [phone, phoneHash, 'device-for-index-test', '索引测试用户']
  );

  // EXPLAIN 查询 device_hash 字段
  const [explainRows] = await db.execute(
    `EXPLAIN SELECT * FROM sys_users WHERE device_hash = ?`,
    ['device-for-index-test']
  );

  // 清理
  await db.execute(`DELETE FROM sys_users WHERE phone_hash = ?`, [phoneHash]);

  const explain = explainRows[0];
  // type = 'ref' 或 'range' 表示命中索引，'ALL' 表示全表扫描
  const usedIndex = explain.type !== 'ALL' && explain.key !== null;
  const ok = usedIndex;

  assert('8. 索引生效验证', ok,
    ok ? `type=${explain.type} key=${explain.key} (命中索引)` : `type=${explain.type} key=${explain.key} (全表扫描)`);
}

// ═════════════════════════════════════════════════════════════════
//  主入口
// ═════════════════════════════════════════════════════════════════
async function run() {
  console.log(`\n${c.bold}${c.cyan}╔══════════════════════════════════════════════════════╗
║   模块二：数据层验收脚本 v1.0                        ║
╚══════════════════════════════════════════════════════╝${c.reset}`);
  console.log(`Target DB: ${MYSQL_CFG.host}:${MYSQL_CFG.port}/${MYSQL_CFG.database}`);
  console.log(`API Base: ${BASE}`);
  console.log(`Time:     ${new Date().toISOString()}`);

  // 🆕 清理 IP 黑名单 + 加入白名单（Module 1 可能残留）
  try {
    let redisPwd = process.env.REDIS_PASSWORD || '';
    if ((redisPwd.startsWith('"') && redisPwd.endsWith('"')) || (redisPwd.startsWith("'") && redisPwd.endsWith("'"))) {
      redisPwd = redisPwd.slice(1, -1);
    }
    const rdsClean = createClient({
      socket: { host: REDIS_HOST_EXT, port: parseInt(REDIS_PORT_EXT, 10) || 6379 },
      password: redisPwd || undefined
    });
    await rdsClean.connect();
    await rdsClean.del('pf:risk:ip_bl:127.0.0.1');
    console.log(`  ${c.green}✓${c.reset} 已清理残留 IP 黑名单`);
    await rdsClean.quit();
  } catch (e) {
    console.log(`  ${c.yellow}⚠${c.reset} Redis 清理跳过`);
  }

  const startTime = Date.now();

  // ── 执行 8 个用例 ──
  title('用例执行');
  await case01_tableSchema();
  await sleep(100);
  await case02_readWriteConsistency();
  await sleep(100);
  await case03_concurrentWrite();
  await sleep(100);
  await case04_transactionRollback();
  await sleep(100);
  await case05_redisPersistence();
  await sleep(100);
  await case06_phoneEncryptedStorage();
  await sleep(100);
  await case07_phonePlaintextReturn();
  await sleep(100);
  await case08_indexVerification();

  // ── 清理连接 ──
  if (conn) await conn.end().catch(() => {});
  if (redisCli) await redisCli.quit().catch(() => {});

  // ── 汇总 ──
  const total = passed + failed;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';
  console.log(`\n${c.bold}${c.cyan}╔══════════════════════════════════════════════════════╗
║              验 收 汇 总                               ║
╚══════════════════════════════════════════════════════╝${c.reset}`);
  console.log(`  Total:  ${total}`);
  console.log(`  ${c.green}Passed: ${passed}${c.reset}`);
  console.log(`  ${c.red}Failed: ${failed}${c.reset}`);
  console.log(`  Time:   ${elapsed}s`);

  if (failures.length > 0) {
    console.log(`\n${c.dim}─── 失败详情 ───${c.reset}`);
    failures.forEach((f, i) => {
      console.log(`  ${c.red}${i + 1}. ${f.name}${c.reset}`);
      if (f.detail) console.log(`     ${c.dim}${f.detail}${c.reset}`);
    });
  }

  return { total, passed, failed, passRate, elapsed, failures };
}

// 支持直接运行，被 require 时不自动执行
module.exports = run;

if (require.main === module) {
  run().then(r => {
    if (r.failed > 0) process.exit(1);
  }).catch(e => {
    console.error(`\n${c.red}${c.bold}💥 脚本异常终止:${c.reset}`, e.message);
    if (conn) conn.end().catch(() => {});
    if (redisCli) redisCli.quit().catch(() => {});
    process.exit(2);
  });
}
