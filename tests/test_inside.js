const http = require('http');
const t0 = Date.now();
const req = http.get('http://127.0.0.1:3000/api/v1/health/ready', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log((Date.now() - t0) + 'ms', res.statusCode, d);
    process.exit(0);
  });
});
req.setTimeout(5000, () => {
  console.log((Date.now() - t0) + 'ms TIMEOUT');
  process.exit(1);
});
req.on('error', e => {
  console.log('ERR:', e.message);
  process.exit(1);
});
