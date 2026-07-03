/**
 * 加解密工具单元测试
 * 覆盖：AES 加解密往返、SHA256 哈希一致性、边界情况
 */
const encryption = require('../../backend/src/utils/encryption');

describe('EncryptionUtil', () => {
  const testPhone = '13800138000';

  // ═══════════════════════════════════════════════
  // 加解密往返测试
  // ═══════════════════════════════════════════════

  describe('encrypt / decrypt 往返', () => {
    it('手机号加密后再解密，应还原为原始明文', () => {
      const cipherText = encryption.encrypt(testPhone);
      const plainText = encryption.decrypt(cipherText);
      expect(plainText).toBe(testPhone);
    });

    it('不同手机号加密后密文应不同', () => {
      const c1 = encryption.encrypt('13800138000');
      const c2 = encryption.encrypt('13900139000');
      expect(c1).not.toBe(c2);
    });

    it('同一手机号两次加密产生的密文应不同（随机 IV）', () => {
      const c1 = encryption.encrypt(testPhone);
      const c2 = encryption.encrypt(testPhone);
      expect(c1).not.toBe(c2);
    });

    it('两次加密的密文各自解密都正确', () => {
      const c1 = encryption.encrypt(testPhone);
      const c2 = encryption.encrypt(testPhone);
      expect(encryption.decrypt(c1)).toBe(testPhone);
      expect(encryption.decrypt(c2)).toBe(testPhone);
    });

    it('密文格式应为 iv:密文（hex:hex）', () => {
      const cipherText = encryption.encrypt(testPhone);
      const parts = cipherText.split(':');
      expect(parts).toHaveLength(2);
      // IV 应为 32 位 hex（16 字节）
      expect(parts[0]).toHaveLength(32);
    });
  });

  describe('encrypt 边界', () => {
    it('空字符串应抛出异常', () => {
      expect(() => encryption.encrypt('')).toThrow();
    });

    it('null/undefined 应抛出异常', () => {
      expect(() => encryption.encrypt(null)).toThrow();
      expect(() => encryption.encrypt(undefined)).toThrow();
    });
  });

  describe('decrypt 边界', () => {
    it('空字符串应抛出异常', () => {
      expect(() => encryption.decrypt('')).toThrow();
    });

    it('格式错误的密文应抛出异常', () => {
      expect(() => encryption.decrypt('not-valid')).toThrow('手机号解密处理异常');
    });

    it('被篡改的密文解密应失败', () => {
      const cipherText = encryption.encrypt(testPhone);
      // 篡改密文部分
      const [iv, ct] = cipherText.split(':');
      const tampered = `${iv}:${ct.slice(0, -2)}ff`;
      expect(() => encryption.decrypt(tampered)).toThrow();
    });
  });

  // ═══════════════════════════════════════════════
  // hashPhone 测试
  // ═══════════════════════════════════════════════

  describe('hashPhone', () => {
    it('同一手机号多次哈希结果应一致', () => {
      const h1 = encryption.hashPhone(testPhone);
      const h2 = encryption.hashPhone(testPhone);
      expect(h1).toBe(h2);
    });

    it('不同手机号哈希结果应不同', () => {
      const h1 = encryption.hashPhone('13800138000');
      const h2 = encryption.hashPhone('13900139000');
      expect(h1).not.toBe(h2);
    });

    it('哈希值应为 64 位 hex 字符串', () => {
      const hash = encryption.hashPhone(testPhone);
      expect(hash).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });

    it('空字符串应抛出异常', () => {
      expect(() => encryption.hashPhone('')).toThrow();
    });
  });
});
