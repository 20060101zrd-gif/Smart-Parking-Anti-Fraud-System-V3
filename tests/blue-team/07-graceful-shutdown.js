// tests/blue-team/07-graceful-shutdown.js
// ================================================================
// 模块七：优雅关闭 — 蓝队运维验收测试
// 验证 SIGTERM 信号触发后：
//   1. 审计/拦截日志定时器停止
//   2. MySQL 连接池正常释放
//   3. Redis 连接正常断开
//   4. 进程以 code 0 退出
// ================================================================
// 运行: node tests/blue-team/07-graceful-shutdown.js
// 前置条件: docker-compose up (Backend 运行在 parking-backend 容器中)
// ⚠️  此脚本会重启 backend 容器，运行约 25 秒
// ================================================================

const { execSync } = require('child_process');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// ─── 配置 ────────────────────────────────────────────────────────
const BACKEND_CONTAINER = 'parking-backend';
const BASE = 'http://127.0.0.1:3000/api/v1';

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

// ─── Docker 控制 ─────────────────────────────────────────────────
function dockerExec(cmd, ignoreError = false) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (ignoreError) return null;
    const stderr = (e.stderr || '').toString();
    const stdout = (e.stdout || '').toString();
    throw new Error(stderr || stdout || e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
//  主函数
// ═══════════════════════════════════════════════════════════════
async function run() {
  console.log(`${colors.bold}${colors.cyan}
╔══════════════════════════════════════════════════════╗
║   模块七：优雅关闭 — 运维验收测试                   ║
╚══════════════════════════════════════════════════════╝${colors.reset}
`);
  console.log(`Target: ${BACKEND_CONTAINER} (Docker)`);
  console.log(`Time:   ${new Date().toISOString()}\n`);

  const startTime = Date.now();

  // ── 1. 前置：记录 backend 容器当前日志行数 ──
  await preflight();

  // ── 2. 使用 docker stop 发送 SIGTERM ──
  await test_01_dockerStopGraceful();

  // ── 3. 检查关闭日志 ──
  await test_02_shutdownLogs();

  // ── 4. 重启 backend 并验证恢复 ──
  await test_03_restartAndVerify();

  // ── 5. SIGINT 测试 (docker restart 场景) ──
  await test_04_sigintGraceful();

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
    console.log(`\n${colors.green}${colors.bold}🎉 优雅关闭验证通过！K8s rolling update / docker stop 可安全使用。${colors.reset}`);
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

  // 确认后端容器存在且运行
  try {
    const status = dockerExec(`docker inspect ${BACKEND_CONTAINER} --format='{{.State.Status}}'`);
    assert('Backend 容器运行中', status === "'running'" || status === 'running', `status=${status}`);
  } catch (e) {
    assert('Backend 容器存在', false, e.message);
    console.error(`\n${colors.red}${colors.bold}请先启动 docker-compose up -d${colors.reset}\n`);
    process.exit(1);
  }

  // 确认后端 API 可达
  try {
    const api = axios.create({ baseURL: BASE, validateStatus: () => true, timeout: 5000 });
    const resp = await api.get('/health');
    assert('API 可达 (存活探针)', resp.status === 200, `HTTP ${resp.status}`);
  } catch (e) {
    assert('API 可达', false, e.message);
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════
// 1. docker stop 发送 SIGTERM → 优雅关闭
// ═══════════════════════════════════════════════════════════════
async function test_01_dockerStopGraceful() {
  title('1. docker stop → SIGTERM 优雅关闭');

  console.log(`  ${colors.yellow}⏸${colors.reset} 发送 docker stop (SIGTERM)...`);
  const startStop = Date.now();

  // docker stop 默认等待 10 秒才 SIGKILL
  // 如果优雅关闭代码正确，容器应在 10 秒内自己退出
  dockerExec(`docker stop ${BACKEND_CONTAINER}`);

  const stopTime = ((Date.now() - startStop) / 1000).toFixed(1);
  console.log(`  ${colors.green}✓${colors.reset} 容器在 ${stopTime}s 内停止`);

  // 验证容器已停止
  const status = dockerExec(`docker inspect ${BACKEND_CONTAINER} --format='{{.State.Status}}'`, true);
  const isExited = status === "'exited'" || status === 'exited';

  // 获取退出码
  const exitCode = dockerExec(`docker inspect ${BACKEND_CONTAINER} --format='{{.State.ExitCode}}'`, true);

  assert('容器已退出', isExited, `status=${status}`);
  assert('退出码为 0 (优雅) ', exitCode === "'0'" || exitCode === '0',
    `exitCode=${exitCode}`);

  // docker stop 超时 (> 9s) 说明优雅关闭太慢或被 SIGKILL 了
  // 正常应该在 1-3 秒内完成
  assert('停止速度正常 (< 8s，非 SIGKILL)', parseFloat(stopTime) < 8,
    `耗时 ${stopTime}s (如果 ≥ 10s 是 SIGKILL 杀死的)`);
}

// ═══════════════════════════════════════════════════════════════
// 2. 检查关闭日志
// ═══════════════════════════════════════════════════════════════
async function test_02_shutdownLogs() {
  title('2. 检查关闭日志完整性');

  // 读取容器的最后 30 行日志
  const logs = dockerExec(`docker logs ${BACKEND_CONTAINER} --tail 50`, true) || '';

  console.log(`  ${colors.dim}── Docker 日志尾部 ──${colors.reset}`);
  logs.split('\n').slice(-12).forEach(l => console.log(`    ${colors.dim}${l}${colors.reset}`));
  console.log(`  ${colors.dim}──────────────────────${colors.reset}`);

  // 检查关键日志消息
  const hasSigterm = logs.includes('SIGTERM') || logs.includes('SIGINT');
  const hasMysqlClose = logs.includes('MySQL') && (logs.includes('连接池已关闭') || logs.includes('close') || logs.includes('连接池'));
  const hasRedisClose = logs.includes('Redis') && (logs.includes('关闭') || logs.includes('quit') || logs.includes('断开'));
  const hasAllReleased = logs.includes('所有资源已释放') || logs.includes('安全退出');

  assert('收到 SIGTERM/SIGINT 信号', hasSigterm,
    `foundSIGTERM=${hasSigterm}`);
  assert('MySQL 连接池正常关闭', hasMysqlClose,
    `foundMysqlClose=${hasMysqlClose}`);
  assert('Redis 连接正常断开', hasRedisClose,
    `foundRedisClose=${hasRedisClose}`);
  assert('输出"所有资源已释放"', hasAllReleased,
    `foundAllReleased=${hasAllReleased}`);
}

// ═══════════════════════════════════════════════════════════════
// 3. 重启 backend 并验证恢复
// ═══════════════════════════════════════════════════════════════
async function test_03_restartAndVerify() {
  title('3. 重启 Backend 并验证健康检查恢复');

  console.log(`  ${colors.yellow}▶${colors.reset} 启动 backend 容器...`);
  dockerExec(`docker start ${BACKEND_CONTAINER}`);

  // 等待 backend 启动完成
  console.log(`  ${colors.yellow}⏳${colors.reset} 等待启动完成 (12s)...`);
  await sleep(12000);
  console.log(`  ${colors.green}✓${colors.reset} 继续`);

  // 验证健康检查
  const api = axios.create({ baseURL: BASE, validateStatus: () => true, timeout: 5000 });

  let healthOk = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const resp = await api.get('/health/ready');
      if (resp.status === 200 && resp.data.status === 'ok') {
        healthOk = true;
        break;
      }
    } catch { /* retry */ }
    if (attempt < 5) {
      console.log(`  ${colors.yellow}⏳${colors.reset} 第 ${attempt} 次健康检查未通过，等待 3s...`);
      await sleep(3000);
    }
  }

  assert('重启后 /health 返回 200', healthOk);
}

// ═══════════════════════════════════════════════════════════════
// 4. docker restart 场景 (SIGINT) 也能优雅关闭
// ═══════════════════════════════════════════════════════════════
async function test_04_sigintGraceful() {
  title('4. docker restart 场景验证');

  console.log(`  ${colors.yellow}🔄${colors.reset} docker restart (内部发 SIGTERM→SIGKILL)...`);
  const startRestart = Date.now();
  dockerExec(`docker restart ${BACKEND_CONTAINER}`);
  const restartTime = ((Date.now() - startRestart) / 1000).toFixed(1);
  console.log(`  ${colors.green}✓${colors.reset} 重启完成，耗时 ${restartTime}s`);

  // 等待再次就绪
  console.log(`  ${colors.yellow}⏳${colors.reset} 等待就绪 (10s)...`);
  await sleep(10000);

  const api = axios.create({ baseURL: BASE, validateStatus: () => true, timeout: 5000 });

  let healthOk = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const resp = await api.get('/health/ready');
      if (resp.status === 200 && resp.data.status === 'ok') {
        healthOk = true;
        break;
      }
    } catch { /* retry */ }
    if (attempt < 5) {
      console.log(`  ${colors.yellow}⏳${colors.reset} 第 ${attempt} 次重试，等待 3s...`);
      await sleep(3000);
    }
  }

  assert('restart 后 /health/ready 正常', healthOk);

  // 检查 restart 的日志也有优雅关闭消息
  const logs = dockerExec(`docker logs ${BACKEND_CONTAINER} --tail 30`, true) || '';
  const hasRestartShutdown = logs.includes('SIGTERM') ||
    logs.includes('所有资源已释放') ||
    logs.includes('安全退出');

  assert('restart 过程也触发优雅关闭', hasRestartShutdown,
    `found=${hasRestartShutdown}`);
}

// ─── 导出 ────────────────────────────────────────────────────────
module.exports = run;

if (require.main === module) {
  run().then(r => {
    if (r.failed > 0) process.exit(1);
  }).catch(e => {
    console.error(`\n${colors.red}${colors.bold}💥 测试异常终止:${colors.reset}`, e.message);
    try {
      const status = dockerExec(`docker inspect ${BACKEND_CONTAINER} --format='{{.State.Status}}'`, true);
      if (status !== "'running'" && status !== 'running') {
        dockerExec(`docker start ${BACKEND_CONTAINER}`, true);
      }
    } catch {}
    process.exit(2);
  });
}
