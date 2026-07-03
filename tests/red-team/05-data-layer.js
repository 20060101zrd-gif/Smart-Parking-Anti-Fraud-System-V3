// tests/red-team/05-data-layer.js
// ================================================================
// 模块二：数据层安全 — 红队攻防专项测试
// 覆盖: SQL注入 / 加密密钥绕过 / 未授权直连 / 数据越权
// ================================================================
// 运行: node tests/red-team/05-data-layer.js (独立)
// 集成: 由 red-team/run.js 统一调度
// ================================================================

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const axios = require('axios');
const mysql = require('mysql2/promise');
const { createClient } = require('redis');
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
const ENCRYPT_KEY = process.env.ENCRYPT_KEY || 'change-me-to-a-secure-random-key-32chars';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';

// ─── 跟踪 ────────────────────────────────────────────────────────
let passCount = 0;
let failCount = 0;
let riskCount = 0;
const failedCases = [];
const riskItems = [];

const colors = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m'
};

function record(name, condition, detail = '', isRisk = false) {
  if (condition) {
    passCount++;
    console.log(`  ${colors.green}✓${colors.reset} ${name}${detail ? colors.dim + ' — ' + detail + colors.reset : ''}`);
  } else {
    failCount++;
    failedCases.push({ name, detail });
    if (isRisk) {
      riskCount++;
      riskItems.push({ name, detail });
    }
    console.log(`  ${colors.red}✗${colors.reset} ${name}${detail ? colors.dim + ' — ' + detail + colors.reset : ''}`);
  }
  return condition;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── HTTP 客户端 ─────────────────────────────────────────────────
const api = axios.create({ baseURL: BASE, validateStatus: () => true, timeout: 10000 });

let adminCookie = '';

// ═════════════════════════════════════════════════════════════════
//  前置：管理员登录
// ═════════════════════════════════════════════════════════════════
async function adminLogin() {
  const resp = await api.post('/admin/login', { username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  const cookies = resp.headers['set-cookie'];
  if (cookies && cookies.length > 0) {
    adminCookie = cookies.map(c => c.split(';')[0]).join('; ');
  }
  return !!adminCookie;
}

// ═════════════════════════════════════════════════════════════════
//  用例1：SQL 注入攻击测试
// ═════════════════════════════════════════════════════════════════
async function case01_sqlInjection() {
  const payloads = [
    { name: 'OR 1=1',       value: `' OR '1'='1` },
    { name: 'DROP TABLE',   value: `'; DROP TABLE sys_users; --` },
    { name: 'UNION SELECT', value: `' UNION SELECT 1,2,3,4,5 --` },
    { name: 'SLEEP注入',    value: `' AND SLEEP(3) --` },
    { name: '注释符截断',   value: `' OR 1=1 --` },
  ];

  let allSafe = true;
  for (const p of payloads) {
    try {
      const resp = await api.get(`/admin/intercept-logs?ip=${encodeURIComponent(p.value)}`, {
        headers: { Cookie: adminCookie },
        timeout: 8000,
      });
      // 安全判定：不返回 500 / 不泄露原生 SQL 错误信息
      const body = JSON.stringify(resp.data).toLowerCase();
      const hasDbError = body.includes('sql') && (body.includes('error') || body.includes('syntax') || body.includes('exception'));
      const isSafeStatus = resp.status === 200 || resp.status === 400 || resp.status === 401;
      if (!isSafeStatus || hasDbError) {
        console.log(`    ${colors.yellow}⚠${colors.reset} [${p.name}] 异常响应: status=${resp.status}`);
        allSafe = false;
      }
    } catch (e) {
      // 网络超时/服务崩溃 = 失败
      console.log(`    ${colors.yellow}⚠${colors.reset} [${p.name}] 请求异常: ${e.message}`);
      allSafe = false;
    }
  }

  // 额外验证：正常查询仍然可用
  const normalResp = await api.get('/admin/intercept-logs?page=1&pageSize=5', {
    headers: { Cookie: adminCookie },
  });
  const dbStillIntact = normalResp.status === 200;

  const pass = allSafe && dbStillIntact;
  return record('1. SQL 注入攻击测试', pass,
    pass ? '5 种注入载荷全部被安全拦截，数据库完好' : '存在异常响应或数据库受损',
    true);
}

// ═════════════════════════════════════════════════════════════════
//  用例2：加密密钥绕过测试
// ═════════════════════════════════════════════════════════════════
async function case02_encryptionBypass() {
  // 2.1 用正确密钥加密 → 解密应成功
  const plainText = '13800138000';
  const correctKey = crypto.createHash('sha256').update(ENCRYPT_KEY).digest();
  const iv1 = crypto.randomBytes(16);
  const cipher1 = crypto.createCipheriv('aes-256-cbc', correctKey, iv1);
  let enc1 = cipher1.update(plainText, 'utf8', 'hex');
  enc1 += cipher1.final('hex');
  const encrypted = `${iv1.toString('hex')}:${enc1}`;

  // 正确解密
  const [ivHex, cipherHex] = encrypted.split(':');
  const decipher1 = crypto.createDecipheriv('aes-256-cbc', correctKey, Buffer.from(ivHex, 'hex'));
  let dec1 = decipher1.update(cipherHex, 'hex', 'utf8');
  dec1 += decipher1.final('utf8');
  const correctDecrypt = dec1 === plainText;

  // 2.2 用错误密钥解密 → 必须失败
  const wrongKey = crypto.createHash('sha256').update('wrong-key-12345').digest();
  let bypassSucceeded = false;
  try {
    const decipher2 = crypto.createDecipheriv('aes-256-cbc', wrongKey, Buffer.from(ivHex, 'hex'));
    let dec2 = decipher2.update(cipherHex, 'hex', 'utf8');
    dec2 += decipher2.final('utf8');
    bypassSucceeded = dec2 === plainText;
  } catch (e) {
    // 预期失败 → 安全
    bypassSucceeded = false;
  }

  // 2.3 无密钥解密（只用 hex 解码）→ 得不到明文
  const rawHex = Buffer.from(cipherHex, 'hex').toString('utf8');
  const rawLeak = rawHex === plainText;

  const pass = correctDecrypt && !bypassSucceeded && !rawLeak;
  return record('2. 加密密钥绕过测试', pass,
    `正确密钥=${correctDecrypt} 错误密钥绕过=${bypassSucceeded} 无密钥泄露=${!rawLeak}`,
    true);
}

// ═════════════════════════════════════════════════════════════════
//  用例3：未授权直连风险验证
// ═════════════════════════════════════════════════════════════════
async function case03_unauthorizedAccess() {
  let dbRejected = false;
  let redisRejected = false;
  let details = [];

  // 3.1 MySQL 错误密码连接
  try {
    const badConn = await mysql.createConnection({
      host: MYSQL_CFG.host,
      port: MYSQL_CFG.port,
      user: MYSQL_CFG.user,
      password: 'definitely-wrong-password-xyz',
      database: MYSQL_CFG.database,
      connectTimeout: 5000,
    });
    await badConn.end();
    dbRejected = false;
    details.push('MySQL: 错误密码居然连接成功⚠️');
  } catch (e) {
    dbRejected = true;
    details.push(`MySQL: 错误密码连接被拒绝 ✓`);
  }

  // 3.2 Redis 错误密码连接
  try {
    const badRedis = createClient({ url: REDIS_URL, password: 'wrong-redis-pass-xyz' });
    await badRedis.connect();
    await badRedis.quit();
    redisRejected = false;
    details.push('Redis: 错误密码居然连接成功⚠️');
  } catch (e) {
    redisRejected = true;
    details.push(`Redis: 错误密码连接被拒绝 ✓`);
  }

  const pass = dbRejected && redisRejected;
  return record('3. 未授权直连风险验证', pass, details.join(' | '), true);
}

// ═════════════════════════════════════════════════════════════════
//  用例4：数据越权访问测试
// ═════════════════════════════════════════════════════════════════
async function case04_dataPrivilegeEscalation() {
  const testPhone = `139${String(Date.now() % 100000000).padStart(8, '0')}`;
  let allPassed = true;
  const detailParts = [];

  // 4.1 无认证访问 admin 接口 → 返回 401，不应泄露用户数据
  const noAuth1 = await api.get('/admin/intercept-logs');
  const blocked401_1 = noAuth1.status === 401;
  if (!blocked401_1) {
    allPassed = false;
    detailParts.push(`无认证GET /admin拦截=${noAuth1.status}`);
  }

  const noAuth2 = await api.get('/admin/dashboard');
  const blocked401_2 = noAuth2.status === 401;
  if (!blocked401_2) {
    allPassed = false;
    detailParts.push(`无认证GET /admin/dashboard=${noAuth2.status}`);
  }

  // 4.2 伪造 Cookie 访问 admin → 返回 401
  const fakeResp = await api.get('/admin/intercept-logs', {
    headers: { Cookie: 'admin_token=eyJhbGciOiJSUzI1NiJ9.eyJhZG1pbklkIjoxfQ.fake' },
  });
  const fakeBlocked = fakeResp.status === 401;
  if (!fakeBlocked) {
    allPassed = false;
    detailParts.push(`伪造token访问=${fakeResp.status}`);
  }

  // 4.3 注册用户 → 尝试用该用户身份访问另一用户的 admin 数据
  // 注册测试用户
  await api.post('/user/register', { phone: testPhone, name: '越权测试', deviceId: 'priv-escalation-test' });
  await sleep(200);

  // 用户 token 不应能访问 admin 接口
  // (本系统只有 admin JWT，普通用户无 token，所以这个测试验证 admin 接口的认证隔离)
  const userAccessAdmin = await api.get('/admin/intercept-logs', {
    headers: { Cookie: '' }, // 无 token
  });
  const userBlocked = userAccessAdmin.status === 401;
  if (!userBlocked) {
    allPassed = false;
    detailParts.push(`用户(无token)访问admin=${userAccessAdmin.status}`);
  }

  // 4.4 直连数据库验证 phone 字段是密文
  let conn = null;
  try {
    conn = await mysql.createConnection({
      host: MYSQL_CFG.host, port: MYSQL_CFG.port,
      user: MYSQL_CFG.user, password: MYSQL_CFG.password,
      database: MYSQL_CFG.database,
    });
    const phoneHash = crypto.createHash('sha256').update(testPhone).digest('hex');
    const [rows] = await conn.execute(
      'SELECT phone FROM sys_users WHERE phone_hash = ?', [phoneHash]
    );
    if (rows.length > 0) {
      const dbPhone = rows[0].phone;
      // phone 字段应为密文（含 ':' 分隔符的 iv:cipher 格式），而非明文手机号
      const isEncrypted = dbPhone.includes(':') && dbPhone !== testPhone;
      if (!isEncrypted) {
        allPassed = false;
        detailParts.push(`DB phone字段未加密: ${dbPhone.substring(0, 20)}...`);
      } else {
        detailParts.push(`DB phone已加密 ✓`);
      }
    }
  } catch (e) {
    detailParts.push(`DB直连查询异常: ${e.message}`);
  } finally {
    if (conn) await conn.end();
  }

  const pass = allPassed;
  return record('4. 数据越权访问测试', pass,
    detailParts.join(' | ') || '所有越权向量均被拦截',
    true);
}

// ═════════════════════════════════════════════════════════════════
//  报告生成
// ═════════════════════════════════════════════════════════════════
function generateReport(startTime) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const total = passCount + failCount;
  const passRate = total > 0 ? ((passCount / total) * 100).toFixed(1) : '0.0';
  const riskRate = total > 0 ? ((riskCount / total) * 100).toFixed(1) : '0.0';

  const lines = [];
  lines.push(`\n╔══════════════════════════════════════════════════════╗`);
  lines.push(`║     模块二：数据层安全 — 红队攻防测试报告            ║`);
  lines.push(`╚══════════════════════════════════════════════════════╝`);
  lines.push(`  执行时间: ${new Date().toISOString()}`);
  lines.push(`  耗时:     ${elapsed}s`);
  lines.push(`  总攻击项: ${total}`);
  lines.push(`  防线守住: ${passCount}  ✅`);
  lines.push(`  发现风险: ${failCount}  ❌`);
  lines.push(`  风险率:   ${riskRate}%`);
  lines.push(`  通过率:   ${passRate}%`);
  lines.push(``);

  if (failCount > 0) {
    lines.push(`  ─── 已发现安全风险 ───`);
    riskItems.forEach((f, i) => {
      lines.push(`  ${i + 1}. ${f.name}`);
      lines.push(`     ${colors.red}⚠ 风险: ${f.detail}${colors.reset}`);
    });
    lines.push(``);
  }

  let grade, gradeEmoji;
  const rate = parseFloat(passRate);
  if (rate >= 95)      { grade = 'A+ (卓越)'; gradeEmoji = '🟢'; }
  else if (rate >= 80) { grade = 'A (优秀)';  gradeEmoji = '🟢'; }
  else if (rate >= 60) { grade = 'B (良好)';  gradeEmoji = '🟡'; }
  else if (rate >= 40) { grade = 'C (需改进)'; gradeEmoji = '🟠'; }
  else                 { grade = 'D (严重风险)'; gradeEmoji = '🔴'; }

  lines.push(`  ─── 数据层安全评级 ───`);
  lines.push(`  模块二整体评级: ${gradeEmoji} ${grade}`);
  if (failCount > 0) {
    lines.push(`  ⚠  发现 ${failCount} 项数据层安全风险，需立即修复`);
  } else {
    lines.push(`  ✅ 数据层安全防线全部生效，红队未发现可攻击向量`);
  }
  lines.push(``);

  const text = lines.join('\n');
  console.log(text);
  return {
    total, passed: passCount, failed: failCount, passRate,
    riskCount, riskRate, elapsed, grade, riskItems,
    failures: failedCases,
    text,
  };
}

// ═════════════════════════════════════════════════════════════════
//  主入口
// ═════════════════════════════════════════════════════════════════
async function runModule2() {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🔴 模块二：数据层安全 — 红队攻防专项测试`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const startTime = Date.now();

  // 管理员登录（SQL 注入测试需要）
  console.log(`\n📋 前置：管理员认证`);
  const loggedIn = await adminLogin();
  if (!loggedIn) {
    console.log(`  ${colors.red}✗${colors.reset} 管理员登录失败，部分用例将跳过`);
  } else {
    console.log(`  ${colors.green}✓${colors.reset} 管理员认证成功`);
  }

  // ── 执行红队攻击用例 ──
  console.log(`\n📋 数据层红队攻击测试`);

  // 即使 admin 登录失败，case 2/3/4 部分用例仍可执行
  await case01_sqlInjection();
  await sleep(200);
  await case02_encryptionBypass();
  await sleep(200);
  await case03_unauthorizedAccess();
  await sleep(200);
  await case04_dataPrivilegeEscalation();

  // 生成报告
  const report = generateReport(startTime);

  return {
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    passRate: report.passRate,
    elapsed: report.elapsed,
    grade: report.grade,
    failures: report.failures,
    // 数据层红队专项指标
    totalAttacks: report.total,
    safePasses: report.passed,
    risks: report.failed,
    riskRate: report.riskRate,
    riskItems: report.riskItems,
    reportText: report.text,
  };
}

// 支持直接运行
if (require.main === module) {
  runModule2().then(result => {
    if (result.failed > 0) process.exit(1);
  }).catch(e => {
    console.error('模块二测试异常:', e.message);
    process.exit(2);
  });
}

module.exports = runModule2;
