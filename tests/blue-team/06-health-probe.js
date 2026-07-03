// tests/blue-team/06-health-probe.js
// ================================================================
// 模块六：健康探针端点 — 蓝队运维验收测试
// 验证 /health + /health/ready 在正常/降级状态下的正确响应
// ================================================================
// 运行: node tests/blue-team/06-health-probe.js
// 前置条件: docker-compose up (MySQL + Redis + Backend 均运行)
// ================================================================

const axios = require('axios');
const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// ─── 配置 ────────────────────────────────────────────────────────
const BASE = 'http://127.0.0.1:3000/api/v1';
const MYSQL_CONTAINER = 'parking-mysql';
const REDIS_CONTAINER = 'parking-redis';

// ─── 工具 ────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

// ─── HTTP 客户端 ─────────────────────────────────────────────────
const api = axios.create({ baseURL: BASE, validateStatus: () => true, timeout: 30000 });

// ─── Docker 控制 ─────────────────────────────────────────────────
function dockerExec(cmd, ignoreError = false) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (ignoreError) return null;
    throw e;
  }
}

// ─── 容器内部请求 ───────────────────────────────────────────────
// 绕过 Docker Desktop on Windows 的网络层问题（长等待场景丢响应）
const BACKEND_CONTAINER = 'parking-backend';
function containerGet(path, timeoutSec = 10) {
  // 使用 execSync 直接在 shell 里跑，避免模板字符串转义问题
  const cmd = `docker exec ${BACKEND_CONTAINER} node -e "`
    + `var h=require('http');`
    + `var r=h.get('http://127.0.0.1:3000${path.replace(/'/g, "\\\\'")}',`
    + `function(s){var d='';s.on('data',function(c){d+=c});`
    + `s.on('end',function(){process.stdout.write(JSON.stringify({sc:s.statusCode,bd:d}))})`
    + `});`
    + `r.setTimeout(${timeoutSec * 1000},function(){r.destroy();process.stdout.write('TO')});`
    + `r.on('error',function(){process.stdout.write('ER')})`
    + `"`;
  const raw = dockerExec(cmd);
  if (!raw || raw === 'TO' || raw === 'ER') return null;
  try {
    const parsed = JSON.parse(raw);
    return { status: parsed.sc, data: JSON.parse(parsed.bd) };
  } catch {
    return null;
  }
}

async function pauseContainer(name) {
  console.log(`  ${colors.yellow}⏸${colors.reset} 暂停 ${name}...`);
  dockerExec(`docker pause ${name}`);
  // 等待暂停生效
  await sleep(2000);
}

async function unpauseContainer(name) {
  console.log(`  ${colors.yellow}▶${colors.reset} 恢复 ${name}...`);
  dockerExec(`docker unpause ${name}`);
  await sleep(3000);
}

function isContainerRunning(name) {
  try {
    const status = dockerExec(`docker inspect ${name} --format='{{.State.Status}}'`);
    return status === "'running'" || status === 'running';
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
//  主函数
// ═══════════════════════════════════════════════════════════════
async function run() {
  console.log(`${colors.bold}${colors.cyan}
╔══════════════════════════════════════════════════════╗
║   模块六：健康探针端点 — 运维验收测试               ║
╚══════════════════════════════════════════════════════╝${colors.reset}
`);
  console.log(`Target: ${BASE}`);
  console.log(`Time:   ${new Date().toISOString()}\n`);

  const startTime = Date.now();

  // ── 前置：确认所有容器运行中 ──
  await preflight();

  // ── 1. 存活探针 — 正常状态 ──
  await test_01_livenessProbe();

  // ── 2. 就绪探针 — 正常状态 ──
  await test_02_readinessProbeNormal();

  // ── 3. 就绪探针 — MySQL 宕机降级 ──
  await test_03_readinessProbeMysqlDown();

  // ── 4. 就绪探针 — MySQL 恢复 ──
  await test_04_readinessProbeMysqlRecover();

  // ── 5. 就绪探针 — Redis 宕机降级 ──
  await test_05_readinessProbeRedisDown();

  // ── 6. 就绪探针 — Redis 恢复 ──
  await test_06_readinessProbeRedisRecover();

  // ── 7. 就绪探针 — 双宕机场景 ──
  await test_07_dualDown();

  // ── 8. 格式校验 ──
  await test_08_responseSchema();

  // ──────────────────────────────────────────────────────────────
  // 最终报告
  // ──────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const total = passCount + failCount;
  const passRate = total > 0 ? ((passCount / total) * 100).toFixed(1) : '0.0';
  console.log(`\n${colors.bold}${colors.cyan}╔══════════════════════════════════════════════════════╗
║              验 收 报 告                               ║
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

  if (failCount > 0) {
    console.log(`\n${colors.yellow}⚠ 存在 ${failCount} 项未通过，请检查上方 ✗ 标记项。${colors.reset}`);
  } else {
    console.log(`\n${colors.green}${colors.bold}🎉 所有健康探针验证通过！K8s/Docker 就绪探针可用。${colors.reset}`);
  }

  return {
    total, passed: passCount, failed: failCount,
    passRate, elapsed,
    failures: results.filter(r => r.status === 'FAIL')
  };
}

// ═══════════════════════════════════════════════════════════════
// 前置检查
// ═══════════════════════════════════════════════════════════════
async function preflight() {
  title('0. 前置检查');

  // 确认后端可达
  try {
    const resp = await api.get('/health');
    assert('后端服务可达', resp.status === 200, `HTTP ${resp.status}`);
  } catch (e) {
    assert('后端服务可达', false, e.message);
    console.error(`\n${colors.red}${colors.bold}请先启动 docker-compose up 确保所有服务运行${colors.reset}\n`);
    process.exit(1);
  }

  // 确认 MySQL 和 Redis 容器都在运行
  if (!isContainerRunning(MYSQL_CONTAINER)) {
    console.log(`  ${colors.yellow}⚠${colors.reset} MySQL 未运行，尝试启动...`);
    dockerExec(`docker unpause ${MYSQL_CONTAINER}`, true);
    await sleep(5000);
  }
  if (!isContainerRunning(REDIS_CONTAINER)) {
    console.log(`  ${colors.yellow}⚠${colors.reset} Redis 未运行，尝试启动...`);
    dockerExec(`docker unpause ${REDIS_CONTAINER}`, true);
    await sleep(3000);
  }

  assert('MySQL 容器运行中', isContainerRunning(MYSQL_CONTAINER));
  assert('Redis 容器运行中', isContainerRunning(REDIS_CONTAINER));
}

// ═══════════════════════════════════════════════════════════════
// 1. 存活探针 — 只要服务活着就返回 200
// ═══════════════════════════════════════════════════════════════
async function test_01_livenessProbe() {
  title('1. 存活探针 GET /health');

  const resp = await api.get('/health');
  assert('HTTP 200', resp.status === 200);
  assert('status=ok', resp.data.status === 'ok');
  assert('含 timestamp', typeof resp.data.timestamp === 'number' && resp.data.timestamp > 0,
    `ts=${resp.data.timestamp}`);
}

// ═══════════════════════════════════════════════════════════════
// 2. 就绪探针 — 正常状态
// ═══════════════════════════════════════════════════════════════
async function test_02_readinessProbeNormal() {
  title('2. 就绪探针 GET /health/ready — 正常状态');

  const resp = containerGet('/api/v1/health/ready', 6);
  assert('容器内可达', resp !== null, 'containerGet 返回非空');
  assert('HTTP 200', resp.status === 200, `status=${resp.status}`);
  assert('status=ok', resp.data.status === 'ok');
  assert('mysql=up', resp.data.checks && resp.data.checks.mysql === 'up',
    `mysql=${resp.data.checks && resp.data.checks.mysql}`);
  assert('redis=up', resp.data.checks && resp.data.checks.redis === 'up',
    `redis=${resp.data.checks && resp.data.checks.redis}`);
}

// ═══════════════════════════════════════════════════════════════
// 3. 就绪探针 — MySQL 宕机 → 503
// ═══════════════════════════════════════════════════════════════
async function test_03_readinessProbeMysqlDown() {
  title('3. 就绪探针 — MySQL 宕机时返回 503');

  await pauseContainer(MYSQL_CONTAINER);

  const resp = containerGet('/api/v1/health/ready', 10);
  if (!resp) {
    assert('HTTP 503 (degraded) — containerGet 返回 null（超时）', false, 'MySQL paused 后 backend 未在时限内响应');
    return;
  }
  assert('HTTP 503 (degraded)', resp.status === 503, `status=${resp.status}`);
  assert('status=degraded', resp.data && resp.data.status === 'degraded');
  assert('mysql=down', resp.data && resp.data.checks && resp.data.checks.mysql === 'down',
    `mysql=${resp.data && resp.data.checks && resp.data.checks.mysql}`);
  assert('redis=up (Redis 不受影响)', resp.data && resp.data.checks && resp.data.checks.redis === 'up',
    `redis=${resp.data && resp.data.checks && resp.data.checks.redis}`);
}

// ═══════════════════════════════════════════════════════════════
// 4. 就绪探针 — MySQL 恢复 → 200
// ═══════════════════════════════════════════════════════════════
async function test_04_readinessProbeMysqlRecover() {
  title('4. 就绪探针 — MySQL 恢复后返回 200');

  await unpauseContainer(MYSQL_CONTAINER);
  // 给 MySQL 充分时间完成启动 + backend 连接池重连
  console.log(`  ${colors.yellow}⏳${colors.reset} 等待 MySQL 完全恢复 (8s)...`);
  await sleep(8000);
  console.log(`  ${colors.green}✓${colors.reset} 继续`);

  const resp = containerGet('/api/v1/health/ready', 6);
  assert('容器内可达', resp !== null, 'containerGet 返回非空');
  assert('HTTP 200 (恢复)', resp.status === 200, `status=${resp.status}`);
  assert('status=ok', resp.data.status === 'ok');
  assert('mysql=up (已恢复)', resp.data.checks && resp.data.checks.mysql === 'up',
    `mysql=${resp.data.checks && resp.data.checks.mysql}`);
  assert('redis=up', resp.data.checks && resp.data.checks.redis === 'up');
}

// ═══════════════════════════════════════════════════════════════
// 5. 就绪探针 — Redis 宕机 → 503
// ═══════════════════════════════════════════════════════════════
async function test_05_readinessProbeRedisDown() {
  title('5. 就绪探针 — Redis 宕机时返回 503');

  await pauseContainer(REDIS_CONTAINER);

  const resp = containerGet('/api/v1/health/ready', 10);
  assert('容器内可达', resp !== null, 'containerGet 返回非空');
  assert('HTTP 503 (degraded)', resp.status === 503, `status=${resp.status}`);
  assert('status=degraded', resp.data.status === 'degraded');
  assert('redis=down', resp.data.checks && resp.data.checks.redis === 'down',
    `redis=${resp.data.checks && resp.data.checks.redis}`);
  assert('mysql=up (MySQL 不受影响)', resp.data.checks && resp.data.checks.mysql === 'up',
    `mysql=${resp.data.checks && resp.data.checks.mysql}`);
}

// ═══════════════════════════════════════════════════════════════
// 6. 就绪探针 — Redis 恢复 → 200
// ═══════════════════════════════════════════════════════════════
async function test_06_readinessProbeRedisRecover() {
  title('6. 就绪探针 — Redis 恢复后返回 200');

  await unpauseContainer(REDIS_CONTAINER);
  console.log(`  ${colors.yellow}⏳${colors.reset} 等待 Redis 恢复 (3s)...`);
  await sleep(3000);
  console.log(`  ${colors.green}✓${colors.reset} 继续`);

  const resp = containerGet('/api/v1/health/ready', 6);
  assert('容器内可达', resp !== null, 'containerGet 返回非空');
  assert('HTTP 200 (恢复)', resp.status === 200, `status=${resp.status}`);
  assert('status=ok', resp.data.status === 'ok');
  assert('redis=up (已恢复)', resp.data.checks && resp.data.checks.redis === 'up',
    `redis=${resp.data.checks && resp.data.checks.redis}`);
  assert('mysql=up', resp.data.checks && resp.data.checks.mysql === 'up');
}

// ═══════════════════════════════════════════════════════════════
// 7. 双宕机场景 — MySQL + Redis 同时挂
// ═══════════════════════════════════════════════════════════════
async function test_07_dualDown() {
  title('7. 就绪探针 — MySQL + Redis 双宕机');

  await pauseContainer(MYSQL_CONTAINER);
  await pauseContainer(REDIS_CONTAINER);

  const resp = containerGet('/api/v1/health/ready', 10);
  assert('容器内可达', resp !== null, 'containerGet 返回非空');
  assert('HTTP 503 (完全降级)', resp.status === 503, `status=${resp.status}`);
  assert('status=degraded', resp.data.status === 'degraded');
  assert('mysql=down', resp.data.checks && resp.data.checks.mysql === 'down');
  assert('redis=down', resp.data.checks && resp.data.checks.redis === 'down');

  // 恢复两个容器
  console.log(`  ${colors.yellow}▶${colors.reset} 恢复所有容器...`);
  await unpauseContainer(MYSQL_CONTAINER);
  await unpauseContainer(REDIS_CONTAINER);
  console.log(`  ${colors.yellow}⏳${colors.reset} 等待完全恢复 (8s)...`);
  await sleep(8000);
  console.log(`  ${colors.green}✓${colors.reset} 继续`);

  // 确认恢复
  const resp2 = containerGet('/api/v1/health/ready', 6);
  assert('容器内可达', resp2 !== null, '双恢复后 containerGet 返回非空');
  assert('双恢复后 HTTP 200', resp2.status === 200, `status=${resp2.status}`);
  assert('双恢复后 status=ok', resp2.data.status === 'ok');
}

// ═══════════════════════════════════════════════════════════════
// 8. 响应格式校验
// ═══════════════════════════════════════════════════════════════
async function test_08_responseSchema() {
  title('8. 响应格式校验');

  // /health
  const r1 = await api.get('/health');
  assert('/health 含 status 字段', typeof r1.data.status === 'string');
  assert('/health 含 timestamp 字段', typeof r1.data.timestamp === 'number');

  // /health/ready — 容器内请求
  const r2 = containerGet('/api/v1/health/ready', 6);
  assert('/health/ready 容器内可达', r2 !== null);
  assert('/health/ready 含 status', typeof r2.data.status === 'string');
  assert('/health/ready 含 checks.mysql', typeof r2.data.checks === 'object' && typeof r2.data.checks.mysql === 'string');
  assert('/health/ready 含 checks.redis', typeof r2.data.checks === 'object' && typeof r2.data.checks.redis === 'string');
}

// ─── 导出 ────────────────────────────────────────────────────────
module.exports = run;

if (require.main === module) {
  run().then(r => {
    if (r.failed > 0) process.exit(1);
  }).catch(e => {
    console.error(`\n${colors.red}${colors.bold}💥 测试异常终止:${colors.reset}`, e.message);
    try {
      dockerExec(`docker unpause ${MYSQL_CONTAINER}`, true);
      dockerExec(`docker unpause ${REDIS_CONTAINER}`, true);
    } catch {}
    process.exit(2);
  });
}
