// tests/src/scenarios/02-jwt-forge.js
const axios = require('axios');

module.exports = async () => {
  console.log('>>> 正在执行: JWT 专项伪造攻击');
  const results = { normal: 0, blocked: 0, error: 0 };
  
  const testCases = [
    { name: '空签名攻击', token: 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJhZG1pbklkIjoxfQ.' },
    { name: '篡改Payload', token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJpbGxlZ2FsIn0.fake' }
  ];

  for (const tc of testCases) {
    try {
      await axios.get('http://localhost:3000/api/v1/admin/dashboard', {
        headers: { Cookie: `admin_token=${tc.token}` }
      });
      results.error++; // 若成功访问则为严重漏洞
    } catch (e) {
      if (e.response && e.response.status === 401) results.blocked++;
      else results.error++;
    }
  }
  return { stats: results };
};