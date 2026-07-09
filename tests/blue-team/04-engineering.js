// tests/blue-team/04-engineering.js
// 模块四：后端工程化改造 — 功能接口验收测试
// 运行: node tests/blue-team/04-engineering.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../..', '.env') });
const axios = require('axios');

const BASE = 'http://127.0.0.1:3000/api/v1/admin';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'Admin@123';

const G='\x1b[32m', R='\x1b[31m', C='\x1b[36m', Z='\x1b[0m', B='\x1b[1m';
let passed=0, failed=0; const fails=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const api=axios.create({baseURL:BASE,validateStatus:()=>true,timeout:15000,withCredentials:true});

function record(name,ok,detail=''){
  if(ok){passed++;console.log(`  ${G}✓${Z} ${name}`)}
  else{failed++;fails.push({name,detail});console.log(`  ${R}✗${Z} ${name} — ${C}${detail}${Z}`)}
}

async function run(){
  console.log(`\n${B}${C}╔══════════════════════════════════════════════════════╗
║   模块四：后端工程化 — 功能接口验收测试              ║
╚══════════════════════════════════════════════════════╝${Z}\n`);

  // 🆕 清理 admin_ip 限流（Module 3 可能已耗尽 30次/分钟）
  try {
    const { createClient } = require('redis');
    let redisPwd = process.env.REDIS_PASSWORD || '';
    if ((redisPwd.startsWith('"') && redisPwd.endsWith('"')) || (redisPwd.startsWith("'") && redisPwd.endsWith("'"))) {
      redisPwd = redisPwd.slice(1, -1);
    }
    const rds = createClient({ socket: { host: '127.0.0.1', port: 6379 }, password: redisPwd || undefined });
    await rds.connect();
    const keys = await rds.keys('pf:limit:admin_ip:*');
    for (const k of keys) await rds.del(k);
    await rds.quit();
    console.log(`  ${G}✓${Z} 已清理 admin_ip 限流计数\n`);
  } catch { /* 降级跳过 */ }

  let token,cookies;

  // 1. 统一返回格式校验
  console.log(`${B}─── 1. 统一返回格式校验${Z}`);
  const r1=await api.post('/login',{username:ADMIN_USER,password:ADMIN_PASS});
  const fmtOk=r1.data&&typeof r1.data.code==='number'&&r1.data.message!==undefined&&'timestamp' in r1.data;
  record('统一返回格式 {code,message,data,timestamp}',fmtOk,
    `code=${r1.data.code} message=${r1.data.message} hasData=${!!r1.data.data} hasTimestamp=${'timestamp' in r1.data}`);
  if(fmtOk){cookies=(r1.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; ');}
  // Also check fail format
  const r1b=await api.post('/login',{username:ADMIN_USER,password:'wrong'});
  const failFmtOk=r1b.data&&typeof r1b.data.code==='number'&&r1b.data.code!==20000&&'timestamp' in r1b.data;
  record('失败响应格式也统一',failFmtOk,`code=${r1b.data.code} message=${r1b.data.message}`);

  // 2. 管理员登录鉴权
  console.log(`\n${B}─── 2. 管理员登录鉴权${Z}`);
  const r2a=await api.post('/login/token',{username:ADMIN_USER,password:ADMIN_PASS});
  const loginOk=r2a.data.code===20000&&r2a.data.data&&r2a.data.data.token;
  if(loginOk){token=r2a.data.data.token;cookies=(r2a.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; ');}
  record('正确凭证登录成功+返回token',loginOk,loginOk?`adminId=${r2a.data.data.adminId}`:`code=${r2a.data.code}`);
  const r2b=await api.post('/login',{username:ADMIN_USER,password:'WrongPass_999'});
  record('错误密码登录失败',r2b.data.code!==20000,`code=${r2b.data.code}`);

  // 3. 看板统计接口
  console.log(`\n${B}─── 3. 系统概览统计接口${Z}`);
  const r3=await api.get('/overview?range=7',{headers:{Cookie:cookies}});
  const d=r3.data.data||{};
  const ovOk=r3.data.code===20000
    &&d.todayIntercept!==undefined&&d.totalUsers!==undefined&&d.blacklistCount!==undefined
    &&Array.isArray(d.trend)&&d.trend.length===7&&Array.isArray(d.registerTrend);
  record('概览统计字段完整+趋势7天',ovOk,
    `拦截=${d.todayIntercept} 用户=${d.totalUsers} 黑名单=${d.blacklistCount} trend=${d.trend?.length}天`);

  // 4. 黑名单分页查询
  console.log(`\n${B}─── 4. 黑名单分页查询${Z}`);
  const r4=await api.get('/blacklist?page=1&pageSize=5',{headers:{Cookie:cookies}});
  const blOk=r4.data.code===20000&&r4.data.data&&Array.isArray(r4.data.data.list)&&r4.data.data.total!==undefined;
  record('黑名单分页查询',blOk,`total=${r4.data.data?.total} page=${r4.data.data?.page} list=${r4.data.data?.list?.length}`);

  // 5. 拦截日志分页查询
  console.log(`\n${B}─── 5. 拦截日志分页查询${Z}`);
  const r5=await api.get('/intercept-logs?page=1&pageSize=5',{headers:{Cookie:cookies}});
  const logOk=r5.data.code===20000&&r5.data.data&&Array.isArray(r5.data.data.list);
  record('拦截日志分页查询',logOk,`total=${r5.data.data?.total} list=${r5.data.data?.list?.length}`);

  // 6. 风控规则查询
  console.log(`\n${B}─── 6. 风控规则查询${Z}`);
  const r6=await api.get('/config',{headers:{Cookie:cookies}});
  const keys6=['device_register_limit','device_cancel_limit','ip_register_limit','captcha_fail_max','ip_blocklist_ttl_hours'];
  const cfgOk=r6.data.code===20000&&keys6.every(k=>r6.data.data&&r6.data.data[k]!==undefined);
  record('风控规则查询',cfgOk,cfgOk?`${keys6.length}项阈值已返回`:`code=${r6.data.code}`);

  // 7. 未登录访问拦截
  console.log(`\n${B}─── 7. 未登录访问拦截${Z}`);
  const r7=await axios.get(BASE+'/overview',{validateStatus:()=>true,timeout:10000});
  record('未登录被401拦截',r7.status===401,`status=${r7.status} (期望401)`);

  // 8. 无权限访问拦截
  console.log(`\n${B}─── 8. 无权限访问拦截${Z}`);
  const r8a=await axios.put(BASE+'/config',{key:'ip_register_limit',value:5},{validateStatus:()=>true,timeout:10000});
  const r8b=await axios.put(BASE+'/config',{key:'ip_register_limit',value:5},{headers:{Authorization:'Bearer invalid_xyz'},validateStatus:()=>true,timeout:10000});
  record('无令牌/假令牌被拦截',(r8a.status===401||r8a.status===403)&&(r8b.status===401||r8b.status===403),
    `无token:${r8a.status} 假token:${r8b.status}`);

  // Summary
  const total=passed+failed, rate=total>0?((passed/total)*100).toFixed(1):'0.0';
  console.log(`\n${B}${C}╔══════════════════════════════════════════════════════╗
║              验 收 汇 总                               ║
╚══════════════════════════════════════════════════════╝${Z}`);
  console.log(`  Total:  ${total}\n  ${G}Passed: ${passed}${Z}\n  ${R}Failed: ${failed}${Z}\n  Rate:   ${rate}%\n`);
  if(fails.length){console.log(`${C}─── 失败详情 ───${Z}`);fails.forEach((f,i)=>console.log(`  ${R}${i+1}. ${f.name}${Z}\n     ${f.detail}`));}
  return { total, passed, failed, passRate: rate, failures: fails };
}
module.exports = run;

if (require.main === module) {
  run().then(r => {
    if (r.failed > 0) process.exit(1);
  }).catch(e => { console.error('💥 测试异常:', e.message); process.exit(2); });
}
