// tests/index.js
// ================================================================
// 智能停车风控系统 — 统一测试入口
// 一键运行红队渗透 + 蓝队验收
//
// 运行: cd tests && node index.js
// 只跑红队: node red-team/run.js
// 只跑蓝队: node blue-team/run.js
// ================================================================
const { execSync } = require('child_process');
const path = require('path');

const suites = [
  { name: '🔴 Red Team  — 渗透攻击模拟', file: 'red-team/run.js' },
  { name: '🔵 Blue Team — 功能防御验收', file: 'blue-team/run.js' },
];

console.log('\n╔══════════════════════════════════════╗');
console.log('║  Parking Fraud System               ║');
console.log('║  Full Test Suite (Red + Blue Team)  ║');
console.log('╚══════════════════════════════════════╝\n');

let exitCode = 0;

for (const s of suites) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`${s.name}`);
  console.log(`${'='.repeat(50)}\n`);
  try {
    execSync(`node "${path.join(__dirname, s.file)}"`, { stdio: 'inherit' });
  } catch (e) {
    console.error(`\n❌ ${s.name} — 执行失败 (exit code: ${e.status})`);
    exitCode = 1;
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(exitCode === 0 ? '🎉 全部测试套件执行完毕！' : '⚠️  部分测试套件执行失败，请查看上方日志');
console.log(`${'='.repeat(50)}\n`);

process.exit(exitCode);
