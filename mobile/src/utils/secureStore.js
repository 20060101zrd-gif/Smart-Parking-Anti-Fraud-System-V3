import * as SecureStore from 'expo-secure-store';

export const storage = {
  // 保存：自动转 JSON 字符串
  setItem: async (key, value) => {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    await SecureStore.setItemAsync(key, stringValue);
  },

  // 读取：自动转回对象
  getItem: async (key) => {
    const value = await SecureStore.getItemAsync(key);
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  },

  // 删除
  removeItem: async (key) => {
    await SecureStore.deleteItemAsync(key);
  }
};