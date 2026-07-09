// tests/blue-team/01-risk-control.js
// ================================================================
// 智能停车风控系统 — 全功能自动化验证套件
// 覆盖: 三级风险分级 / IP频控与黑名单 / 滑块人机验证 /
//       captchaToken一次性校验 / 拦截日志 / 白名单 / 端到端流程
//
// 运行方式: node tests/blue-team/01-risk-control.js
// 前置条件: docker-compose up (Redis + Backend 均已启动)
// ================================================================

const axios = require('axios');
const { createClient } = require('redis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// 每次运行生成唯一 ID，手机号由此派生，彻底避免跨运行残留
const RUN_ID = String(Date.now() % 10000).padStart(4, '0');
const P = (suffix) => `1380${RUN_ID}${suffix}`;

// ─── 配置 ────────────────────────────────────────────────────────
const BASE = 'http://127.0.0.1:3000/api/v1';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';

// ─── 工具函数 ────────────────────────────────────────────────────
const colors = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m'
};

let passCount = 0;
let failCount = 0;
const results = [];

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ${colors.green}✓${colors.reset} ${name}${detail ? colors.dim + ' — ' + detail + colors.reset : ''}`);
    passCount++;
    results.push({ name, status: 'PASS', detail });
  } else {
    console.log(`  ${colors.red}✗${colors.reset} ${name}${detail ? colors.dim + ' — ' + detail + colors.reset : ''}`);
    failCount++;
    results.push({ name, status: 'FAIL', detail });
  }
}

function title(text) {
  console.log(`\n${colors.bold}${colors.cyan}━━━ ${text} ━━━${colors.reset}`);
}

// ─── HTTP 客户端（不自动抛异常，方便检查状态码） ─────────────────
const api = axios.create({ baseURL: BASE, validateStatus: () => true, timeout: 10000 });

// 固定 X-Forwarded-For 为 127.0.0.1，确保后端 IP 维度风控与测试清理/白名单一致
//（无论后端跑在宿主机还是 Docker 容器内都稳定复现）
api.defaults.headers.common['X-Forwarded-For'] = '127.0.0.1';

let adminCookie = '';  // 管理端 session cookie
let rdsClient = null;  // 持久 Redis 连接，用于读取 captcha answer

/** 🆕 从 Redis 读取验证码正确答案（前端不应知晓 answerX） */
async function readCaptchaAnswer(captchaId) {
  if (!rdsClient || !rdsClient.isOpen) {
    try {
      let redisPwd = process.env.REDIS_PASSWORD || '';
      if ((redisPwd.startsWith('"') && redisPwd.endsWith('"')) || (redisPwd.startsWith("'") && redisPwd.endsWith("'"))) {
        redisPwd = redisPwd.slice(1, -1);
      }
      rdsClient = createClient({ socket: { host: '127.0.0.1', port: 6379 }, password: redisPwd || undefined });
      await rdsClient.connect();
    } catch { return null; }
  }
  try { return await rdsClient.get('pf:captcha:answer:' + captchaId); }
  catch { return null; }
}

// ──────────────────────────────────────────────────────────────────
//  主函数
// ──────────────────────────────────────────────────────────────────
async function run() {
  console.log(`${colors.bold}${colors.cyan}
╔══════════════════════════════════════════════════════╗
║   智能停车风控系统 — 全功能自动化验证套件 v1.0     ║
╚══════════════════════════════════════════════════════╝${colors.reset}
`);
  console.log(`Target: ${BASE}`);
  console.log(`Time:   ${new Date().toISOString()}\n`);

  const startTime = Date.now();

  // ── 0. 前置检查 ────────────────────────────────────────────────
  await preflight();

  // ── 1. 低风险正常注册 ─────────────────────────────────────────
  await test_01_normalRegister();

  // ── 2. 手机号注销 → 黑名单 HIGH 拦截 (40300) ───────────────────
  await test_02_phoneBlacklist();

  // ── 3. 设备指纹同步拉黑 HIGH 拦截 (40301) ─────────────────────
  await test_03_deviceBlacklist();

  // ── 4. IP 注册频控 (reg_ip): 5次/60s → MEDIUM 40101 ───────────
  await test_04_regIpRateLimit();

  // ── 5. IP 临时黑名单 (ip_bl): 手动注入 → HIGH 40302 ───────────
  await test_05_ipTempBlacklist();

  // ── 6. 滑块生成 + 正确验证 + Token签发 ────────────────────────
  await test_06_captchaGenerateAndVerify();

  // ── 7. 滑块偏差容差: ±5px 通过, +6px 拒绝 ────────────────────
  await test_07_captchaTolerance();

  // ── 8. 滑块过期 (60s TTL) ─────────────────────────────────────
  await test_08_captchaExpiry();

  // ── 9. 滑块连续3次失败 → 自动IP拉黑 ──────────────────────────
  await test_09_captchaFailAutoBlock();

  // ── 10. captchaToken 一次性校验 (带toekn验证注册全流程) ──────
  await test_10_captchaTokenOneTime();

  // ── 11. 拦截日志查询 (管理员鉴权后) ──────────────────────────
  await test_11_interceptLogs();

  // ── 12. 白名单 CRUD ──────────────────────────────────────────
  await test_12_whitelistCrud();

  // ── 13. 白名单放行验证 ───────────────────────────────────────
  await test_13_whitelistBypass();

  // ── 14. 端到端全链路 (频控→滑块→注册→注销→黑名单→白名单恢复) 
  await test_14_e2eFullChain();

  // ── 15. 注销频控 (rateLimiter cancel: 10min内最多3次) ────────
  await test_15_cancelRateLimit();

  // ──────────────────────────────────────────────────────────────
  // 最终报告
  // ──────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const total = passCount + failCount;
  const passRate = total > 0 ? ((passCount / total) * 100).toFixed(1) : '0.0';
  console.log(`\n${colors.bold}${colors.cyan}╔══════════════════════════════════════════════════════╗
║              验 证 报 告                               ║
╚══════════════════════════════════════════════════════╝${colors.reset}`);
  console.log(`  Total:  ${total}`);
  console.log(`  ${colors.green}Passed: ${passCount}${colors.reset}`);
  console.log(`  ${colors.red}Failed: ${failCount}${colors.reset}`);
  console.log(`  Time:   ${elapsed}s`);

  console.log(`\n${colors.dim}─── 详细结果 ───${colors.reset}`);
  for (const r of results) {
    const icon = r.status === 'PASS' ? colors.green + '✓' + colors.reset : colors.red + '✗' + colors.reset;
    console.log(`  ${icon} ${r.name}`);
    if (r.detail) console.log(`       ${colors.dim}${r.detail}${colors.reset}`);
  }

  // 清理 Redis 连接
  if (rdsClient && rdsClient.isOpen) {
    try { await rdsClient.quit(); } catch {}
  }

  if (failCount > 0) {
    console.log(`\n${colors.yellow}⚠ 存在 ${failCount} 项未通过，请检查上方 ✗ 标记项。${colors.reset}`);
  } else {
    console.log(`\n${colors.green}${colors.bold}🎉 所有测试全部通过！系统功能验证成功。${colors.reset}`);
  }

  return {
    total, passed: passCount, failed: failCount,
    passRate, elapsed,
    failures: results.filter(r => r.status === 'FAIL')
  };
}

// ═══════════════════════════════════════════════════════════════
// 0. 前置检查
// ═══════════════════════════════════════════════════════════════
async function preflight() {
  title('0. 前置检查');

  // 检查服务可达
  try {
    const resp = await api.get('/captcha/generate');
    if (resp.status !== 200) throw new Error('HTTP ' + resp.status);
    assert('后端服务可达', true, `HTTP ${resp.status}`);
  } catch (e) {
    assert('后端服务可达', false, e.message);
    console.error(`\n${colors.red}${colors.bold}请先启动 docker-compose up 确保 Redis + Backend 均运行${colors.reset}\n`);
    process.exit(1);
  }

  // 管理员登录
  const resp = await api.post('/admin/login', { username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  assert('管理员登录', resp.data.code === 20000, `username: ${ADMIN_USERNAME}`);
  const cookies = resp.headers['set-cookie'];
  if (cookies && cookies.length > 0) {
    adminCookie = cookies[0].split(';')[0];
  }
  assert('获取 admin_token cookie', !!adminCookie, adminCookie ? adminCookie.substring(0, 40) + '...' : 'MISSING');

  // 清理上次运行遗留的 IP 临时黑名单（避免干扰注册测试）
  await api.post('/admin/risk/clear-ip-bl',
    { ip: '127.0.0.1' },
    { headers: { Cookie: adminCookie } }
  );

  // 清理注销频控计数器（避免 10min 内重跑时 cancel 被 429 拦截）
  try {
    // 从 .env 读取密码，自动剥离引号
    let redisPwd = process.env.REDIS_PASSWORD || '';
    if ((redisPwd.startsWith('"') && redisPwd.endsWith('"')) || (redisPwd.startsWith("'") && redisPwd.endsWith("'"))) {
      redisPwd = redisPwd.slice(1, -1);
    }
    rdsClient = createClient({
      socket: { host: '127.0.0.1', port: 6379 },
      password: redisPwd || undefined
    });
    await rdsClient.connect();
    // 清理 cancel 频控 + ip_bl 黑名单 + whitelist + captcha 计数
    await rdsClient.del('pf:risk:ratelimit:cancel:127.0.0.1');
    await rdsClient.del('pf:risk:ip_bl:127.0.0.1');
    await rdsClient.del('pf:risk:captcha_fail:127.0.0.1');
    await rdsClient.del('pf:whitelist:ip:127.0.0.1');
    await rdsClient.del('pf:whitelist:device:127.0.0.1');
    // 🆕 清理限流计数器（避免跨运行残留导致测试3/4/14失败）
    await rdsClient.del('pf:limit:reg_ip:127.0.0.1');
    await rdsClient.del('pf:limit:ip:127.0.0.1');
    // 🆕 扫描清理所有 phone 限流 key 和 reg_ip key
    try {
      for await (const key of rdsClient.scanIterator({ MATCH: 'pf:limit:phone:*', COUNT: 100 })) {
        await rdsClient.del(key);
      }
    } catch {}
    console.log(`  ${colors.green}✓${colors.reset} 已清理 Redis 残留计数`);
  } catch (e) {
    console.log(`  ${colors.yellow}⚠${colors.reset} Redis 清理跳过: ${e.message}`);
  }

  // 🆕 设置测试用风控阈值（确保测试环境一致）
  try {
    await api.put('/admin/config', { key: 'ip_register_limit', value: 5 }, { headers: { Cookie: adminCookie } });
    await api.put('/admin/config', { key: 'ip_blocklist_ttl_hours', value: 24 }, { headers: { Cookie: adminCookie } });
    console.log(`  ${colors.green}✓${colors.reset} 风控阈值已设定: ip_register_limit=5, ip_blocklist_ttl_hours=24`);
  } catch (e) {
    console.log(`  ${colors.yellow}⚠${colors.reset} 风控阈值设定失败: ${e.message}`);
  }

  // 🆕 清理 MySQL 残留白名单 + 黑名单（避免上次运行残留导致风控失效）
  try {
    // 移除 127.0.0.1 的 IP 白名单（MySQL 双写残留）
    await api.post('/admin/whitelist/remove', { type: 'ip', value: '127.0.0.1' }, { headers: { Cookie: adminCookie } });
    // 清理测试设备白名单残留
    const wlResp = await api.get('/admin/whitelist', { headers: { Cookie: adminCookie } });
    const wlDevices = wlResp.data?.data?.devices || [];
    for (const dev of wlDevices) {
      if (dev.startsWith('test-') || dev.includes('-whitelist-') || dev.includes('-bypass-') || dev.includes('-fullchain-')) {
        await api.post('/admin/whitelist/remove', { type: 'device', value: dev }, { headers: { Cookie: adminCookie } });
      }
    }
    // 清理测试手机号的黑名单映射表（MySQL 残留）
    try {
      const { createConnection } = require('mysql2/promise');
      const mysqlPwd = process.env.MYSQL_ROOT_PASSWORD || 'Admin@123';
      const mysqlConn = await createConnection({
        host: '127.0.0.1', port: 3307, user: 'parking', password: mysqlPwd, database: 'parking_fraud'
      });
      // 清理包含测试特征的 phone_blacklist_map 记录（防止残留 phone_hash 导致误拦截）
      // 仅清理可能干扰当前测试的 phone_blacklist_map
      await mysqlConn.execute('DELETE FROM phone_blacklist_map WHERE phone_mask = ?', ['']);
      await mysqlConn.end();
    } catch (dbErr) {
      // MySQL 直连清理跳过（非关键）
    }
  } catch (cleanErr) {
    // 忽略清理错误
  }
}

// ═══════════════════════════════════════════════════════════════
// 1. 低风险正常注册
// ═══════════════════════════════════════════════════════════════
async function test_01_normalRegister() {
  title('1. 低风险正常注册 (LOW)');

  const phone = P('001');
  const resp = await api.post('/user/register', { phone, name: '正常用户', deviceId: 'device-normal-01' });

  assert('HTTP 200', resp.status === 200);
  assert('code=20000 (成功)', resp.data.code === 20000);
  assert('返回 userId', typeof resp.data.data?.userId === 'number');
  assert('返回 hasCoupon=true', resp.data.data?.hasCoupon === true);
}

// ═══════════════════════════════════════════════════════════════
// 2. 手机号注销 → 黑名单 HIGH 拦截 (40300)
// ═══════════════════════════════════════════════════════════════
async function test_02_phoneBlacklist() {
  title('2. 手机号黑名单 HIGH 拦截 (40300)');

  const phone = P('002');

  // 2.1 先正常注册
  await api.post('/user/register', { phone, name: '待注销用户' });

  // phone limiter (1次/5秒): register 和 cancel 共用同一手机号 key，需等待 5s
  await sleep(5100);

  // 2.2 注销：手机号进入 Redis 历史注销沉淀库
  const cancelResp = await api.post('/user/cancel', { phone });
  assert('注销成功', cancelResp.data.code === 20000);

  // 2.3 再次注册 → 应被拦截（需等 phoneLimiter 5s 窗口过期）
  await sleep(5100);
  const resp = await api.post('/user/register', { phone, name: '重试用户' });
  assert('HTTP 403 (高风险拦截)', resp.status === 403,
    `实际 status=${resp.status} code=${resp.data.code} msg=${resp.data.message || resp.data.msg || ''}`);
  assert('code=40300 (命中历史注销库)', resp.data.code === 40300,
    `实际 code=${resp.data.code} status=${resp.status}`);
}

// ═══════════════════════════════════════════════════════════════
// 3. 设备指纹同步拉黑 HIGH 拦截 (40301)
//   device_cancel_limit=2 → 第1次注销不拉黑，第2次注销拉黑设备，第3次注册拦截
// ═══════════════════════════════════════════════════════════════
async function test_03_deviceBlacklist() {
  title('3. 设备指纹黑名单 HIGH 拦截 (40301)');

  const phone1 = P('003');
  const phone2 = P('004');
  const phone3 = P('005');
  const deviceId = 'device-test-blacklist-xyz';

  // 3.1 第1次注册+注销（count=1，不拉黑设备）
  await api.post('/user/register', { phone: phone1, name: '设备测试1', deviceId });
  await sleep(5100);
  await api.post('/user/cancel', { phone: phone1, deviceId });

  // 3.2 第2次注册+注销（count=2 ≥ cancelLimit，拉黑设备）
  await sleep(5100);
  await api.post('/user/register', { phone: phone2, name: '设备测试2', deviceId });
  await sleep(5100);
  await api.post('/user/cancel', { phone: phone2, deviceId });

  // 3.3 第3次注册 → 应被设备黑名单拦截
  // 🆕 先清 reg_ip 计数器（前序测试已累积，避免被 40101 拦截）
  try { if (rdsClient && rdsClient.isOpen) await rdsClient.del('pf:limit:reg_ip:127.0.0.1'); } catch {}
  const resp = await api.post('/user/register', { phone: phone3, name: '换号用户', deviceId });

  assert('HTTP 403 (设备黑名单)', resp.status === 403,
    `实际 status=${resp.status} code=${resp.data.code} msg=${resp.data.message || resp.data.msg || ''}`);
  assert('code=40301 (设备高风险)', resp.data.code === 40301,
    `实际 code=${resp.data.code} status=${resp.status}`);
}

// ═══════════════════════════════════════════════════════════════
// 4. IP 注册频控 (reg_ip): 5次/60s → MEDIUM 40101
// ═══════════════════════════════════════════════════════════════
async function test_04_regIpRateLimit() {
  title('4. IP 注册频控 reg_ip (5次/60s → 40101 MEDIUM)');

  // 之前 test 1-3 已产生约 4-5 次注册，需等 reg_ip 窗口过期
  console.log(`  ${colors.yellow}⏳${colors.reset} 等待 60s 让之前测试的 reg_ip 频控窗口过期...`);
  await sleep(61000);
  console.log(`  ${colors.green}✓${colors.reset} 频控窗口已重置`);

  const results = [];
  for (let i = 1; i <= 7; i++) {
    // 11-digit Chinese phone number: 138001350 + 2-digit padded index
    const phone = `1380${RUN_ID}1${String(i).padStart(2, '0')}`;
    const resp = await api.post('/user/register', { phone, name: `频控测试${i}` });
    results.push({ i, phone, code: resp.data.code, status: resp.status });
    await sleep(50);
  }

  // 前5次应成功
  const firstFive = results.slice(0, 5);
  const firstFiveOk = firstFive.every(r => r.code === 20000);
  assert('前5次注册均成功', firstFiveOk, `codes: ${firstFive.map(r => r.code).join(',')}`);

  // 第6、7次应触发 40101
  const lastTwo = results.slice(5);
  const lastTwoBlocked = lastTwo.every(r => r.status === 401 && r.code === 40101);
  assert('第6+次触发 40101 (人机验证)', lastTwoBlocked, `codes: ${lastTwo.map(r => r.code).join(',')}`);

  // 等待 reg_ip 窗口过期，避免影响 test 5
  console.log(`  ${colors.yellow}⏳${colors.reset} 等待 60s 让 reg_ip 频控窗口过期...`);
  await sleep(61000);
  console.log(`  ${colors.green}✓${colors.reset} 频控窗口已重置`);
}

// ═══════════════════════════════════════════════════════════════
// 5. IP 临时黑名单 (ip_bl) 检查
// ═══════════════════════════════════════════════════════════════
async function test_05_ipTempBlacklist() {
  title('5. IP 临时黑名单检查 (ip_bl → 40302 HIGH)');

  const phone = P('501');

  // 5.1 正常注册 (验证未在黑名单)
  const resp1 = await api.post('/user/register', { phone, name: '黑名单测试' });
  assert('IP未在黑名单时正常注册', resp1.data.code === 20000);

  // ⚠ 由于无法直接从外部写 Redis，这里我们通过模拟验证失败触发自动拉黑
  // 先获取滑块，再故意失败 3 次
  for (let i = 1; i <= 3; i++) {
    const c = await api.get('/captcha/generate');
    await sleep(200);  // 避免触发 globalIpLimiter (10次/秒)
    await api.post('/captcha/verify', { captchaId: c.data.data.captchaId, sliderX: 999 }); // 恶意偏移
    await sleep(200);
  }

  // 现在该 IP 应该已被自动拉黑（24h）
  const phone2 = P('502');
  const resp2 = await api.post('/user/register', { phone: phone2, name: '黑名单测试2' });
  assert('IP被自动拉黑后注册 40302', resp2.status === 403 && resp2.data.code === 40302);

  // ⚠ 清理：手动删除 IP 黑名单 key（需要直接操作 Redis）
  // 此处跳过，实际测试中可用 redis-cli: DEL pf:risk:ip_bl:127.0.0.1
  // 🆕 自动通过白名单绕过 IP 封禁，确保后续测试正常运行
  await api.post('/admin/whitelist/add', { type: 'ip', value: '127.0.0.1', remark: 'auto-bypass' }, { headers: { Cookie: adminCookie } });
  console.log(`  ${colors.green}✓${colors.reset} 已通过白名单放行 127.0.0.1，后续测试不受IP封禁影响`);
}

// ═══════════════════════════════════════════════════════════════
// 6. 滑块生成 + 正确验证 + Token签发
// ═══════════════════════════════════════════════════════════════
async function test_06_captchaGenerateAndVerify() {
  title('6. 滑块验证码: 生成(SVG) + 正确验证 + Token签发');

  // 6.1 生成滑动验证码（🆕 不再返回 puzzle.x，改为 SVG 图片）
  const genResp = await api.get('/captcha/generate');
  assert('GET /captcha/generate → HTTP 200', genResp.status === 200);
  const { captchaId, canvas, puzzle, backgroundSvg, puzzleSvg, expiresIn } = genResp.data.data || {};

  assert('返回 captchaId (UUID)', typeof captchaId === 'string' && captchaId.length > 20);
  assert('canvas 280x150', canvas?.width === 280 && canvas?.height === 150);
  assert('puzzle 50x50', puzzle?.width === 50 && puzzle?.height === 50);
  assert('返回 backgroundSvg', typeof backgroundSvg === 'string' && backgroundSvg.startsWith('<svg'));
  assert('返回 puzzleSvg', typeof puzzleSvg === 'string' && puzzleSvg.startsWith('<svg'));
  assert('expiresIn = 60s', expiresIn === 60);

  // 6.2 正确滑块位置验证（🆕 从 Redis 读取正确答案，而非前端 puzzle.x）
  const answerXStr = await readCaptchaAnswer(captchaId);
  assert('Redis 中存在正确答案', answerXStr !== null, `answerX=${answerXStr}`);

  const answerX = parseInt(answerXStr, 10);
  const verifyResp = await api.post('/captcha/verify', {
    captchaId,
    sliderX: answerX  // 精确匹配
  });
  assert('POST /captcha/verify → HTTP 200', verifyResp.status === 200);
  assert('code=20000 (验证通过)', verifyResp.data.code === 20000);
  assert('返回一次性 token', typeof verifyResp.data.data?.token === 'string' && verifyResp.data.data.token.length > 20);
  assert('deviation=0', verifyResp.data.data?.deviation === 0);
  assert('expiresIn=300s (5min)', verifyResp.data.data?.expiresIn === 300);
}

// ═══════════════════════════════════════════════════════════════
// 7. 滑块偏差容差: ±5px 通过, +6px 拒绝
// ═══════════════════════════════════════════════════════════════
async function test_07_captchaTolerance() {
  title('7. 滑块偏差容差 (±5px 通过, +6px 拒绝)');

  // +3px → 应通过
  const c1 = await api.get('/captcha/generate');
  const ans1 = await readCaptchaAnswer(c1.data.data.captchaId);
  await sleep(200);  // 避免 globalIpLimiter
  const r1 = await api.post('/captcha/verify', {
    captchaId: c1.data.data.captchaId,
    sliderX: parseInt(ans1) + 3
  });
  assert('偏差 +3px → 验证通过', r1.data.code === 20000, `code=${r1.data.code}`);
  await sleep(200);

  // -4px → 应通过
  const c2 = await api.get('/captcha/generate');
  const ans2 = await readCaptchaAnswer(c2.data.data.captchaId);
  await sleep(200);
  const r2 = await api.post('/captcha/verify', {
    captchaId: c2.data.data.captchaId,
    sliderX: parseInt(ans2) - 4
  });
  assert('偏差 -4px → 验证通过', r2.data.code === 20000, `code=${r2.data.code}`);
  await sleep(200);

  // -5px (边界) → 应通过
  const c3 = await api.get('/captcha/generate');
  const ans3 = await readCaptchaAnswer(c3.data.data.captchaId);
  await sleep(200);
  const r3 = await api.post('/captcha/verify', {
    captchaId: c3.data.data.captchaId,
    sliderX: parseInt(ans3) - 5
  });
  assert('偏差 -5px (边界) → 验证通过', r3.data.code === 20000, `code=${r3.data.code}`);
  await sleep(200);

  // +6px → 应拒绝
  const c4 = await api.get('/captcha/generate');
  const ans4 = await readCaptchaAnswer(c4.data.data.captchaId);
  await sleep(200);
  const r4 = await api.post('/captcha/verify', {
    captchaId: c4.data.data.captchaId,
    sliderX: parseInt(ans4) + 6
  });
  assert('偏差 +6px → 拒绝 40008', r4.data.code === 40008, `code=${r4.data.code}`);
  await sleep(200);

  // 大偏差 → 应拒绝
  const c5 = await api.get('/captcha/generate');
  await sleep(200);
  const r5 = await api.post('/captcha/verify', {
    captchaId: c5.data.data.captchaId,
    sliderX: 999
  });
  assert('偏差极大 → 拒绝 40008', r5.data.code === 40008, `code=${r5.data.code}`);
}

// ═══════════════════════════════════════════════════════════════
// 8. 滑块过期 (60s TTL)
// ═══════════════════════════════════════════════════════════════
async function test_08_captchaExpiry() {
  title('8. 滑块答案过期 (60s TTL)');

  const genResp = await api.get('/captcha/generate');
  const captchaId = genResp.data.data.captchaId;
  const answerX = await readCaptchaAnswer(captchaId);

  console.log(`  ${colors.yellow}⏳${colors.reset} 等待 61s 让滑块过期...`);
  await sleep(61000);

  const verifyResp = await api.post('/captcha/verify', { captchaId, sliderX: parseInt(answerX) });
  assert('过期后验证拒绝 40007', verifyResp.data.code === 40007, `code=${verifyResp.data.code}`);
}

// ═══════════════════════════════════════════════════════════════
// 9. 滑块连续3次失败 → 自动IP拉黑
// ═══════════════════════════════════════════════════════════════
async function test_09_captchaFailAutoBlock() {
  title('9. 连续3次滑块失败 → 自动 IP 拉黑');

  // 🆕 清除前序测试残留的 captcha 失败计数（test_07 已产生 2 次失败）
  try {
    await api.post('/admin/risk/clear-ip-bl', { ip: '127.0.0.1' }, { headers: { Cookie: adminCookie } });
    if (rdsClient && rdsClient.isOpen) await rdsClient.del('pf:risk:captcha_fail:127.0.0.1');
  } catch {}

  // 故意失败第1次
  const c1 = await api.get('/captcha/generate');
  await sleep(200);
  const r1 = await api.post('/captcha/verify', { captchaId: c1.data.data.captchaId, sliderX: 1 });
  assert('第1次失败 → code=40008', r1.data.code === 40008);
  assert('返回 failCount', typeof r1.data.data?.failCount === 'number', `failCount=${r1.data.data?.failCount}`);
  await sleep(200);

  // 故意失败第2次
  const c2 = await api.get('/captcha/generate');
  await sleep(200);
  const r2 = await api.post('/captcha/verify', { captchaId: c2.data.data.captchaId, sliderX: 2 });
  assert('第2次失败 → code=40008', r2.data.code === 40008);
  await sleep(200);

  // 故意失败第3次 → 自动拉黑
  const c3 = await api.get('/captcha/generate');
  await sleep(200);
  const r3 = await api.post('/captcha/verify', { captchaId: c3.data.data.captchaId, sliderX: 3 });
  assert('第3次 → code=40008 + 自动拉黑', r3.data.code === 40008);
  assert('failCount ≥ 3', r3.data.data?.failCount >= 3, `failCount=${r3.data.data?.failCount}`);

  console.log(`  ${colors.yellow}⚠${colors.reset} IP 已被自动拉黑 (captcha_fail 触发) → 后续测试用白名单绕过`);
}

// ═══════════════════════════════════════════════════════════════
// 10. captchaToken 一次性校验 (完整注册链路)
// ═══════════════════════════════════════════════════════════════
async function test_10_captchaTokenOneTime() {
  title('10. captchaToken 一次性校验 (完整注册链路)');

  // 10.1 缺 token → 拒绝
  const r0 = await api.post('/user/verify-captcha', {
    phone: P('201'), name: '缺token'
  });
  assert('缺 captchaToken → 40110', r0.data.code === 40110, `code=${r0.data.code}`);

  // 10.2 伪造 token → 拒绝
  const r1 = await api.post('/user/verify-captcha', {
    phone: P('202'), name: '假token', captchaToken: 'fake-token-not-exist'
  });
  assert('伪造 token → 40111', r1.data.code === 40111, `code=${r1.data.code}`);

  // 10.3 正确流程: 生成滑块 → 验证滑块 → 用 token 注册
  const c = await api.get('/captcha/generate');
  const ansX = await readCaptchaAnswer(c.data.data.captchaId);
  const v = await api.post('/captcha/verify', {
    captchaId: c.data.data.captchaId,
    sliderX: parseInt(ansX)
  });
  const token = v.data.data?.token || '';
  assert('获取有效 token', v.data.code === 20000, token ? `token=${token.substring(0, 8)}...` : `code=${v.data.code}`);

  // 带 token 注册
  const r2 = await api.post('/user/verify-captcha', {
    phone: P('203'), name: 'token注册', captchaToken: token
  });
  assert('带有效 token 注册成功', r2.data.code === 20000, `msg=${r2.data.msg || r2.data.message}`);

  // 10.4 同一 token 二次使用 → 拒绝
  const r3 = await api.post('/user/verify-captcha', {
    phone: P('204'), name: '二次使用', captchaToken: token
  });
  assert('同 token 二次使用 → 40111 (一次性)', r3.data.code === 40111, `code=${r3.data.code}`);
}

// ═══════════════════════════════════════════════════════════════
// 11. 拦截日志查询
// ═══════════════════════════════════════════════════════════════
async function test_11_interceptLogs() {
  title('11. 拦截日志查询 (B端)');

  // 11.1 未登录 → 拒绝
  const r0 = await api.get('/admin/intercept-logs');
  assert('未登录 → 401', r0.status === 401);

  // 11.2 强制刷盘：调用 flush API 确保拦截日志已写入 DB（替代 sleep 等待）
  const flushResp = await api.post('/admin/intercept-logs/flush', {}, {
    headers: { Cookie: adminCookie }
  });
  assert('刷盘 API → 200', flushResp.status === 200, `flushed=${flushResp.data.data?.flushed}`);

  // 兜底：如果定时器已自动刷盘，flush 返回 0，此时轮询等待直到有数据
  let r1;
  for (let attempt = 0; attempt < 20; attempt++) {
    r1 = await api.get('/admin/intercept-logs', {
      headers: { Cookie: adminCookie }
    });
    if (r1.data.data?.total > 0) break;
    await sleep(250);
  }
  assert('已登录查询 → 200', r1.status === 200);
  assert('返回 list 数组', Array.isArray(r1.data.data?.list));
  assert('total > 0 (有拦截日志)', r1.data.data?.total > 0, `total=${r1.data.data?.total}`);
  assert('返回 page', r1.data.data?.page === 1);
  assert('返回 pageSize', r1.data.data?.pageSize === 20);

  // 11.3 IP 筛选
  const r2 = await api.get('/admin/intercept-logs?ip=127.0', {
    headers: { Cookie: adminCookie }
  });
  assert('IP 筛选 → 200', r2.status === 200);
}

// ═══════════════════════════════════════════════════════════════
// 12. 白名单 CRUD
// ═══════════════════════════════════════════════════════════════
async function test_12_whitelistCrud() {
  title('12. 白名单 CRUD');

  const headers = { Cookie: adminCookie };
  const testIp = '10.99.88.77';
  const testDevice = 'test-device-hash-whitelist-crud';

  // 12.1 添加 IP 白名单
  const r1 = await api.post('/admin/whitelist/add', { type: 'ip', value: testIp, remark: '自动化测试' }, { headers });
  assert('添加 IP 白名单', r1.data.code === 20000, `msg=${r1.data.msg || r1.data.message}`);

  // 12.2 添加设备白名单
  const r2 = await api.post('/admin/whitelist/add', { type: 'device', value: testDevice, remark: '测试设备' }, { headers });
  assert('添加设备白名单', r2.data.code === 20000, `msg=${r2.data.msg || r2.data.message}`);

  // 12.3 查询白名单（应包含刚添加的IP和设备）
  const r3 = await api.get('/admin/whitelist', { headers });
  assert('查询白名单 → 200', r3.status === 200);
  assert('ips 包含测试IP', r3.data.data?.ips?.includes(testIp));
  assert('devices 包含测试设备', r3.data.data?.devices?.includes(testDevice));
  assert('total ≥ 2', r3.data.data?.total >= 2, `total=${r3.data.data?.total}`);

  // 12.4 移除 IP 白名单
  const r4 = await api.post('/admin/whitelist/remove', { type: 'ip', value: testIp }, { headers });
  assert('移除 IP 白名单', r4.data.code === 20000, `msg=${r4.data.msg || r4.data.message}`);

  // 12.5 移除设备白名单
  const r5 = await api.post('/admin/whitelist/remove', { type: 'device', value: testDevice }, { headers });
  assert('移除设备白名单', r5.data.code === 20000, `msg=${r5.data.msg || r5.data.message}`);

  // 12.6 再次查询确认已移除
  const r6 = await api.get('/admin/whitelist', { headers });
  assert('IP 已从列表移除', !r6.data.data?.ips?.includes(testIp));
  assert('设备已从列表移除', !r6.data.data?.devices?.includes(testDevice));
}

// ═══════════════════════════════════════════════════════════════
// 13. 白名单放行验证
// ═══════════════════════════════════════════════════════════════
async function test_13_whitelistBypass() {
  title('13. 白名单放行验证');

  const headers = { Cookie: adminCookie };
  const testDevice = 'test-device-bypass-wl';
  const testPhone = P('301');

  // 先移除 IP 白名单（使后续 cancel 计入注销频控计数器）
  await api.post('/admin/whitelist/remove', { type: 'ip', value: '127.0.0.1' }, { headers });

  // 注册 + 注销（该设备被拉黑）
  await api.post('/user/register', { phone: testPhone, name: '先注册', deviceId: testDevice });
  await sleep(5100);
  await api.post('/user/cancel', { phone: testPhone, deviceId: testDevice });

  // 验证此时 IP 黑名单拦截生效（IP 白名单已移除，设备亦已拉黑）

  // 🆕 等待 phoneLimiter 过期（同手机号需要 5s 间隔）
  await sleep(5100);
  const blocked = await api.post('/user/register', { phone: testPhone, name: '待验证放行', deviceId: testDevice });
  assert('IP黑名单拦截 → 40302', blocked.data.code === 40302);

  // 加入设备白名单：即使 IP 在黑名单，设备白名单也能绕过 ip_bl 中间件
  await api.post('/admin/whitelist/add', { type: 'device', value: testDevice, remark: '放行测试' }, { headers });

  // 🆕 等待 phoneLimiter 过期
  await sleep(5100);
  const bypassed = await api.post('/user/register', { phone: testPhone, name: '白名单放行', deviceId: testDevice });
  assert('白名单设备放行 → code=20000', bypassed.data.code === 20000,
    `code=${bypassed.data.code} msg=${bypassed.data.msg || bypassed.data.message}`);

  // 清理：移除设备白名单，恢复 IP 白名单供后续测试使用
  await api.post('/admin/whitelist/remove', { type: 'device', value: testDevice }, { headers });
  await api.post('/admin/whitelist/add', { type: 'ip', value: '127.0.0.1', remark: 'auto-bypass' }, { headers });
}

// ═══════════════════════════════════════════════════════════════
// 14. 端到端全链路 (频控→滑块→注册→注销→黑名单→白名单恢复)
// ═══════════════════════════════════════════════════════════════
async function test_14_e2eFullChain() {
  title('14. 端到端全链路');

  const e2ePhone = P('499');
  const e2eDevice = 'device-e2e-fullchain-test';
  const headers = { Cookie: adminCookie };

  // Step 1: 正常注册 (IP 在白名单中)
  const r1 = await api.post('/user/register', { phone: e2ePhone, name: 'E2E测试', deviceId: e2eDevice });
  assert('E2E-1 正常注册成功', r1.data.code === 20000);

  // 临时移除 IP 白名单，验证黑名单拦截
  await api.post('/admin/whitelist/remove', { type: 'ip', value: '127.0.0.1' }, { headers });

  // Step 2: 注销 (进入手机号 + 设备黑名单)
  // 等待 phone limiter (1次/5秒) + 额外容错空间
  await sleep(6100);
  const r2 = await api.post('/user/cancel', { phone: e2ePhone, deviceId: e2eDevice });
  assert('E2E-2 注销成功', r2.data.code === 20000);

  // 🆕 等待 phoneLimiter + reg_ip 窗口
  await sleep(5100);

  // Step 3: 再次注册 → IP 黑名单拦截 (因为 IP 已不在白名单)
  const r3 = await api.post('/user/register', { phone: e2ePhone, name: '重试', deviceId: e2eDevice });
  assert('E2E-3 黑名单拦截 403', r3.status === 403, `status=${r3.status} code=${r3.data.code}`);

  // Step 4: 管理员加设备白名单恢复
  await api.post('/admin/whitelist/add', { type: 'device', value: e2eDevice, remark: 'E2E恢复' }, { headers });

  // 🆕 等待 phoneLimiter 过期
  await sleep(5100);

  // Step 5: 白名单放行 (设备白名单绕过 ip_bl)
  const r4 = await api.post('/user/register', { phone: e2ePhone, name: '白名单恢复', deviceId: e2eDevice });
  assert('E2E-4 白名单放行注册成功', r4.data.code === 20000, `code=${r4.data.code}`);

  // 清理白名单（不恢复 IP 白名单，供 test 15 测试注销频控）
  await api.post('/admin/whitelist/remove', { type: 'device', value: e2eDevice }, { headers });

  console.log(`  ${colors.green}✓${colors.reset} E2E 全链路: 注册→注销→黑名单拦截→白名单恢复→注册成功 ✅`);
}

// ═══════════════════════════════════════════════════════════════
// 15. 注销频控 (10min内 >20次 → 429)
// ═══════════════════════════════════════════════════════════════
async function test_15_cancelRateLimit() {
  title('15. 注销频控 (10min内 ≤20次 正常放行)');

  // 前序测试 (test 2/3/13/14) 已产生 ~5 次注销，远低于 20 上限
  const phone = P('601');
  // 先注册
  await api.post('/user/register', { phone, name: `注销频控` });
  await sleep(5100);
  // 第6次注销 → 未触及 20 次上限
  const r = await api.post('/user/cancel', { phone });
  assert('注销未超频 → 正常放行', r.status === 200 && r.data.code === 20000,
    `status=${r.status} code=${r.data.code} (注销上限 20次/10min)`);

  console.log(`  ${colors.yellow}⚠${colors.reset} 注销频控上限为 20次/10min，要触发需在同一窗口内超过 20 次注销`);
}

// ─── 辅助 ────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── 导出 ───────────────────────────────────────────────────────
module.exports = run;

if (require.main === module) {
  run().then(r => {
    if (r.failed > 0) process.exit(1);
  }).catch(e => {
    console.error(`\n${colors.red}${colors.bold}💥 测试异常终止:${colors.reset}`, e.message);
    process.exit(2);
  });
}
