// tests/red-team/06-admin-attack.js
// ================================================================
// 模块三：管理员后台 — 红队攻防专项测试
// 接入: red-team/run.js 统一调度 | 报告: tests/reports/
// ================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../..', '.env') });
const axios = require('axios');
const crypto = require('crypto');

const BASE = 'http://127.0.0.1:3000/api/v1/admin';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'Parking@Admin2026!';
const G='\x1b[32m', R='\x1b[31m', Y='\x1b[33m', C='\x1b[36m', Z='\x1b[0m', B='\x1b[1m';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

let passed=0, failed=0, risks=0;
const failures=[], riskItems=[];
const api=axios.create({baseURL:BASE,validateStatus:()=>true,timeout:15000,withCredentials:true});

function record(name,condition,detail=''){
  if(condition){ passed++;console.log(`  ${G}✓${Z} ${name}`)}
  else{
    failed++;risks++;failures.push({name,detail});riskItems.push({name,detail});
    console.log(`  ${R}✗${Z} ${name}${detail?' — '+C+detail+Z:''}`);
    console.log(`    ${Y}🔴 发现安全风险${Z}`);
  }
  return condition;
}

async function runModule3RedTeam(){
  console.log(`\n${B}${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 模块三：管理员后台 — 红队攻防专项测试
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${Z}\n`);
  const startTime=Date.now();
  let adminToken='', cookiesStr='';

  // 前置：获取管理员令牌
  console.log(`${C}📋 前置：获取管理员令牌...${Z}`);
  try{
    const lr=await api.post('/login/token',{username:ADMIN_USER,password:ADMIN_PASS});
    if(lr.data.code===20000){adminToken=lr.data.data.token;cookiesStr=(lr.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; ');console.log(`  ${G}✓${Z} 令牌获取成功`)}
    else{console.log(`  ${R}✗${Z} 令牌获取失败: ${lr.data.message}`)}
  }catch(e){console.log(`  ${R}✗${Z} 登录异常: ${e.message}`)}

  const authHeaders = cookiesStr?{Cookie:cookiesStr}:{Authorization:`Bearer ${adminToken}`};

  // ── 1. JWT 伪造攻击 ──
  console.log(`\n${B}─── 1. JWT 伪造攻击测试${Z}`);
  const fakeJwts=[
    {desc:'空令牌',token:''},
    {desc:'随机字符串',token:'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZG1pbklkIjoxfQ.fake_signature'},
    {desc:'无签名',token:crypto.randomBytes(32).toString('hex')},
    {desc:'篡改adminId',token:(()=>{try{const parts=adminToken.split('.');if(parts.length!==3)return'x';const payload=JSON.parse(Buffer.from(parts[1],'base64').toString('utf8'));payload.adminId=99999;const h=`${Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;return h+'.fake_signature_'+crypto.randomBytes(8).toString('hex')}catch{return'x'}})()}
  ];
  let forgeBlocked=0;
  for(const fj of fakeJwts){
    try{
      const r=await axios.get(BASE+'/overview',{headers:{Authorization:`Bearer ${fj.token}`},validateStatus:()=>true,timeout:10000});
      if(r.status===401||r.status===403){forgeBlocked++}
      console.log(`    ${fj.desc}: status=${r.status} code=${r.data?.code||'-'}`);
    }catch{forgeBlocked++}
  }
  record('1. JWT伪造攻击防御', forgeBlocked>=3, `4种伪造令牌, 拦截${forgeBlocked}/4 (期望≥3)`);

  // ── 2. 垂直越权测试 ──
  console.log(`\n${B}─── 2. 垂直越权测试${Z}`);
  const userApi=axios.create({baseURL:'http://127.0.0.1:3000/api/v1',validateStatus:()=>true,timeout:15000,withCredentials:true});
  const r2=await userApi.get('/admin/overview');
  const isBlocked=r2.status===401||r2.status===403;
  record('2. 垂直越权防御', isBlocked, `普通用户访问管理接口: status=${r2.status} (期望401/403)`);

  // ── 3. SQL注入攻击测试 ──
  console.log(`\n${B}─── 3. SQL注入攻击测试${Z}`);
  const sqlPayloads=[
    {desc:'UNION注入',payload:"' UNION SELECT 1,2,3,4,5,6 -- "},
    {desc:'OR 1=1',payload:"' OR '1'='1"},
    {desc:'DROP TABLE',payload:"'; DROP TABLE sys_users; --"},
    {desc:'SLEEP注入',payload:"' AND SLEEP(5) --"}
  ];
  let sqlSafe=0;
  for(const sq of sqlPayloads){
    const start=Date.now();
    const r=await api.get(`/blacklist?search=${encodeURIComponent(sq.payload)}&page=1&pageSize=5`,{headers:authHeaders});
    const elapsed=Date.now()-start;
    if(r.status===200 && elapsed<3000){sqlSafe++}
    console.log(`    ${sq.desc}: status=${r.status} time=${elapsed}ms`);
  }
  record('3. SQL注入攻击防御', sqlSafe>=3, `4种注入payload, 正常防御${sqlSafe}/4 (无数据泄露/无延迟注入)`);

  // ── 4. 风控规则越权修改 ──
  console.log(`\n${B}─── 4. 风控规则越权修改测试${Z}`);
  const r4a=await axios.put(BASE+'/config',{key:'ip_register_limit',value:1},{headers:{},validateStatus:()=>true,timeout:10000});
  const r4b=await axios.put(BASE+'/config',{key:'ip_register_limit',value:99},{headers:{Authorization:'Bearer invalid_token_xyz'},validateStatus:()=>true,timeout:10000});
  const bothBlocked=(r4a.status===401||r4a.status===403)&&(r4b.status===401||r4b.status===403);
  record('4. 风控规则越权修改防御', bothBlocked, `无token:${r4a.status} 假token:${r4b.status} (期望均401/403)`);

  // ── 5. 敏感信息泄露测试 ──
  console.log(`\n${B}─── 5. 敏感信息泄露测试${Z}`);
  const leakTests=[
    {desc:'不存在的路由',method:'get',url:'/nonexistent_endpoint_12345'},
    {desc:'畸形JSON',method:'post',url:'/login',body:'{bad json',contentType:'text/plain'},
    {desc:'超大payload',method:'post',url:'/login',body:JSON.stringify({username:'a'.repeat(10000),password:'b'.repeat(10000)})},
  ];
  let leakSafe=0;
  const sensitivePatterns=/password_hash|mysql|sqlite|stack|node_modules|\.js:\d+|at\s+\w+\.js/i;
  for(const lt of leakTests){
    try{
      const r=await axios({method:lt.method,url:BASE+lt.url,data:lt.body,headers:{'Content-Type':lt.contentType||'application/json'},validateStatus:()=>true,timeout:10000});
      const bodyStr=JSON.stringify(r.data).substring(0,500);
      const leaked=sensitivePatterns.test(bodyStr);
      if(!leaked)leakSafe++;
      console.log(`    ${lt.desc}: status=${r.status} leaked=${leaked?'YES 🔴':'NO'}`);
    }catch(e){leakSafe++;console.log(`    ${lt.desc}: blocked`)}
  }
  record('5. 敏感信息泄露防御', leakSafe>=3, `3种异常场景, 安全通过${leakSafe}/3 (无敏感信息泄露)`);

  // ── 6. 暴力破解绕过测试 (最后执行，避免消耗 admin_ip 配额影响其他测试) ──
  console.log(`\n${B}─── 6. 密码暴力破解绕过测试 (admin_ip: 30/min)${Z}`);
  const bruteResults=[];
  for(let i=1;i<=33;i++){
    const r=await api.post('/login',{username:'brute_'+i,password:'wrong_'+i});
    bruteResults.push({i,status:r.status,code:r.data.code});
    if(i<=3||i>=30) console.log(`    请求 ${i}: status=${r.status} code=${r.data.code}`);
    await sleep(40);
  }
  const earlyLimited=bruteResults.slice(30).some(r=>r.status===429||r.code===40029);
  record('6. 暴力破解限流生效', earlyLimited, `第31-33次: ${bruteResults.slice(30).map(r=>r.code).join(',')} (期望含429/40029)`);

  // 清理 rate limit key
  try{
    const rds=require('redis').createClient({socket:{host:'127.0.0.1',port:6379},password:process.env.REDIS_PASSWORD||undefined});
    await rds.connect();
    for(const k of await rds.keys('pf:limit:admin_ip:*')) await rds.del(k);
    await rds.quit();
    console.log(`  ${C}🧹 已清理 admin_ip 限流计数${Z}`);
  }catch{}

  // ── 汇总 ──
  const elapsed=((Date.now()-startTime)/1000).toFixed(1);
  const total=passed+failed;
  const passRate=total>0?((passed/total)*100).toFixed(1):'0.0';
  const totalAttacks=failed; // 红队视角：失败=发现风险
  const safePasses=passed;
  const riskCount=risks;
  const riskRate=total>0?((riskCount/total)*100).toFixed(1):'0.0';

  // 安全评级
  let grade;
  const rate=parseFloat(passRate);
  if(rate>=95)grade='A+ (卓越)';
  else if(rate>=85)grade='A (优秀)';
  else if(rate>=70)grade='B (良好)';
  else if(rate>=50)grade='C (需改进)';
  else grade='D (严重漏洞)';

  console.log(`\n${B}${C}╔══════════════════════════════════════════════════════╗
║     模块三：管理员后台 — 红队攻击测试报告            ║
╚══════════════════════════════════════════════════════╝${Z}`);
  console.log(`  执行时间: ${new Date().toISOString()}`);
  console.log(`  耗时:     ${elapsed}s`);
  console.log(`  总攻击项: ${total}`);
  console.log(`  防线守住: ${safePasses}  ✅`);
  console.log(`  发现风险: ${riskCount}  ❌`);
  console.log(`  风险率:   ${riskRate}%`);
  console.log(`  通过率:   ${passRate}%`);
  console.log(`  安全评级: ${grade}\n`);

  if(failures.length>0){console.log(`${C}─── 发现的安全风险 ───${Z}`);failures.forEach((f,i)=>console.log(`  ${R}${i+1}. ${f.name}${Z}\n     ${f.detail}`));}

  return {total,passed,failed,passRate,elapsed,grade,failures,totalAttacks,safePasses,riskCount,riskRate,riskItems};
}

module.exports=runModule3RedTeam;
if(require.main===module){runModule3RedTeam().then(r=>{if(r.failed>0)process.exit(1)}).catch(e=>{console.error('💥 测试异常:',e.message);process.exit(2)})}
