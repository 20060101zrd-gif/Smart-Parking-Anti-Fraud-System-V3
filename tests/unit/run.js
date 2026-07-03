// tests/unit/run.js
// ================================================================
// 🧪 Unit Tests — Jest 单元测试运行器（含报告生成）
// 运行: node tests/unit/run.js
// ================================================================
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 确保 reports 目录存在
const reportsDir = path.join(__dirname, '../reports');
if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

const timestamp = new Date();
const tsStr = timestamp.toISOString().replace(/[-:]/g, '').replace('T', '-').substring(0, 15);

console.log('\n╔══════════════════════════════════════════╗');
console.log('║  🧪 Unit Tests — Jest 单元测试套件      ║');
console.log('╚══════════════════════════════════════════╝\n');
console.log(`Time: ${timestamp.toISOString()}\n`);

const startTime = Date.now();
let jsonOutput = '';
let exitCode = 0;

try {
  jsonOutput = execSync(
    `npx jest --config="${path.join(__dirname, '../../backend', 'jest.config.js')}" --json --verbose`,
    { encoding: 'utf8', cwd: path.join(__dirname, '../../backend'), stdio: ['pipe', 'pipe', 'pipe'] }
  );
} catch (e) {
  exitCode = 1;
  jsonOutput = e.stdout || '';
}

let jestResult;
try {
  // 从 mixed output 中提取 JSON（Jest 可能在 JSON 前后输出其他内容）
  const jsonStart = jsonOutput.indexOf('{');
  if (jsonStart >= 0) {
    // 找到最后一个 '}' 确保完整 JSON
    const jsonEnd = jsonOutput.lastIndexOf('}');
    jestResult = JSON.parse(jsonOutput.substring(jsonStart, jsonEnd + 1));
  }
} catch (e) {
  console.error('⚠️  JSON 解析失败，回退到纯文本报告');
  jestResult = null;
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

// ── 终端输出 ──────────────────────────────────────────────────────
if (jestResult) {
  console.log('============================================');
  console.log('📊 Unit Tests 汇总');
  console.log('============================================');
  console.log(`  Suites:  ${jestResult.numPassedTestSuites}/${jestResult.numTotalTestSuites} passed`);
  console.log(`  Tests:   ${jestResult.numPassedTests}/${jestResult.numTotalTests} passed`);
  console.log(`  Failed:  ${jestResult.numFailedTests}`);
  console.log(`  Time:    ${elapsed}s`);
  console.log(`  Exit:    ${jestResult.success ? '✅ SUCCESS' : '❌ FAILURE'}\n`);

  if (jestResult.numFailedTests > 0 && jestResult.testResults) {
    console.log('─── 失败详情 ───');
    for (const suite of jestResult.testResults) {
      for (const test of (suite.assertionResults || [])) {
        if (test.status === 'failed') {
          console.log(`  ❌ ${test.fullName}`);
          if (test.failureMessages) {
            test.failureMessages.forEach(m => {
              // 只显示第一行有意义的信息
              const lines = m.split('\n').filter(l => l.trim());
              const key = lines.slice(0, 3).join('\n     ');
              console.log(`     ${key}`);
            });
          }
        }
      }
    }
  }
}

// ── 收集模块结果 ───────────────────────────────────────────────────
const modules = [];
if (jestResult && jestResult.testResults) {
  for (const suite of jestResult.testResults) {
    const results = (suite.assertionResults || []);
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const failures = results
      .filter(r => r.status === 'failed')
      .map(r => ({
        name: r.fullName || r.title,
        detail: (r.failureMessages || []).join(' | ').substring(0, 200),
      }));
    modules.push({
      name: path.basename(suite.name, '.test.js').replace(/-/g, ' '),
      file: path.basename(suite.name),
      total: passed + failed,
      passed,
      failed,
      passRate: (passed + failed) > 0 ? ((passed / (passed + failed)) * 100).toFixed(1) : '0.0',
      failures,
    });
  }
}

// ── 生成 Markdown 报告 ────────────────────────────────────────────
const mdFileName = `unit-test-report-${tsStr}.md`;
let md = `# 智能停车风控系统 — 单元测试报告\n\n`;
md += `**生成时间:** ${timestamp.toLocaleString()}\n\n`;
md += `---\n\n`;

md += `## 📊 综合统计\n\n`;
const totalTests = jestResult ? jestResult.numTotalTests : 0;
const passedTests = jestResult ? jestResult.numPassedTests : 0;
const failedTests = jestResult ? jestResult.numFailedTests : 0;
const passRate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : '0.0';

md += `| 指标 | 数值 |\n|------|------|\n`;
md += `| 总测试套件 | ${jestResult ? jestResult.numTotalTestSuites : '-'} |\n`;
md += `| 总用例数 | ${totalTests} |\n`;
md += `| 通过 | ${passedTests} ✅ |\n`;
md += `| 失败 | ${failedTests} ❌ |\n`;
md += `| 通过率 | ${passRate}% |\n`;
md += `| 耗时 | ${elapsed}s |\n`;
md += `| 结果 | ${jestResult && jestResult.success ? '✅ 全部通过' : '❌ 存在失败'} |\n\n`;

if (modules.length > 0) {
  md += `## 📋 用例概览\n\n`;
  md += `| 测试套件 | 通过 | 失败 | 通过率 | 结果 |\n`;
  md += `|----------|------|------|--------|------|\n`;
  for (const m of modules) {
    const icon = m.failed === 0 ? '✅' : '❌';
    md += `| ${m.name} | ${m.passed} | ${m.failed} | ${m.passRate}% | ${icon} |\n`;
  }
  md += `\n`;

  // 失败详情
  for (const m of modules) {
    if (m.failed > 0) {
      md += `### ❌ ${m.name} — 失败用例\n\n`;
      for (let i = 0; i < m.failures.length; i++) {
        const f = m.failures[i];
        md += `${i + 1}. **${f.name}**\n`;
        if (f.detail) md += `   \`\`\`\n   ${f.detail}\n   \`\`\`\n`;
        md += `\n`;
      }
    }
  }
}

md += `---\n\n`;
md += `## 📁 测试文件\n\n`;
for (const m of modules) {
  md += `- **${m.name}** — \`tests/unit/${m.file}\` (${m.passed}/${m.total})\n`;
}

md += `\n*由 Jest 单元测试套件自动生成*\n`;

const mdPath = path.join(reportsDir, mdFileName);
fs.writeFileSync(mdPath, md, 'utf8');

// ── 生成 Text 报告 ────────────────────────────────────────────────
const txtFileName = `unit-test-report-${tsStr}.txt`;
let txt = `智能停车风控系统 — 单元测试报告\n`;
txt += `生成时间: ${timestamp.toLocaleString()}\n`;
txt += `${'='.repeat(60)}\n\n`;

txt += `综合统计:\n${'─'.repeat(50)}\n`;
txt += `  总套件: ${jestResult ? jestResult.numTotalTestSuites : '-'}  |  总用例: ${totalTests}\n`;
txt += `  通过: ${passedTests}  |  失败: ${failedTests}  |  通过率: ${passRate}%\n`;
txt += `  耗时: ${elapsed}s  |  结果: ${jestResult && jestResult.success ? '✅ SUCCESS' : '❌ FAILURE'}\n\n`;

for (const m of modules) {
  const icon = m.failed === 0 ? '✅' : '❌';
  txt += `${icon} ${m.name}\n${'─'.repeat(50)}\n`;
  txt += `  通过: ${m.passed}/${m.total} (${m.passRate}%)\n`;
  if (m.failures.length > 0) {
    txt += `  失败:\n`;
    m.failures.forEach((f, i) => {
      txt += `    ${i + 1}. ${f.name}\n`;
      if (f.detail) txt += `       ${f.detail}\n`;
    });
  }
  txt += `\n`;
}

const txtPath = path.join(reportsDir, txtFileName);
fs.writeFileSync(txtPath, txt, 'utf8');

console.log(`\n📄 Markdown 报告: ./reports/${mdFileName}`);
console.log(`📄 文本报告:      ./reports/${txtFileName}`);

process.exit(exitCode);
