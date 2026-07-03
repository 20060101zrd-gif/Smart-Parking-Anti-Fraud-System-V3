// tests/red-team/03-blacklist-bloat.js
const axios = require('axios');

// 1. 定义一个简单的 sleep 辅助函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async () => {
  console.log('>>> 正在执行: 黑名单膨胀压测 (注入 100 条归档记录)');
  let normal = 0, error = 0;

  for (let i = 0; i < 100; i++) {
    try {
      await axios.post('http://localhost:3000/api/v1/user/cancel', { 
        phone: `1380000${1000 + i}` 
      });
      normal++;
      
      // 2. 在每次请求后暂停 200 毫秒
      // 这样每秒最多 5 次请求，不会触发后端每秒 10 次的限流防御
      await sleep(200); 

    } catch(e) { 
      console.log(`[Error] 记录注入失败 (可能是因为被限流): ${e.message}`);
      error++; 
    }
  }
  return { stats: { normal, blocked: 0, limited: 0, error } };
};
