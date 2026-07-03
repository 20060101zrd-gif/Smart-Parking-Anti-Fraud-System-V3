console.log(" 压测脚本已启动！");

const runEngine = require('../engine/autocannon');

// 1. 我们先把这个测试逻辑拿出来，赋给一个变量
const runTest = async () => {
  console.log('>>> 正在执行: 恶意重刷压测 (Target: 500 QPS)');
  
  return await runEngine({
    url: 'http://127.0.0.1:3000/api/v1/user/register',
    method: 'POST',
    connections: 10,
    duration: 10,
    headers: {
      'Content-Type': 'application/json'
    },
    setupClient: (client) => {
      const phone = '13' + Math.floor(Math.random() * 1000000000);
      client.setBody(JSON.stringify({ 
        phone, 
        name: 'AttackBot', 
        deviceId: 'BOT' 
      }));
    }
  });
};

// 2. 依然把它导出，保持你原来的架构不变
module.exports = runTest;

// 3. 💣 【核心修复】加上发射按钮！
// 如果你是直接用 `node 01-brute-force.js` 运行的它，它就会立刻执行
if (require.main === module) {
  runTest()
    .then(() => console.log("✅ 压测执行完毕！"))
    .catch((err) => console.error("❌ 压测发生错误：", err));
}
