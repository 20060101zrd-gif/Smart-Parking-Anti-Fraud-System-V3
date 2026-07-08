import { storage } from './secureStore'

/**
 * 设备指纹 — 持久化唯一 ID，用于风控设备黑名单
 *
 * 首次安装/打开 App → 生成随机 UUID → 存入 SecureStore
 * 之后每次启动 → 读取已存储的 UUID
 * 同一台设备永远返回同一个 ID
 */
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

/**
 * 获取设备指纹
 * @returns {Promise<string>}
 */
export const getDeviceId = async () => {
  // 先查是否已存储
  let deviceId = await storage.getItem('device_id')

  if (!deviceId) {
    // 首次 → 生成新 ID 并持久化
    deviceId = generateUUID()
    await storage.setItem('device_id', deviceId)
  }

  return deviceId
}
