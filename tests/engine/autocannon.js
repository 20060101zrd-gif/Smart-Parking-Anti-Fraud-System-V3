// tests/engine/autocannon.js
const autocannon = require('autocannon');

const runEngine = (opts) => {
  return new Promise((resolve, reject) => {
    const { url, ...otherOpts } = opts;
    
    // 1. 定义统计变量
    const stats = { normal: 0, limited: 0, blocked: 0, error: 0 };
    
    // 2. 实例化并启动压测
    const instance = autocannon({
      url,
      ...otherOpts
    }, (err, result) => {
      if (err) return reject(err);
      
      // 🚀 核心修复：把自定义的 stats 挂载到 result 上，直接 resolve(result)
      // 这样 run-all.js 就能顺畅无阻地读取 result.requests 等自带属性了！
      result.customStats = stats;
      resolve(result); 
    });

    // 3. 监听响应，实时分类
    instance.on('response', (client, statusCode) => {
      if (statusCode === 200) stats.normal++;
      else if (statusCode === 429) stats.limited++;
      else if (statusCode === 403) stats.blocked++;
      else stats.error++;
    });

    // 4. 异常捕获
    instance.on('error', (err) => {
      console.error('\n[Engine Error] 连接异常:', err.message);
    });

    // 🚀 5. 加上超酷的控制台进度条，实时感受并发轰炸的快感！
    autocannon.track(instance, {
      renderProgressBar: true,
      renderLatencyTable: false, // 让外面的 run-all.js 统一打印报表
      renderResultsTable: false
    });
  });
};

module.exports = runEngine;
