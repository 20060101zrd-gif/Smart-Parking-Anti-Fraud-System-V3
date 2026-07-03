// tests/blue-team/03-admin.js
// 模块三「管理员后台与风控规则」功能验收测试
// 运行: node tests/blue-team/03-admin.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../..', '.env') });
const axios = require('axios');

const BASE = 'http://127.0.0.1:3000/api/v1/admin';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'Admin@123';

const G='\x1b[32m', R='\x1b[31m', Y='\x1b[33m', C='\x1b[36m', Z='\x1b[0m', B='\x1b[1m';
let passed=0, failed=0; const fails=[];
const api = axios.create({ baseURL: BASE, validateStatus: ()=>true, timeout: 15000, withCredentials: true });

function record(name, ok, detail=''){
  if(ok){ passed++; console.log(`  ${G}✓${Z} ${name}`); }
  else  { failed++; fails.push({name,detail}); console.log(`  ${R}✗${Z} ${name}${detail?' — '+C+detail+Z:''}`); }
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));

let adminToken='', adminCookies=[];

async function run(){
  console.log(`\n${B}${C}╔══════════════════════════════════════════════════════╗
║   模块三：管理员后台功能验收测试                     ║
╚══════════════════════════════════════════════════════╝${Z}\n`);

  // 🆕 前置清理 admin_ip 限流计数（前序模块可能已耗尽 30次/分钟）
  try {
    const { createClient } = require('redis');
    const rds = createClient({
      socket: { host: '127.0.0.1', port: 6379 },
      password: process.env.REDIS_PASSWORD || undefined
    });
    await rds.connect();
    const keys = await rds.keys('pf:limit:admin_ip:*');
    for (const k of keys) await rds.del(k);
    await rds.quit();
    console.log(`  ${C}🧹 已清理 admin_ip 限流计数${Z}\n`);
  } catch {}

  // ── 1. 管理员登录成功 ──
  console.log(`${B}─── 1. 管理员登录成功${Z}`);
  const r1 = await api.post('/login/token', { username: ADMIN_USER, password: ADMIN_PASS });
  const ok1 = r1.data.code===20000 && r1.data.data && typeof r1.data.data.token==='string' && r1.data.data.token.length>20;
  if(ok1){ adminToken=r1.data.data.token; adminCookies=r1.headers['set-cookie']||[]; }
  record('管理员登录成功', ok1, ok1?`token已获取`:`code=${r1.data.code} msg=${r1.data.message}`);

  // ── 2. 管理员登录失败 ──
  console.log(`\n${B}─── 2. 管理员登录失败${Z}`);
  const r2 = await api.post('/login', { username: ADMIN_USER, password: 'WrongPassword_999' });
  record('错误密码登录被拒', r2.data.code!==20000 && (r2.status===400||r2.status===401),
    `code=${r2.data.code} msg=${r2.data.message}`);

  // ── 3. 未授权访问拦截 ──
  console.log(`\n${B}─── 3. 未授权访问拦截${Z}`);
  const r3 = await axios.get(BASE+'/overview',{validateStatus:()=>true,timeout:10000});
  record('不带令牌被401拦截', r3.status===401, `status=${r3.status} (期望401)`);

  // ── 4. 系统概览数据查询 ──
  console.log(`\n${B}─── 4. 系统概览数据查询${Z}`);
  const r4 = await api.get('/overview',{headers:{Cookie:adminCookies.map(c=>c.split(';')[0]).join('; ')}});
  const d4=r4.data.data||{};
  const ovOk=r4.data.code===20000 && d4.todayIntercept!==undefined && d4.totalUsers!==undefined && d4.blacklistCount!==undefined && Array.isArray(d4.trend);
  record('概览数据查询成功', ovOk, ovOk?`拦截=${d4.todayIntercept} 用户=${d4.totalUsers} 黑名单=${d4.blacklistCount} 趋势=${d4.trend.length}天`:`code=${r4.data.code}`);

  // ── 5. 风控规则读取 ──
  console.log(`\n${B}─── 5. 风控规则读取${Z}`);
  const r5=await api.get('/config',{headers:{Cookie:adminCookies.map(c=>c.split(';')[0]).join('; ')}});
  const d5=r5.data.data||{};
  const keys5=['device_register_limit','ip_register_limit','captcha_fail_max','ip_blocklist_ttl_hours'];
  const cfgOk=r5.data.code===20000 && keys5.every(k=>d5[k]!==undefined);
  record('风控规则读取成功', cfgOk, cfgOk?`${keys5.length}项阈值均已返回`:`code=${r5.data.code} keys=${Object.keys(d5).length}`);

  // ── 6. 风控规则修改 ──
  console.log(`\n${B}─── 6. 风控规则修改${Z}`);
  const orig=d5.ip_register_limit;
  const newVal=orig===5?8:5;
  const r6a=await api.put('/config',{key:'ip_register_limit',value:newVal},{headers:{Cookie:adminCookies.map(c=>c.split(';')[0]).join('; ')}});
  const r6b=await api.get('/config',{headers:{Cookie:adminCookies.map(c=>c.split(';')[0]).join('; ')}});
  const updated=r6b.data.data?.ip_register_limit===newVal;
  record('风控规则修改生效', updated, `原值=${orig} → 新值=${newVal} 读回=${r6b.data.data?.ip_register_limit}`);
  await api.put('/config',{key:'ip_register_limit',value:orig},{headers:{Cookie:adminCookies.map(c=>c.split(';')[0]).join('; ')}});

  // ── 7. 拦截日志分页查询 ──
  console.log(`\n${B}─── 7. 拦截日志分页查询${Z}`);
  const r7=await api.get('/intercept-logs?page=1&pageSize=5',{headers:{Cookie:adminCookies.map(c=>c.split(';')[0]).join('; ')}});
  const d7=r7.data.data||{};
  const logOk=r7.data.code===20000 && d7.total!==undefined && d7.page===1 && Array.isArray(d7.list);
  record('拦截日志分页查询', logOk, logOk?`total=${d7.total} page=${d7.page} list=${d7.list.length}`:`code=${r7.data.code}`);

  // ── 8. 黑名单新增 ──
  console.log(`\n${B}─── 8. 黑名单新增${Z}`);
  const testFp='module3-test-fingerprint-'+Date.now();
  const r8a=await api.post('/blacklist/add',{fingerprint:testFp,phone_mask:'13800000000',reason:'自动化测试'},{headers:{Cookie:adminCookies.map(c=>c.split(';')[0]).join('; ')}});
  const r8b=await api.get('/blacklist?page=1&pageSize=50&search='+encodeURIComponent(testFp),{headers:{Cookie:adminCookies.map(c=>c.split(';')[0]).join('; ')}});
  const blAdded=r8a.data.code===20000 && (r8b.data.data?.list||[]).some(b=>b.fingerprint===testFp);
  record('黑名单新增成功', blAdded, blAdded?'条目已添加且可查询':`add=${r8a.data.code} found=${r8b.data.data?.list?.length||0}`);

  // ── 9. 黑名单删除 ──
  console.log(`\n${B}─── 9. 黑名单删除${Z}`);
  const r9a=await api.post('/blacklist/remove',{fingerprint:testFp},{headers:{Cookie:adminCookies.map(c=>c.split(';')[0]).join('; ')}});
  const r9b=await api.get('/blacklist?page=1&pageSize=50&search='+encodeURIComponent(testFp),{headers:{Cookie:adminCookies.map(c=>c.split(';')[0]).join('; ')}});
  const blRemoved=r9a.data.code===20000 && !(r9b.data.data?.list||[]).some(b=>b.fingerprint===testFp);
  record('黑名单删除成功', blRemoved, blRemoved?'条目已移除不可查':`remove=${r9a.data.code} stillFound=${(r9b.data.data?.list||[]).length}`);

  // ── 10. 登录限流验证 (最后执行，避免消耗配额影响其他测试) ──
  console.log(`\n${B}─── 10. 登录限流验证 (admin_ip: 30/min)${Z}`);
  const limResults=[];
  for(let i=1;i<=33;i++){
    const r=await api.post('/login',{username:'testlim_'+i,password:'wrong_'+i});
    limResults.push({i,status:r.status,code:r.data.code});
    if(i<=3||i>=30) console.log(`    请求 ${i}: status=${r.status} code=${r.data.code}`);
    await sleep(40);
  }
  const limited=limResults.slice(30).some(r=>r.status===429||r.code===40029);
  record('登录IP限流触发', limited, `第31-33次: ${limResults.slice(30).map(r=>r.code).join(',')} (期望含429)`);

  // 清理 rate limit key，避免影响后续测试
  try {
    const { createClient } = require('redis');
    const rds = createClient({
      socket: { host: '127.0.0.1', port: 6379 },
      password: process.env.REDIS_PASSWORD || undefined
    });
    await rds.connect();
    const keys = await rds.keys('pf:limit:admin_ip:*');
    for (const k of keys) await rds.del(k);
    await rds.quit();
    console.log(`  ${C}🧹 已清理 admin_ip 限流计数${Z}`);
  } catch {}

  // ── Summary ──
  const total=passed+failed, rate=total>0?((passed/total)*100).toFixed(1):'0.0';
  console.log(`\n${B}${C}╔══════════════════════════════════════════════════════╗
║              验 收 汇 总                               ║
╚══════════════════════════════════════════════════════╝${Z}`);
  console.log(`  Total:  ${total}`);
  console.log(`  ${G}Passed: ${passed}${Z}`);
  console.log(`  ${R}Failed: ${failed}${Z}`);
  console.log(`  Rate:   ${rate}%\n`);
  if(fails.length>0){ console.log(`${C}─── 失败详情 ───${Z}`); fails.forEach((f,i)=>console.log(`  ${R}${i+1}. ${f.name}${Z}\n     ${f.detail}`)); }
  return { total, passed, failed, passRate: rate, failures: fails };
}
module.exports = run;

if (require.main === module) {
  run().then(r => {
    if (r.failed > 0) process.exit(1);
  }).catch(e => { console.error('💥 测试异常:', e.message); process.exit(2); });
}
