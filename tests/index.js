// tests/index.js
const fs = require('fs');
const path = require('path');
const bruteForce = require('./src/scenarios/01-brute-force');
const jwtForge = require('./src/scenarios/02-jwt-forge');
const bloat = require('./src/scenarios/03-blacklist-bloat');

async function main() {
  const reports = [];
  const scenarios = [
    { name: '恶意重刷', fn: bruteForce },
    { name: 'JWT 突防', fn: jwtForge },
    { name: '黑名单膨胀', fn: bloat }
  ];

  for (const s of scenarios) {
    console.log(`\n=== 开始测试: ${s.name} ===`);
    const result = await s.fn();
    reports.push({ name: s.name, stats: result.stats });
  }

  // 生成报告
  const reportContent = `风控系统攻防报告 ${new Date().toLocaleString()}\n` + 
    JSON.stringify(reports, null, 2);
  
  const reportPath = path.join(__dirname, `reports/report-${Date.now()}.txt`);
  fs.writeFileSync(reportPath, reportContent);
  console.log(`\n🎉 所有测试完成，报告已生成: ${reportPath}`);
}

main();