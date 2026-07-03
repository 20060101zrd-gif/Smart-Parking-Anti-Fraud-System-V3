// tests/blue-team/05-app-config.js
// ================================================================
// 模块五：停小券 App 标准化配置校验脚本
// 运行: node tests/blue-team/05-app-config.js
// ================================================================

const fs = require('fs');
const path = require('path');

const MOBILE_DIR = path.join(__dirname, '../..', 'mobile');
const G='\x1b[32m', R='\x1b[31m', Y='\x1b[33m', C='\x1b[36m', Z='\x1b[0m', B='\x1b[1m';

let passed = 0, failed = 0, warnings = 0;
const fails = [], warns = [];

function check(name, condition, fixHint = '') {
  if (condition) { passed++; console.log(`  ${G}✓${Z} ${name}`); return true; }
  else { failed++; fails.push({ name, fixHint }); console.log(`  ${R}✗${Z} ${name}\n     ${Y}修复: ${fixHint}${Z}`); return false; }
}
function warn(name, hint) { warnings++; warns.push({ name, hint }); console.log(`  ${Y}⚠${Z} ${name} — ${hint}`); }

async function run() {

// ═══════════════════════════════════════════════
console.log(`\n${B}${C}╔══════════════════════════════════════════════════════╗
║   模块五：停小券 App 配置校验                         ║
╚══════════════════════════════════════════════════════╝${Z}\n`);

// ── 1. 配置文件格式与必填项校验 ──
console.log(`${B}─── 1. app.json 校验${Z}`);

const appJsonPath = path.join(MOBILE_DIR, 'app.json');
let appJson = null;
try {
  const raw = fs.readFileSync(appJsonPath, 'utf-8');
  appJson = JSON.parse(raw);
  check('app.json 为合法 JSON', true);
} catch (e) {
  check('app.json 为合法 JSON', false, `JSON 解析失败: ${e.message}. 请检查语法`);
}
if (appJson) {
  const expo = appJson.expo || {};
  check('displayName = "停小券"', expo.name === '停小券',
    '将 expo.name 设置为 "停小券"');
  check('icon 路径 = "./assets/icon.jpg"', expo.icon === './assets/icon.jpg',
    '将 expo.icon 设置为 "./assets/icon.jpg"');
  check('ios.bundleIdentifier 已设置', !!(expo.ios && expo.ios.bundleIdentifier),
    '设置 expo.ios.bundleIdentifier，格式如 com.parkingfraud.txn');
  check('版本号已设置', !!expo.version,
    '设置 expo.version，如 "1.0.0"');
  check('sdkVersion 已设置', !!expo.sdkVersion,
    '设置 expo.sdkVersion，如 "54.0.0"');
  check('竖屏锁定', expo.orientation === 'portrait',
    '设置 expo.orientation = "portrait"');
  check('scheme 已配置', !!expo.scheme,
    '设置 expo.scheme，如 "parking-fraud"');
  check('启动底图路径已设置', !!(expo.splash && expo.splash.image),
    '设置 expo.splash.image = "./assets/splash.jpg"');
  check('启动底图 resizeMode = "contain"', expo.splash && expo.splash.resizeMode === 'contain',
    '设置 expo.splash.resizeMode = "contain"');
  check('启动页背景色已设置', !!(expo.splash && expo.splash.backgroundColor),
    '设置 expo.splash.backgroundColor，如 "#5B9BD5"');
  check('iOS 显示名 = "停小券"', expo.ios?.infoPlist?.CFBundleDisplayName === '停小券',
    '设置 expo.ios.infoPlist.CFBundleDisplayName = "停小券"');
}

// ── 2. eas.json 校验 ──
console.log(`\n${B}─── 2. eas.json 校验${Z}`);

const easJsonPath = path.join(MOBILE_DIR, 'eas.json');
let easJson = null;
try {
  if (!fs.existsSync(easJsonPath)) {
    check('eas.json 文件存在', false, '创建 mobile/eas.json 文件');
  } else {
    const raw = fs.readFileSync(easJsonPath, 'utf-8');
    easJson = JSON.parse(raw);
    check('eas.json 为合法 JSON', true);
  }
} catch (e) {
  check('eas.json 为合法 JSON', false, `JSON 解析失败: ${e.message}`);
}
if (easJson) {
  const builds = easJson.build || {};
  check('development 环境已配置', !!(builds.development),
    '在 eas.json build 节点下添加 development 配置');
  if (builds.development) {
    check('development → distribution = internal', builds.development.distribution === 'internal',
      '设置 build.development.distribution = "internal"');
    check('development → ios 配置存在', !!builds.development.ios,
      '添加 build.development.ios 节点');
  }
  check('production 环境已配置', !!(builds.production),
    '在 eas.json build 节点下添加 production 配置（可先用空对象占位）');
}

// ── 3. 静态资源存在性校验 ──
console.log(`\n${B}─── 3. 静态资源校验${Z}`);

const assetsDir = path.join(MOBILE_DIR, 'assets');
if (!fs.existsSync(assetsDir)) {
  check('assets/ 目录存在', false, '在 mobile/ 下创建 assets/ 目录');
} else {
  check('assets/ 目录存在', true);
}

const iconPath = path.join(MOBILE_DIR, 'assets', 'icon.jpg');
if (fs.existsSync(iconPath)) {
  const stat = fs.statSync(iconPath);
  check('icon.jpg 存在', true);
  if (stat.size < 1024) warn('icon.jpg 文件可能过小', `文件大小 ${stat.size} bytes，建议使用 1024×1024 的正式图标`);
} else {
  check('icon.jpg 存在', false,
    '将 1024×1024 的图标文件放置到 mobile/assets/icon.jpg');
}

const splashPath = path.join(MOBILE_DIR, 'assets', 'splash.jpg');
if (fs.existsSync(splashPath)) {
  const stat = fs.statSync(splashPath);
  check('splash.jpg 存在', true);
  if (stat.size < 2048) warn('splash.jpg 文件可能过小', `文件大小 ${stat.size} bytes，建议使用 iPhone 全面屏最大尺寸的启动图`);
} else {
  check('splash.jpg 存在', false,
    '将启动底图放置到 mobile/assets/splash.jpg（推荐 iPhone 15 Pro Max 规格：1290×2796）');
}

// ── 4. 依赖与 SafeArea 适配校验 ──
console.log(`\n${B}─── 4. 依赖与适配校验${Z}`);

const pkgPath = path.join(MOBILE_DIR, 'package.json');
let pkg = null;
try {
  pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  check('package.json 为合法 JSON', true);
} catch (e) {
  check('package.json 为合法 JSON', false, `JSON 解析失败: ${e.message}`);
}
if (pkg) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  check('react-native-safe-area-context 已安装', !!deps['react-native-safe-area-context'],
    '运行: npm install react-native-safe-area-context');
  check('react-native-screens 已安装', !!deps['react-native-screens'],
    '运行: npm install react-native-screens');
  check('react-native-gesture-handler 已安装', !!deps['react-native-gesture-handler'],
    '运行: npm install react-native-gesture-handler');
  check('expo-secure-store 已安装', !!deps['expo-secure-store'],
    '运行: npm install expo-secure-store');
  check('expo-status-bar 已安装', !!deps['expo-status-bar'],
    '运行: npm install expo-status-bar');
}

// ── 5. EAS CLI 与构建前置校验 ──
console.log(`\n${B}─── 5. EAS CLI 构建前置校验${Z}`);

const nodeModulesExists = fs.existsSync(path.join(MOBILE_DIR, 'node_modules'));
if (!nodeModulesExists) {
  check('node_modules 已安装', false, '运行: cd mobile && npm install');
} else {
  check('node_modules 已安装', true);
}

const gitignorePath = path.join(MOBILE_DIR, '.gitignore');
if (fs.existsSync(gitignorePath)) {
  check('.gitignore 存在', true);
} else {
  check('.gitignore 存在', false, '创建 mobile/.gitignore 文件');
}

// App.js 存在性
const appJsPath = path.join(MOBILE_DIR, 'App.js');
check('App.js 入口文件存在', fs.existsSync(appJsPath),
  '确保 mobile/App.js 文件存在');

// ── 汇总 ──
const total = passed + failed;
const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';
console.log(`\n${B}${C}╔══════════════════════════════════════════════════════╗
║              校 验 汇 总                               ║
╚══════════════════════════════════════════════════════╝${Z}`);
console.log(`  总校验项:  ${total}`);
console.log(`  ${G}通过:     ${passed}${Z}`);
console.log(`  ${R}失败:     ${failed}${Z}`);
console.log(`  ${Y}警告:     ${warnings}${Z}`);
console.log(`  通过率:    ${passRate}%\n`);

if (fails.length > 0) {
  console.log(`${R}${B}─── 必须修复 (${failed} 项) ───${Z}`);
  fails.forEach((f, i) => {
    console.log(`  ${R}${i + 1}. ${f.name}${Z}`);
    console.log(`     → ${Y}${f.fixHint}${Z}`);
  });
  console.log();
}

if (warns.length > 0) {
  console.log(`${Y}─── 建议优化 (${warnings} 项) ───${Z}`);
  warns.forEach((w, i) => console.log(`  ${Y}${i + 1}. ${w.name}${Z} — ${w.hint}`));
  console.log();
}

console.log(`${C}${B}──────────────────────────────────────────────
开发调试方式（Expo Go，零成本）:
  cd mobile && npx expo start
  iPhone 安装 Expo Go → 扫码 → 即运行
  热更新：改代码保存后手机自动刷新
──────────────────────────────────────────────${Z}\n`);

  return {
    total, passed, failed, passRate,
    warnings: warns.length,
    failures: fails
  };
}

module.exports = run;

if (require.main === module) {
  run().then(r => {
    if (r.failed > 0) process.exit(1);
  }).catch(e => { console.error('💥 校验异常:', e.message); process.exit(2); });
}
