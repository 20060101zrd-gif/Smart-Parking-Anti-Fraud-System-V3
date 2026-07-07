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
  // 强制使用生产服务器（生成 QR 码给别人扫）
  return 'https://parking-guard-v3.abrdns.com/api/v1';
}

export const BASE_URL = getBaseUrl();