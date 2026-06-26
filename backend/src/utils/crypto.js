// backend/src/utils/crypto.js
const argon2 = require('argon2');

class CryptoUtil {
  /**
   * 生成不可逆慢哈希指纹
   * 说明: argon2id 会自动生成高强度随机盐，并将其与配置参数、最终哈希值拼接返回
   * 格式如: $argon2id$v=19$m=16384,t=2,p=1$RandomSalt$HashValue
   * @param {String} plainText 待加密的明文 (如手机号或拼接了 deviceId 的字符串)
   * @returns {Promise<String>} 包含动态盐的哈希字符串
   */
  static async generateHash(plainText) {
    try {
      return await argon2.hash(plainText, {
        type: argon2.argon2id,
        memoryCost: 2 ** 14, // 16MB 内存消耗
        timeCost: 2,         // 迭代 2 次
        parallelism: 1       // 单线程计算
        // 按照此配置，单次哈希耗时将稳定在几十到一百毫秒级别，防暴力破解且不拖垮服务器
      });
    } catch (err) {
      throw new Error(`哈希生成失败: ${err.message}`);
    }
  }

  /**
   * 验证明文与哈希指纹是否一致
   * @param {String} hash 数据库/Redis 中存储的完整哈希字符串
   * @param {String} plainText 用户输入的明文
   * @returns {Promise<Boolean>} 是否匹配
   */
  static async verifyHash(hash, plainText) {
    try {
      return await argon2.verify(hash, plainText);
    } catch (err) {
      return false;
    }
  }

  /**
   * 构造系统统一的用户标识因子
   * @param {String} phone 手机号
   * @param {String} deviceId 设备 ID (可选)
   */
  static buildUserFactor(phone, deviceId = '') {
    return `${phone}|${deviceId}`;
  }
}

module.exports = CryptoUtil;