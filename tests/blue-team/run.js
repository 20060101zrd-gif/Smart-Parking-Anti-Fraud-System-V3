// tests/blue-team/run.js
// ================================================================
// 🔵 Blue Team — 全模块功能验收测试编排器（含报告生成）
// 验证每个接口功能正确，确保系统可预期运行
// 运行: node tests/blue-team/run.js
// ================================================================
const fs = require('fs');
const path = require('path');

const runRiskControl    = require('./01-risk-control.js');
const runDataLayer      = require('./02-data-layer.js');
const runAdmin          = require('./03-admin.js');
const runEngineering    = require('./04-engineering.js');
const runAppConfig      = require('./05-app-config.js');
const runHealthProbe    = require('./06-health-probe.js');
const runGracefulShutdown = require('./07-graceful-shutdown.js');

const MODULES = [
  { name: '模块一：风控核心',       fn: runRiskControl },
  { name: '模块二：数据层',         fn: runDataLayer },
  { name: '模块三：管理员后台',     fn: runAdmin },
  { name: '模块四：工程化改造',     fn: runEngineering },
  { name: '模块五：App 配置校验',   fn: runAppConfig },
  { name: '模块六：健康探针端点',   fn: runHealthProbe },
  { name: '模块七：优雅关闭验证',   fn: runGracefulShutdown },
];

async function main() {
  console.log('\n============================================');
  console.log('🔵  Blue Team — 全模块功能验收测试套件');
  console.log('============================================\n');

  const startTime = Date.now();
  const allResults = [];

  for (const m of MODULES) {
    console.log(`▶️  ${m.name}\n`);
    try {
      const result = await m.fn();
      const icon = result.failed === 0 ? '✅' : '❌';
      console.log(`${icon} ${m.name} — ${result.passed}/${result.total} 通过 (${result.passRate}%)${result.elapsed ? ' · ' + result.elapsed + 's' : ''}\n`);
      allResults.push({ name: m.name, ...result, error: null });
    } catch (e) {
      console.log(`💥 ${m.name} — 执行异常：${e.message}\n`);
      allResults.push({ name: m.name, total: 0, passed: 0, failed: 1, passRate: '0.0', elapsed: '0.0', failures: [{ name: '模块崩溃', detail: e.message }], error: e.message });
    }
    console.log('--------------------------------------------\n');
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const passCount = allResults.filter(r => r.failed === 0 && !r.error).length;
  const totalCases = allResults.reduce((sum, r) => sum + (r.total || 0), 0);
  const totalPassed = allResults.reduce((sum, r) => sum + (r.passed || 0), 0);
  const totalFailed = allResults.reduce((sum, r) => sum + (r.failed || 0), 0);

  // 终端汇总
  console.log('============================================');
  console.log('📊 Blue Team 功能验收汇总');
  console.log('============================================');
  console.log(`  总模块:  ${MODULES.length}`);
  console.log(`  通过:    ${passCount} ✅`);
  console.log(`  失败:    ${MODULES.length - passCount} ❌`);
  console.log(`  总用例:  ${totalCases} (✓ ${totalPassed}  ✗ ${totalFailed})`);
  console.log(`  耗时:    ${totalElapsed}s\n`);

  allResults.forEach(r => {
    const icon = r.failed === 0 && !r.error ? '✅' : '❌';
    console.log(`  ${icon} ${r.name}  ${r.passed}/${r.total}  ${r.passRate}%`);
  });

  // ── 生成报告文件 ──
  const timestamp = new Date();
  const tsStr = timestamp.toISOString().replace(/[-:]/g, '').replace('T', '-').substring(0, 15);
  const mdFileName = `blue-team-report-${tsStr}.md`;
  const txtFileName = `blue-team-report-${tsStr}.txt`;
  const reportsDir = path.join(__dirname, '../reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  generateMarkdownReport(allResults, totalElapsed, timestamp, reportsDir, mdFileName);
  generateTextReport(allResults, totalElapsed, timestamp, reportsDir, txtFileName);

  console.log(`\n📄 Markdown 报告: ./reports/${mdFileName}`);
  console.log(`📄 文本报告:      ./reports/${txtFileName}`);
  console.log('============================================');

  const failed = MODULES.length - passCount;
  if (failed > 0) process.exit(1);
}

// ─── Markdown 报告生成 ─────────────────────────────────────────────
function generateMarkdownReport(allResults, totalElapsed, timestamp, dir, fileName) {
  let md = `# 智能停车风控系统 — 蓝队功能验收测试报告\n\n`;
  md += `**生成时间:** ${timestamp.toLocaleString()}\n\n`;
  md += `---\n\n`;

  // 概览表
  md += `## 📊 综合统计\n\n`;
  const totalCases = allResults.reduce((s, r) => s + (r.total || 0), 0);
  const totalPassed = allResults.reduce((s, r) => s + (r.passed || 0), 0);
  const totalFailed = allResults.reduce((s, r) => s + (r.failed || 0), 0);
  const totalPassRate = totalCases > 0 ? ((totalPassed / totalCases) * 100).toFixed(1) : '0.0';

  md += `| 指标 | 数值 |\n|------|------|\n`;
  md += `| 总模块数 | ${allResults.length} |\n`;
  md += `| 总用例数 | ${totalCases} |\n`;
  md += `| 通过用例 | ${totalPassed} ✅ |\n`;
  md += `| 失败用例 | ${totalFailed} ❌ |\n`;
  md += `| 总通过率 | ${totalPassRate}% |\n`;
  md += `| 总耗时 | ${totalElapsed}s |\n\n`;

  // 模块概览表
  md += `## 📋 模块概览\n\n`;
  md += `| 模块 | 通过数 | 失败数 | 通过率 | 耗时 | 结果 |\n`;
  md += `|------|--------|--------|--------|------|------|\n`;
  for (const r of allResults) {
    const icon = r.failed === 0 && !r.error ? '✅ 通过' : '❌ 失败';
    md += `| ${r.name} | ${r.passed || 0} | ${r.failed || 0} | ${r.passRate || '0.0'}% | ${r.elapsed || '-'}s | ${icon} |\n`;
  }
  md += `\n`;

  // 各模块详细结果
  for (const r of allResults) {
    md += `---\n\n## ${r.name}\n\n`;
    md += `| 指标 | 数值 |\n|------|------|\n`;
    md += `| 总用例数 | ${r.total || 0} |\n`;
    md += `| 通过 | ${r.passed || 0} ✅ |\n`;
    md += `| 失败 | ${r.failed || 0} ❌ |\n`;
    md += `| 通过率 | ${r.passRate || '0.0'}% |\n`;
    if (r.elapsed) md += `| 耗时 | ${r.elapsed}s |\n`;
    if (r.warnings !== undefined) md += `| 警告 | ${r.warnings} |\n`;

    if (r.error) {
      md += `\n### ⚠️ 模块异常\n\n`;
      md += `\`\`\`\n${r.error}\n\`\`\`\n`;
    }

    if (r.failures && r.failures.length > 0) {
      md += `\n### ❌ 失败用例详情\n\n`;
      for (let i = 0; i < r.failures.length; i++) {
        const f = r.failures[i];
        md += `${i + 1}. **${f.name}**`;
        if (f.detail) md += ` — ${f.detail}`;
        if (f.fixHint) md += `\n   - 修复建议: ${f.fixHint}`;
        md += `\n`;
      }
      md += `\n`;
    } else if (r.failed === 0 && !r.error) {
      md += `\n✅ 本模块全部用例通过。\n\n`;
    }
  }

  fs.writeFileSync(path.join(dir, fileName), md, 'utf8');
  return md;
}

// ─── Text 报告生成 ─────────────────────────────────────────────────
function generateTextReport(allResults, totalElapsed, timestamp, dir, fileName) {
  let txt = `智能停车风控系统 — 蓝队功能验收测试报告\n`;
  txt += `生成时间: ${timestamp.toLocaleString()}\n`;
  txt += `${'='.repeat(60)}\n\n`;

  const totalCases = allResults.reduce((s, r) => s + (r.total || 0), 0);
  const totalPassed = allResults.reduce((s, r) => s + (r.passed || 0), 0);
  const totalFailed = allResults.reduce((s, r) => s + (r.failed || 0), 0);

  txt += `综合统计:\n${'─'.repeat(50)}\n`;
  txt += `  总模块: ${allResults.length}  |  总用例: ${totalCases}\n`;
  txt += `  通过: ${totalPassed}  |  失败: ${totalFailed}  |  耗时: ${totalElapsed}s\n\n`;

  for (const r of allResults) {
    const icon = r.failed === 0 && !r.error ? '✅' : '❌';
    txt += `${icon} ${r.name}\n${'─'.repeat(50)}\n`;
    txt += `  总用例: ${r.total || 0}  |  通过: ${r.passed || 0}  |  失败: ${r.failed || 0}  |  通过率: ${r.passRate || '0.0'}%\n`;
    if (r.elapsed) txt += `  耗时: ${r.elapsed}s\n`;
    if (r.error) txt += `  异常: ${r.error}\n`;

    if (r.failures && r.failures.length > 0) {
      txt += `  失败详情:\n`;
      r.failures.forEach((f, i) => {
        txt += `    ${i + 1}. ${f.name}`;
        if (f.detail) txt += ` — ${f.detail}`;
        if (f.fixHint) txt += ` [修复: ${f.fixHint}]`;
        txt += `\n`;
      });
    }
    txt += `\n`;
  }

  fs.writeFileSync(path.join(dir, fileName), txt, 'utf8');
  return txt;
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(2); });
