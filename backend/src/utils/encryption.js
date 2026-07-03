// backend/src/utils/encryption.js
const crypto = require('crypto');
const env = require('../config/env');

/**
 * AES-256-CBC 对称加解密工具
 * 用于手机号等敏感字段的加密存储，加密后以 hex 字符串持久化
 *
 * 密钥派生：
 *   ENCRYPT_KEY 环境变量 → SHA256 哈希 → 32 字节密钥（确保固定长度）
 *   支持任意长度原文，工具内部自动补齐到 32 字节
 *
 * IV：
 *   每次加密生成随机 16 字节 IV，与密文拼接存储（格式：iv_hex:cipher_hex）
 */
class EncryptionUtil {
  constructor() {
    const rawKey = env.ENCRYPT_KEY || 'change-me-to-a-secure-random-key-32chars';
    this.algorithm = 'aes-256-cbc';
    // 将任意长度的 ENCRYPT_KEY 哈希为固定 32 字节
    this.secretKey = crypto.createHash('sha256').update(rawKey).digest();
  }

  /**
   * 加密明文手机号
   * @param {String} plainText 明文
   * @returns {String} iv:ciphertext 格式的 hex 字符串
   */
  encrypt(plainText) {
    if (!plainText) {
      throw new Error('[Encryption] encrypt() 入参不能为空');
    }
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(this.algorithm, this.secretKey, iv);
      let encrypted = cipher.update(plainText, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      // 格式：iv:密文，方便解密时提取 IV
      return `${iv.toString('hex')}:${encrypted}`;
    } catch (err) {
      console.error('[Encryption] 加密失败:', err.message);
      throw new Error('手机号加密处理异常');
    }
  }

  /**
   * 解密密文，还原手机号
   * @param {String} encryptedText iv:ciphertext 格式的 hex 字符串
   * @returns {String} 明文手机号
   */
  decrypt(encryptedText) {
    if (!encryptedText) {
      throw new Error('[Encryption] decrypt() 入参不能为空');
    }
    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 2) {
        throw new Error('密文格式异常，期望 iv:cipher');
      }
      const [ivHex, cipherHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv(this.algorithm, this.secretKey, iv);
      let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      console.error('[Encryption] 解密失败:', err.message);
      throw new Error('手机号解密处理异常');
    }
  }

  /**
   * 生成手机号的加盐 SHA256 哈希（用于黑名单匹配、查重索引）
   * 盐值从环境变量 PHONE_HASH_SALT 读取，默认使用内置安全盐
   * @param {String} plainText 手机号明文
   * @returns {String} 64位hex哈希值
   */
  hashPhone(plainText) {
    if (!plainText) throw new Error('[Encryption] hashPhone() 入参不能为空');
    const salt = process.env.PHONE_HASH_SALT || 'parking-fraud-phone-salt-2026-secure-v1';
    return crypto.createHash('sha256').update(salt + plainText + salt).digest('hex');
  }
}

module.exports = new EncryptionUtil();
