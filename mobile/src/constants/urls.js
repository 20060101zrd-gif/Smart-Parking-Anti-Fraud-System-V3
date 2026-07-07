import { Platform, NativeModules } from 'react-native';

/** 从所有可用来源提取第一个非 localhost 的 IP */
function extractHost() {
  if (!__DEV__) return null;
  const expo = NativeModules.ExponentConstants;

  // WiFi LAN 模式下，这些来源会返回真实 IP
  const sources = [
    NativeModules.SourceCode?.scriptURL,
    expo?.manifest?.hostUri,
    expo?.manifest?.debuggerHost,
    expo?.manifest?.bundleUrl,
    expo?.manifest2?.extra?.expoGo?.debuggerHost,
  ];
  for (const src of sources) {
    if (!src) continue;
    const m = String(src).match(/^https?:\/\/([^:/]+)/);
    if (m && m[1] !== 'localhost' && m[1] !== '127.0.0.1') return m[1];
  }

  // USB 模式 → 全返回 localhost，无法自动检测
  return null;
}

function getBaseUrl() {
  if (!__DEV__) return 'https://parking-guard-v3.abrdns.com/api/v1';

  // 1. 自动检测 LAN IP（WiFi 模式生效）
  const host = extractHost();
  if (host) return `http://${host}:3000/api/v1`;

  // 2. 手动配置（WiFi IP 变了改这里 / app.json 的 devApiHost）
  const manifestExtra = NativeModules.ExponentConstants?.manifest?.extra;
  const devHost = manifestExtra?.devApiHost || '192.168.16.76';
  if (devHost) return `http://${devHost}:3000/api/v1`;

  // 3. 模拟器 fallback
  if (Platform.OS === 'android') return 'http://10.0.2.2:3000/api/v1';
  return 'http://127.0.0.1:3000/api/v1';
}

export const BASE_URL = getBaseUrl();