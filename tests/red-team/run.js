// tests/red-team/run.js
// ================================================================
// 🔴 Red Team — 自动化渗透测试编排器
// 模拟攻击方视角，验证防线是否真正有效
// 运行: node tests/red-team/run.js
// ================================================================
const fs = require('fs');
const path = require('path');
const runBruteForce = require('./01-brute-force');
const runJwtForge = require('./02-jwt-forge');
const runBlacklistBloat = require('./03-blacklist-bloat');
const runRiskControl = require('./04-risk-control');
const runDataLayer = require('./05-data-layer');
const runAdminAttack = require('./06-admin-attack');
const autocannon = require('autocannon');

async function main() {
  console.log("==================================================");
  console.log("🔴  Red Team - 自动化渗透攻击测试套件启动");
  console.log("==================================================\n");

  const timestamp = new Date();
  const tsStr = timestamp.toISOString().replace(/[-:]/g, '').replace('T', '-').substring(0, 15);
  const mdFileName = `red-team-report-${tsStr}.md`;
  const txtFileName = `red-team-report-${tsStr}.txt`;

  let mdReport = `# 智能停车风控系统 - 红队渗透测试报告\n\n`;
  mdReport += `**生成时间:** ${timestamp.toLocaleString()}\n\n`;
  mdReport += `---\n\n`;

  let txtReport = `智能停车风控系统 - 红队渗透测试报告\n`;
  txtReport += `生成时间: ${timestamp.toLocaleString()}\n`;
  txtReport += `${'='.repeat(60)}\n\n`;

  // ═══════════════════════════════════════════════
  // 模块一：风控核心 — 红队渗透
  // ═══════════════════════════════════════════════
  console.log("▶️ [1/6] 模块一：风控核心 — 红队渗透测试...\n");
  let m1Result = null;
  try {
    m1Result = await runRiskControl();
  } catch (e) {
    console.error('❌ 模块一异常:', e.message);
    m1Result = { total: 16, passed: 0, failed: 16, passRate: '0.0', grade: 'N/A', failures: [{ name: '模块一崩溃', detail: e.message }] };
  }

  mdReport += `## 1. 模块一：风控核心 — 红队渗透测试\n\n`;
  mdReport += `| 指标 | 数值 |\n|------|------|\n`;
  mdReport += `| 总用例数 | ${m1Result.total} |\n| 防线守住 | ${m1Result.passed} ✅ |\n| 防线突破 | ${m1Result.failed} ❌ |\n| 通过率 | ${m1Result.passRate}% |\n| 耗时 | ${m1Result.elapsed}s |\n| 安全评级 | ${m1Result.grade} |\n\n`;
  if (m1Result.failures && m1Result.failures.length > 0) {
    mdReport += `### 被突破详情\n\n`;
    m1Result.failures.forEach((f, i) => mdReport += `${i + 1}. **${f.name}** — ${f.detail}\n`);
    mdReport += `\n`;
  }
  mdReport += `---\n\n`;

  txtReport += `模块一：风控核心 — 红队渗透测试\n${'─'.repeat(50)}\n  总用例: ${m1Result.total}\n  防线守住: ${m1Result.passed}\n  防线突破: ${m1Result.failed}\n  通过率: ${m1Result.passRate}%\n  评级: ${m1Result.grade}\n\n`;
  console.log("✅ 模块一完成。\n");

  // ═══════════════════════════════════════════════
  // 模块二：数据层 — 红队攻防
  // ═══════════════════════════════════════════════
  console.log("▶️ [2/6] 模块二：数据层安全 — 红队攻防测试...\n");
  let m2Result = null;
  try {
    m2Result = await runDataLayer();
  } catch (e) {
    console.error('❌ 模块二异常:', e.message);
    m2Result = { total: 4, passed: 0, failed: 4, passRate: '0.0', riskRate: '100.0', grade: 'N/A', failures: [{ name: '模块二崩溃', detail: e.message }], totalAttacks: 4, safePasses: 0, risks: 4, riskItems: [] };
  }

  mdReport += `## 2. 模块二：数据层安全 — 红队攻防测试\n\n`;
  mdReport += `| 指标 | 数值 |\n|------|------|\n| 总攻击项 | ${m2Result.totalAttacks || m2Result.total} |\n| 防线守住 | ${m2Result.safePasses || m2Result.passed} ✅ |\n| 发现风险 | ${m2Result.risks || m2Result.failed} ❌ |\n| 风险率 | ${m2Result.riskRate}% |\n| 通过率 | ${m2Result.passRate}% |\n| 耗时 | ${m2Result.elapsed}s |\n| 安全评级 | ${m2Result.grade} |\n\n`;
  if (m2Result.failures && m2Result.failures.length > 0) {
    mdReport += `### 已发现安全风险\n\n`;
    m2Result.failures.forEach((f, i) => mdReport += `${i + 1}. **${f.name}** — ${f.detail}\n`);
    mdReport += `\n`;
  }
  mdReport += `---\n\n`;

  txtReport += `模块二：数据层安全 — 红队攻防测试\n${'─'.repeat(50)}\n  总攻击项: ${m2Result.totalAttacks || m2Result.total}\n  防线守住: ${m2Result.safePasses || m2Result.passed}\n  发现风险: ${m2Result.risks || m2Result.failed}\n  风险率: ${m2Result.riskRate}%\n  评级: ${m2Result.grade}\n\n`;
  console.log("✅ 模块二完成。\n");

  // ═══════════════════════════════════════════════
  // 模块三：管理后台 — 红队攻防
  // ═══════════════════════════════════════════════
  console.log("▶️ [3/6] 模块三：管理后台 — 红队攻防测试...\n");
  let m3Result = null;
  try {
    m3Result = await runAdminAttack();
  } catch (e) {
    console.error('❌ 模块三异常:', e.message);
    m3Result = { total: 6, passed: 0, failed: 6, passRate: '0.0', riskRate: '100.0', grade: 'N/A', failures: [{ name: '模块三崩溃', detail: e.message }], totalAttacks: 6, safePasses: 0, riskCount: 6, riskItems: [] };
  }

  mdReport += `## 3. 模块三：管理后台 — 红队攻防测试\n\n`;
  mdReport += `| 指标 | 数值 |\n|------|------|\n| 总攻击项 | ${m3Result.totalAttacks || m3Result.total} |\n| 防线守住 | ${m3Result.safePasses || m3Result.passed} ✅ |\n| 发现风险 | ${m3Result.riskCount || m3Result.failed} ❌ |\n| 风险率 | ${m3Result.riskRate}% |\n| 通过率 | ${m3Result.passRate}% |\n| 耗时 | ${m3Result.elapsed}s |\n| 安全评级 | ${m3Result.grade} |\n\n`;
  if (m3Result.failures && m3Result.failures.length > 0) {
    mdReport += `### 已发现安全风险\n\n`;
    m3Result.failures.forEach((f, i) => mdReport += `${i + 1}. **${f.name}** — ${f.detail}\n`);
    mdReport += `\n`;
  }
  mdReport += `---\n\n`;

  txtReport += `模块三：管理后台 — 红队攻防测试\n${'─'.repeat(50)}\n  总攻击项: ${m3Result.totalAttacks || m3Result.total}\n  防线守住: ${m3Result.safePasses || m3Result.passed}\n  发现风险: ${m3Result.riskCount || m3Result.failed}\n  风险率: ${m3Result.riskRate}%\n  评级: ${m3Result.grade}\n\n`;
  console.log("✅ 模块三完成。\n");

  // ═══════════════════════════════════════════════
  // 恶意重刷压测
  // ═══════════════════════════════════════════════
  console.log("▶️ [4/6] 恶意重刷压测 (Target: 500 QPS)...");
  const bruteResult = await runBruteForce();

  mdReport += `## 4. 恶意重刷压测\n`;
  if (bruteResult && bruteResult.requests) {
    console.log(autocannon.printResult(bruteResult));
    mdReport += `- **总请求数**: \`${bruteResult.requests.total}\` 次\n`;
    mdReport += `- **平均 QPS**: \`${bruteResult.requests.average}\` req/sec\n`;
    mdReport += `- **平均延迟**: \`${bruteResult.latency.average} ms\`\n`;
  } else {
    mdReport += `- **状态**: ✅ 执行完毕\n`;
  }
  mdReport += `---\n\n`;
  txtReport += `恶意重刷压测: ✅ 执行完毕\n\n`;
  console.log("✅ 压测模块完成。\n");

  // ═══════════════════════════════════════════════
  // JWT 伪造攻击
  // ═══════════════════════════════════════════════
  console.log("▶️ [5/6] JWT 专项伪造攻击...");
  const jwtResult = await runJwtForge();
  console.log("📊 JWT 攻击结果:", jwtResult);

  mdReport += `## 5. JWT 伪造攻击\n`;
  mdReport += `- **拦截非法伪造 (Blocked)**: \`${jwtResult.stats.blocked}\` 次\n`;
  mdReport += `- **越权漏洞 (Error/Bypassed)**: \`${jwtResult.stats.error}\` 次\n`;
  mdReport += `- **安全结论**: ${jwtResult.stats.error > 0 ? '⚠️ 发现越权漏洞，需立刻修复！' : '✅ 防御成功，拦截了所有非法伪造。'}\n\n`;
  mdReport += `---\n\n`;

  txtReport += `JWT 伪造攻击:\n  拦截: ${jwtResult.stats.blocked} | 越权: ${jwtResult.stats.error}\n  结论: ${jwtResult.stats.error > 0 ? '⚠️ 存在越权漏洞' : '✅ 防御成功'}\n\n`;

  // ═══════════════════════════════════════════════
  // 黑名单膨胀压测
  // ═══════════════════════════════════════════════
  console.log("▶️ [6/6] 黑名单慢速注入攻击 (约需 20 秒)...");
  const bloatResult = await runBlacklistBloat();
  console.log("📊 膨胀注入结果:", bloatResult);

  mdReport += `## 6. 黑名单膨胀压测 (慢速绕过版)\n`;
  mdReport += `- **成功注入脏数据 (Normal)**: \`${bloatResult.stats.normal}\` 条\n`;
  mdReport += `- **注入失败/被风控拦截 (Error)**: \`${bloatResult.stats.error}\` 条\n\n`;

  txtReport += `黑名单膨胀压测:\n  注入成功: ${bloatResult.stats.normal} | 拦截: ${bloatResult.stats.error}\n\n`;

  // ═══════════════════════════════════════════════
  // 综合统计
  // ═══════════════════════════════════════════════
  const m1PassRate = m1Result.passRate;

  mdReport += `---\n\n## 📊 综合统计\n\n`;
  mdReport += `| 模块 | 通过率 | 风险率 | 结论 |\n|------|--------|--------|------|\n`;
  mdReport += `| 模块一：风控核心 | ${m1PassRate}% | — | ${m1Result.passed >= m1Result.total * 0.85 ? '✅' : '⚠️'} ${m1Result.grade} |\n`;
  mdReport += `| 模块二：数据层安全 | ${m2Result.passRate}% | ${m2Result.riskRate}% | ${(m2Result.risks || 0) > 0 ? '⚠️ 发现风险' : '✅'} ${m2Result.grade} |\n`;
  mdReport += `| 模块三：管理后台 | ${m3Result.passRate}% | ${m3Result.riskRate}% | ${(m3Result.riskCount || 0) > 0 ? '⚠️ 发现风险' : '✅'} ${m3Result.grade} |\n`;
  mdReport += `| 恶意重刷压测 | ✅ | — | 执行完毕 |\n`;
  mdReport += `| JWT 伪造攻击 | ${jwtResult.stats.error > 0 ? '⚠️' : '✅'} | — | ${jwtResult.stats.error > 0 ? '存在漏洞' : '防御有效'} |\n`;
  mdReport += `| 黑名单膨胀压测 | ✅ | — | 执行完毕 |\n`;

  txtReport += `${'='.repeat(60)}\n综合统计:\n`;
  txtReport += `  模块一（风控核心）: ${m1PassRate}% (${m1Result.passed}/${m1Result.total})\n`;
  txtReport += `  模块二（数据层安全）: ${m2Result.passRate}% 风险率=${m2Result.riskRate}%\n`;
  txtReport += `  模块三（管理后台）: ${m3Result.passRate}% 风险率=${m3Result.riskRate}%\n`;
  txtReport += `  恶意重刷压测: ✅ 完成\n`;
  txtReport += `  JWT 伪造: ${jwtResult.stats.error > 0 ? '⚠️ 有漏洞' : '✅ 安全'}\n`;
  txtReport += `  黑名单膨胀: ✅ 完成\n`;

  // 写入文件
  const reportsDir = path.join(__dirname, '../reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const mdPath = path.join(reportsDir, mdFileName);
  const txtPath = path.join(reportsDir, txtFileName);
  fs.writeFileSync(mdPath, mdReport, 'utf8');
  fs.writeFileSync(txtPath, txtReport, 'utf8');

  console.log("==================================================");
  console.log("🔴 红队渗透测试执行完毕！");
  console.log(`📄 Markdown 报告: ./reports/${mdFileName}`);
  console.log(`📄 文本报告:      ./reports/${txtFileName}`);
  console.log("==================================================");
}

main().catch(e => {
  console.error("\n❌ 红队测试总线发生致命错误:", e);
  process.exit(1);
});
