// tests/red-team/04-risk-control.js
// ================================================================
// 模块一：风控核心升级 — 红队渗透测试套件
// 覆盖: 三级风险分级 / IP限流+黑名单 / 滑动验证码攻防 / 拦截日志 / 白名单
// ================================================================
// 运行: node tests/red-team/04-risk-control.js (独立运行)
// 集成: 由 red-team/run.js 统一调度
// ================================================================

const axios = require('axios');
const { createClient } = require('redis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// ─── 配置 ────────────────────────────────────────────────────────
const BASE = 'http://127.0.0.1:3000/api/v1';
const REDIS_PREFIX = 'pf:';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';

// ─── 跟踪 ────────────────────────────────────────────────────────
let passCount = 0;
let failCount = 0;
const failedCases = [];

function record(name, condition, detail = '') {
  if (condition) {
    passCount++;
  } else {
    failCount++;
    failedCases.push({ name, detail });
  }
  return condition;
}

// ─── Redis 客户端 (仅用于 TTL 操作) ──────────────────────────────
let redisClient = null;
async function connectRedis() {
  redisClient = createClient({
    socket: { host: '127.0.0.1', port: 6379 },
    password: process.env.REDIS_PASSWORD || undefined
  });
  redisClient.on('error', () => {});
  await redisClient.connect();
}
async function setRedisTtl(key, ttlSeconds) {
  if (!redisClient || !redisClient.isOpen) return;
  try { await redisClient.expire(`${REDIS_PREFIX}${key}`, ttlSeconds); } catch {}
}
async function getRedisKey(key) {
  if (!redisClient || !redisClient.isOpen) return null;
  try { return await redisClient.get(`${REDIS_PREFIX}${key}`); } catch { return null; }
}
async function disconnectRedis() {
  try { if (redisClient && redisClient.isOpen) await redisClient.quit(); } catch {}
}

// ─── HTTP 客户端 ─────────────────────────────────────────────────
const api = axios.create({ baseURL: BASE, validateStatus: () => true, timeout: 15000 });

// 固定 X-Forwarded-For 为 127.0.0.1，确保后端 IP 维度风控与测试清理/白名单一致
api.defaults.headers.common['X-Forwarded-For'] = '127.0.0.1';

// ─── 工具 ────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ═════════════════════════════════════════════════════════════════
//  测试用例
// ═════════════════════════════════════════════════════════════════

// ────────── 2.1 三级风险分级机制测试 ──────────

// 用例1：低风险正常请求
async function case01_lowRiskPass() {
  const phone = '13900000001';
  const resp = await api.post('/user/register', { phone, name: '低风险用户', deviceId: 'device-fresh-01' });
  const pass = record('1. 低风险正常请求', resp.status === 200 && resp.data.code === 20000,
    `status=${resp.status} code=${resp.data.code}`);
  return { pass, detail: `status=${resp.status} code=${resp.data.code} data=${JSON.stringify(resp.data.data)}` };
}

// 用例2：中风险触发验证码 (同IP 1分钟内≥4次注册)
async function case02_mediumRiskCaptcha() {
  const results = [];
  for (let i = 1; i <= 5; i++) {
    const resp = await api.post('/user/register', { phone: `1390000002${i}`, name: `中风险测试${i}` });
    results.push({ i, code: resp.data.code, status: resp.status });
    await sleep(60);
  }
  // 第4、5次应触发人机验证（40101，前面可能已有计数）
  const blocked = results.filter(r => r.code === 40101);
  const pass = record('2. 中风险触发验证码', blocked.length >= 1,
    `第4-5次码: ${results.slice(3).map(r => r.code).join(',')} (期望含 40101)`);
  return { pass, detail: `results: ${JSON.stringify(results)}` };
}

// 用例3：高风险黑名单拦截 (使用已拉黑设备)
async function case03_highRiskBlock() {
  // 用时间戳生成 11 位唯一手机号，避免跨运行状态污染
  const ts8 = Date.now().toString().slice(-8);
  const phoneA = `139${ts8}`;
  const phoneB = `138${ts8}`;
  const phoneC = `137${ts8}`;
  const deviceId = 'device-blacklisted-forever';

  // 第1次注册+注销（count=1，不拉黑设备）
  const r1a = await api.post('/user/register', { phone: phoneA, name: '待拉黑1', deviceId });
  console.log(`    注册1: status=${r1a.status} code=${r1a.data.code}`);
  await sleep(5200);
  const r1b = await api.post('/user/cancel', { phone: phoneA, deviceId });
  console.log(`    注销1: status=${r1b.status} code=${r1b.data.code}`);

  // 第2次注册+注销（count=2 ≥ cancelLimit=2，拉黑设备）
  await sleep(5200);
  const r2a = await api.post('/user/register', { phone: phoneB, name: '待拉黑2', deviceId });
  console.log(`    注册2: status=${r2a.status} code=${r2a.data.code}`);
  await sleep(5200);
  const r2b = await api.post('/user/cancel', { phone: phoneB, deviceId });
  console.log(`    注销2: status=${r2b.status} code=${r2b.data.code}`);

  // 验证 Redis 中确实写入了设备黑名单
  try {
    const redisVal = await redisClient.get(`${REDIS_PREFIX}risk:device_bl:${deviceId}`);
    console.log(`    Redis 检查: pf:risk:device_bl:${deviceId.substring(0,12)}... = ${redisVal}`);
  } catch (e) {
    console.log(`    Redis 检查异常: ${e.message}`);
  }

  // 第3次注册 → 应被设备黑名单拦截
  const resp = await api.post('/user/register', { phone: phoneC, name: '换号', deviceId });
  const pass = record('3. 高风险黑名单拦截', resp.status === 403 && resp.data.code === 40301,
    `status=${resp.status} code=${resp.data.code} (期望 403/40301)`);
  return { pass, detail: `status=${resp.status} code=${resp.data.code}` };
}

// ────────── 2.2 IP维度限流 + 临时黑名单测试 ──────────

// 用例4：IP限流阈值准确性 (6次注册，前5次正常，第6次429)
async function case04_ipRateLimitThreshold() {
  // 等待 reg_ip 窗口过期
  console.log('  ⏳ 等待 60s 让 reg_ip 频控窗口过期...');
  await sleep(61000);
  console.log('  ✓ 继续');

  const results = [];
  for (let i = 1; i <= 7; i++) {
    const resp = await api.post('/user/register', { phone: `139000100${String(i).padStart(2,'0')}`, name: `限流测试${i}` });
    results.push({ i, code: resp.data.code, status: resp.status });
    await sleep(50);
  }
  const first5ok = results.slice(0, 5).every(r => r.code === 20000);
  const last2blocked = results.slice(5).every(r => r.status === 429 || r.code === 40101 || r.code === 40029);
  const pass = record('4. IP限流阈值准确性', first5ok && last2blocked,
    `codes: ${results.map(r => r.code).join(',')}`);
  // 等待窗口过期
  console.log('  ⏳ 等待 60s 让 reg_ip 频控窗口过期...');
  await sleep(61000);
  console.log('  ✓ 继续');
  return { pass, detail: `results: ${JSON.stringify(results)}` };
}

// 用例5：IP间隔离性 — 需模拟不同IP (用 X-Forwarded-For 头)
async function case05_ipIsolation() {
  // 先耗尽本机IP注册额度
  for (let i = 1; i <= 6; i++) {
    await api.post('/user/register', { phone: `139000200${i}`, name: `隔离A${i}` });
    await sleep(40);
  }
  // 模拟另一个IP
  const resp = await api.post('/user/register', { phone: '13900020007', name: '隔离B' }, {
    headers: { 'X-Forwarded-For': '10.20.30.40' }
  });
  const pass = record('5. IP间隔离性', resp.data.code === 20000,
    `IP-B status=${resp.status} code=${resp.data.code} (期望 200/20000)`);
  console.log('  ⏳ 等待 60s 让 reg_ip 频控窗口过期...');
  await sleep(61000);
  console.log('  ✓ 继续');
  return { pass, detail: `X-Forwarded-For: 10.20.30.40 → code=${resp.data.code}` };
}

// 用例6：IP临时封禁触发 (3次错误验证码 → IP封禁24h)
async function case06_ipTempBlock() {
  await sleep(1000);
  // 3次错误验证码
  for (let i = 1; i <= 3; i++) {
    const c = await api.get('/captcha/generate');
    await sleep(300);
    await api.post('/captcha/verify', { captchaId: c.data.data.captchaId, sliderX: 999 });
    await sleep(300);
  }
  // 第4次请求 → IP封禁
  const resp = await api.post('/user/register', { phone: '13900060001', name: '封禁测试' });
  const pass = record('6. IP临时封禁触发', resp.status === 403 && resp.data.code === 40302,
    `status=${resp.status} code=${resp.data.code} (期望 403/40302)`);
  // 清理：通过管理API解除封禁
  const loginRes = await api.post('/admin/login', { username: 'admin', password: ADMIN_PASSWORD });
  const cookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  await api.post('/admin/risk/clear-ip-bl', { ip: '127.0.0.1' }, { headers: { Cookie: cookies } });
  return { pass, detail: `status=${resp.status} code=${resp.data.code}` };
}

// 用例7：封禁自动过期 (设TTL=3秒)
async function case07_blockAutoExpire() {
  const loginRes = await api.post('/admin/login', { username: 'admin', password: ADMIN_PASSWORD });
  const cookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  // 先触发封禁
  for (let i = 1; i <= 3; i++) {
    const c = await api.get('/captcha/generate');
    await sleep(300);
    await api.post('/captcha/verify', { captchaId: c.data.data.captchaId, sliderX: 999 });
    await sleep(300);
  }

  // 手动将封禁TTL改为3秒
  await setRedisTtl('risk:ip_bl:127.0.0.1', 3);

  // 确认正在封禁
  const blocked = await api.post('/user/register', { phone: '13900070001', name: '封禁确认' });
  const initiallyBlocked = blocked.data.code === 40302;

  // 等待3秒自动过期
  console.log('  ⏳ 等待 4s 让封禁自动过期...');
  await sleep(4000);
  console.log('  ✓ 继续');

  // 过期后注册应恢复
  const resp = await api.post('/user/register', { phone: '13900070002', name: '封禁过期测试' });
  const pass = record('7. 封禁自动过期', initiallyBlocked && resp.data.code === 20000,
    `初始封禁=${initiallyBlocked}, 过期后 code=${resp.data.code}`);
  return { pass, detail: `初始code=${blocked.data.code}, TTL=3s后code=${resp.data.code}` };
}

// ────────── 2.3 滑动验证码攻防测试 ──────────

// 用例8：验证码正常生成
async function case08_captchaGenerate() {
  const resp = await api.get('/captcha/generate');
  const d = resp.data.data || {};
  const hasCaptchaId = typeof d.captchaId === 'string' && d.captchaId.length > 20;
  const hasPuzzle = d.puzzle && d.puzzle.x !== undefined;
  const redisHasAnswer = hasCaptchaId && (await getRedisKey(`captcha:answer:${d.captchaId}`)) !== null;
  const pass = record('8. 验证码正常生成',
    resp.status === 200 && hasCaptchaId && hasPuzzle && redisHasAnswer,
    `captchaId=${!!d.captchaId} puzzle=${!!d.puzzle} redisAnswer=${redisHasAnswer}`);
  return { pass, detail: `captchaId=${d.captchaId?.substring(0,8)}... redisAnswer=${redisHasAnswer}` };
}

// 用例9：正确位置验证通过
async function case09_captchaCorrectVerify() {
  const gen = await api.get('/captcha/generate');
  const captchaId = gen.data.data.captchaId;
  const answerX = gen.data.data.puzzle.x;
  const resp = await api.post('/captcha/verify', { captchaId, sliderX: answerX });
  const hasToken = resp.data.data?.token && resp.data.data.token.length > 20;
  const pass = record('9. 正确位置验证通过', resp.data.code === 20000 && hasToken,
    `code=${resp.data.code} hasToken=${hasToken}`);
  return { pass, detail: `code=${resp.data.code} token=${resp.data.data?.token?.substring(0,8)}...` };
}

// 用例10：错误位置验证失败 (±20px)
async function case10_captchaWrongPosition() {
  const gen = await api.get('/captcha/generate');
  const captchaId = gen.data.data.captchaId;
  const answerX = gen.data.data.puzzle.x;
  const resp = await api.post('/captcha/verify', { captchaId, sliderX: answerX + 20 });
  const pass = record('10. 错误位置验证失败', resp.status === 400 && resp.data.code === 40008,
    `status=${resp.status} code=${resp.data.code} deviation=${resp.data.data?.deviation}`);
  return { pass, detail: `sliderX=${answerX+20} → code=${resp.data.code}` };
}

// 用例11：token复用攻击
async function case11_tokenReuse() {
  // 获取有效token
  const gen = await api.get('/captcha/generate');
  await sleep(200);
  const ver = await api.post('/captcha/verify', { captchaId: gen.data.data.captchaId, sliderX: gen.data.data.puzzle.x });
  const token = ver.data.data.token;

  // 第1次使用 → 成功
  const r1 = await api.post('/user/verify-captcha', { phone: '13900110001', name: 'token1', captchaToken: token });
  const firstOk = r1.data.code === 20000;

  // 第2次使用同一token → 应拒绝
  const r2 = await api.post('/user/verify-captcha', { phone: '13900110002', name: 'token2', captchaToken: token });
  const secondRejected = r2.data.code === 40111;

  const pass = record('11. token复用攻击', firstOk && secondRejected,
    `第1次=${r1.data.code}, 第2次=${r2.data.code} (期望 20000→40111)`);
  return { pass, detail: `1st=${r1.data.code} 2nd=${r2.data.code}` };
}

// 用例12：验证码过期攻击
async function case12_captchaExpiry() {
  const gen = await api.get('/captcha/generate');
  const captchaId = gen.data.data.captchaId;
  const answerX = gen.data.data.puzzle.x;

  // 将答案TTL设为2秒
  await setRedisTtl(`captcha:answer:${captchaId}`, 2);

  // 等待过期
  await sleep(3000);

  const resp = await api.post('/captcha/verify', { captchaId, sliderX: answerX });
  const pass = record('12. 验证码过期攻击', resp.data.code === 40007,
    `code=${resp.data.code} (期望 40007)`);
  return { pass, detail: `TTL=2s, wait=3s → code=${resp.data.code}` };
}

// 用例13：无token绕过中风险
async function case13_noTokenBypass() {
  const resp = await api.post('/user/verify-captcha', { phone: '13900130001', name: '无token绕过' });
  const pass = record('13. 无token绕过中风险', resp.data.code === 40110,
    `code=${resp.data.code} (期望 40110)`);
  return { pass, detail: `no captchaToken → code=${resp.data.code}` };
}

// ────────── 2.4 拦截日志完整性测试 ──────────

// 用例14：拦截自动记录
async function case14_interceptLogIntegrity() {
  const loginRes = await api.post('/admin/login', { username: 'admin', password: ADMIN_PASSWORD });
  const cookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  // 强制刷盘 + 等待落库
  await api.post('/admin/intercept-logs/flush', {}, { headers: { Cookie: cookies } });
  await sleep(1500);

  // 查询拦截日志
  const resp = await api.get('/admin/intercept-logs?page=1&pageSize=50', {
    headers: { Cookie: cookies }
  });

  const list = resp.data.data?.list || [];
  const total = resp.data.data?.total || 0;
  const hasRecords = total > 0 && Array.isArray(list);
  // 验证字段完整性
  const fieldsOk = list.length > 0 ? list.every(item =>
    item.ip_address !== undefined &&
    item.intercept_reason !== undefined &&
    item.risk_level !== undefined &&
    item.created_at !== undefined
  ) : hasRecords;

  const pass = record('14. 拦截自动记录', hasRecords && fieldsOk,
    `total=${total}, listLen=${list.length}, fieldsOk=${fieldsOk}`);
  return { pass, detail: `total=${total}, records found=${list.length}` };
}

// ────────── 2.5 白名单机制测试 ──────────

// 用例15：白名单豁免所有风控
async function case15_whitelistBypass() {
  const loginRes = await api.post('/admin/login', { username: 'admin', password: ADMIN_PASSWORD });
  const cookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  // 将127.0.0.1加入白名单
  await api.post('/admin/whitelist/add', { type: 'ip', value: '127.0.0.1', remark: '红队测试' }, { headers: { Cookie: cookies } });

  await sleep(500);

  // 1分钟内发10次注册
  const results = [];
  for (let i = 1; i <= 10; i++) {
    const resp = await api.post('/user/register', { phone: `139001500${String(i).padStart(2,'0')}`, name: `白名单${i}` });
    results.push(resp.data.code);
    await sleep(50);
  }

  const allPassed = results.every(c => c === 20000);
  const pass = record('15. 白名单豁免所有风控', allPassed,
    `10次注册 codes: ${results.join(',')}`);

  // 清理白名单
  await api.post('/admin/whitelist/remove', { type: 'ip', value: '127.0.0.1' }, { headers: { Cookie: cookies } });

  console.log('  ⏳ 等待 60s 让 reg_ip 频控窗口过期...');
  await sleep(61000);
  console.log('  ✓ 继续');
  return { pass, detail: `10 requests → ${allPassed ? 'ALL 20000' : 'SOME BLOCKED'}` };
}

// 用例16：删除白名单后风控恢复
async function case16_whitelistRemoveRestore() {
  const loginRes = await api.post('/admin/login', { username: 'admin', password: ADMIN_PASSWORD });
  const cookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  console.log('  ⏳ 等待 60s 让 reg_ip 频控窗口过期...');
  await sleep(61000); // 确保reg_ip窗口过期
  console.log('  ✓ 继续');

  // 先确认没在白名单
  await api.post('/admin/whitelist/remove', { type: 'ip', value: '127.0.0.1' }, { headers: { Cookie: cookies } }).catch(() => {});

  // 发6次注册，第6次应被限流
  const results = [];
  for (let i = 1; i <= 7; i++) {
    const resp = await api.post('/user/register', { phone: `139001600${String(i).padStart(2,'0')}`, name: `恢复测试${i}` });
    results.push({ i, code: resp.data.code });
    await sleep(50);
  }

  const laterBlocked = results.slice(5).some(r => r.code === 40101 || r.code === 40029);
  const pass = record('16. 删除白名单后风控恢复', laterBlocked,
    `codes: ${results.map(r => r.code).join(',')} (期望后面含 40101/40029)`);
  console.log('  ⏳ 等待 60s 清理 reg_ip 窗口...');
  await sleep(61000);
  console.log('  ✓ 清理完成');
  return { pass, detail: `results: ${JSON.stringify(results)}` };
}

// ═════════════════════════════════════════════════════════════════
//  报告生成
// ═════════════════════════════════════════════════════════════════

function generateReport(startTime) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const total = passCount + failCount;
  const passRate = total > 0 ? ((passCount / total) * 100).toFixed(1) : '0.0';

  const lines = [];
  lines.push(`\n╔══════════════════════════════════════════════════════╗`);
  lines.push(`║     模块一：风控核心升级 — 红队攻击测试报告          ║`);
  lines.push(`╚══════════════════════════════════════════════════════╝`);
  lines.push(`  执行时间: ${new Date().toISOString()}`);
  lines.push(`  耗时:     ${elapsed}s`);
  lines.push(`  总用例数: ${total}`);
  lines.push(`  防线守住: ${passCount}  ✅`);
  lines.push(`  防线突破: ${failCount}  ❌`);
  lines.push(`  通过率:   ${passRate}%`);
  lines.push(``);

  if (failCount > 0) {
    lines.push(`  ─── 被突破详情 ───`);
    failedCases.forEach((f, i) => {
      lines.push(`  ${i + 1}. ${f.name}`);
      lines.push(`     详情: ${f.detail}`);
    });
    lines.push(``);
  }

  // 安全评级
  let grade, gradeColor;
  const rate = parseFloat(passRate);
  if (rate >= 95)      { grade = 'A+ (卓越)'; gradeColor = '🟢'; }
  else if (rate >= 85) { grade = 'A (优秀)';  gradeColor = '🟢'; }
  else if (rate >= 70) { grade = 'B (良好)';  gradeColor = '🟡'; }
  else if (rate >= 50) { grade = 'C (需改进)'; gradeColor = '🟠'; }
  else                 { grade = 'D (严重漏洞)'; gradeColor = '🔴'; }

  lines.push(`  ─── 安全评级 ───`);
  lines.push(`  模块一整体评级: ${gradeColor} ${grade}`);
  if (failCount > 0) {
    lines.push(`  建议: 存在 ${failCount} 项被攻破的防线，请检查相关风控机制`);
  } else {
    lines.push(`  结论: 模块一所有防护机制运作正常，红队未能突破`);
  }
  lines.push(``);

  const text = lines.join('\n');
  console.log(text);
  return {
    text,
    stats: { total, passed: passCount, failed: failCount, passRate, elapsed, grade, failures: failedCases }
  };
}

// ═════════════════════════════════════════════════════════════════
//  主入口
// ═════════════════════════════════════════════════════════════════

async function runModule1() {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🔴 模块一：风控核心升级 — 红队渗透测试`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const startTime = Date.now();

  // 连接Redis
  try {
    await connectRedis();
    console.log('✅ Redis 已连接 (用于TTL操作)');
  } catch (e) {
    console.log('⚠️  Redis 连接失败，部分用例(TTL操作)可能受影响');
  }

  // ── 前置清理：清除残留 IP 黑名单 + 频控计数器 ──
  console.log('\n📋 前置清理：清除残留 IP 黑名单 & 频控计数器...');
  try {
    const loginRes = await api.post('/admin/login', { username: 'admin', password: ADMIN_PASSWORD });
    const cookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    if (cookies) {
      await api.post('/admin/risk/clear-ip-bl', { ip: '127.0.0.1' }, { headers: { Cookie: cookies } });
    }
    // 同时清除 Redis 中残留的 reg_ip 频控计数器 + 注销频控（前序模块可能已消耗配额）
    if (redisClient && redisClient.isOpen) {
      await redisClient.del(`${REDIS_PREFIX}limit:reg_ip:127.0.0.1`).catch(() => {});
      await redisClient.del(`${REDIS_PREFIX}risk:ratelimit:cancel:127.0.0.1`).catch(() => {});
      await redisClient.del(`${REDIS_PREFIX}risk:device_bl:device-blacklisted-forever`).catch(() => {});
    }
    console.log('✅ IP 黑名单 & 频控计数器已清除');
  } catch (e) {
    console.log('⚠️  前置清理异常:', e.message);
  }

  // ── 2.1 三级风险分级 ──
  console.log('\n📋 2.1 三级风险分级机制测试');
  const caseResults = [];

  caseResults.push(await case01_lowRiskPass());
  await sleep(500);
  caseResults.push(await case02_mediumRiskCaptcha());

  // case2 已消耗 reg_ip 配额，wait 60s 让窗口过期再测 case3
  console.log('  ⏳ 等待 60s 让 reg_ip 频控窗口过期后继续...');
  await sleep(61000);
  console.log('  ✓ 继续');

  caseResults.push(await case03_highRiskBlock());

  // ── 2.2 IP限流 + 临时黑名单 ──
  console.log('\n📋 2.2 IP维度限流 + 临时黑名单测试');
  caseResults.push(await case04_ipRateLimitThreshold());
  caseResults.push(await case05_ipIsolation());
  caseResults.push(await case06_ipTempBlock());
  await sleep(500);
  caseResults.push(await case07_blockAutoExpire());

  // ── 2.3 滑动验证码攻防 ──
  console.log('\n📋 2.3 滑动验证码攻防测试');
  await sleep(500);
  caseResults.push(await case08_captchaGenerate());
  caseResults.push(await case09_captchaCorrectVerify());
  caseResults.push(await case10_captchaWrongPosition());
  caseResults.push(await case11_tokenReuse());
  caseResults.push(await case12_captchaExpiry());
  caseResults.push(await case13_noTokenBypass());

  // ── 2.4 拦截日志 ──
  console.log('\n📋 2.4 拦截日志完整性测试');
  caseResults.push(await case14_interceptLogIntegrity());

  // ── 2.5 白名单 ──
  console.log('\n📋 2.5 白名单机制测试');
  caseResults.push(await case15_whitelistBypass());
  caseResults.push(await case16_whitelistRemoveRestore());

  // 断开Redis
  await disconnectRedis();

  // 生成报告
  const report = generateReport(startTime);

  return {
    ...report.stats,
    caseResults,
    reportText: report.text
  };
}

// 支持直接运行
if (require.main === module) {
  runModule1().then(result => {
    if (result.failed > 0) process.exit(1);
  }).catch(e => {
    console.error('测试异常:', e.message);
    process.exit(2);
  });
}

module.exports = runModule1;
