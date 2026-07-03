/**
 * 风控服务单元测试
 * 覆盖：正常注册领券、黑名单拦截、白名单放行、注销沉淀、高频注销限流
 */

// ═══════════════════════════════════════════════
// Mock 依赖
// ═══════════════════════════════════════════════

// ── mock db (MySQL client) ──
const mockDb = {
  get: jest.fn().mockResolvedValue(null),
  run: jest.fn().mockResolvedValue({ id: 1, changes: 1 }),
  all: jest.fn().mockResolvedValue([]),
};

jest.mock('../../backend/src/data/mysql.client', () => mockDb, { virtual: true });

// ── mock redis ──
const mockRedis = {
  isReady: true,
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  del: jest.fn().mockResolvedValue(true),
  incr: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(true),
  scanKeys: jest.fn().mockResolvedValue([]),
  ttl: jest.fn().mockResolvedValue(-2),
  client: {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(true),
    sAdd: jest.fn().mockResolvedValue(1),
    sRem: jest.fn().mockResolvedValue(1),
    sMembers: jest.fn().mockResolvedValue([]),
    quit: jest.fn().mockResolvedValue('OK'),
  },
  prefix: 'pf:',
};

jest.mock('../../backend/src/data/redis.client', () => mockRedis, { virtual: true });

// ── mock encryption ──
jest.mock('../../backend/src/utils/encryption', () => ({
  encrypt: jest.fn((phone) => `encrypted:${phone}`),
  decrypt: jest.fn((cipher) => cipher.replace('encrypted:', '')),
  hashPhone: jest.fn((phone) => `sha256-${phone}`),
}), { virtual: true });

// ── mock intercept-log ──
const mockInterceptLog = { logIntercept: jest.fn() };
jest.mock('../../backend/src/services/intercept-log.service', () => mockInterceptLog, { virtual: true });

// ── mock whitelist ──
const mockWhitelist = { isWhitelisted: jest.fn().mockResolvedValue(false) };
jest.mock('../../backend/src/services/whitelist.service', () => mockWhitelist, { virtual: true });

// ── mock crypto ──
jest.mock('../../backend/src/utils/crypto', () => ({
  buildUserFactor: jest.fn((phone) => `factor_${phone}`),
  generateHash: jest.fn().mockResolvedValue('argon2_fingerprint_hash'),
  verifyHash: jest.fn().mockResolvedValue(true),
}), { virtual: true });

// ── mock logger ──
jest.mock('../../backend/src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}), { virtual: true });

// ═══════════════════════════════════════════════
// 测试开始
// ═══════════════════════════════════════════════

const RiskService = require('../../backend/src/services/risk.service');

describe('RiskService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 重置 Redis 状态
    mockRedis.isReady = true;
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue(true);
    mockRedis.del.mockResolvedValue(true);
    mockRedis.incr.mockResolvedValue(1);
    mockDb.get.mockResolvedValue(null);
    mockDb.run.mockResolvedValue({ id: 1, changes: 1 });
    mockWhitelist.isWhitelisted.mockResolvedValue(false);
  });

  // ═══════════════════════════════════════════════
  // 正常注册领券流程
  // ═══════════════════════════════════════════════

  describe('checkAndRegister — 正常流程', () => {
    it('新用户注册应成功领券', async () => {
      const result = await RiskService.checkAndRegister(
        '13800138000', '张三', 'device-001', '1.2.3.4',
      );

      expect(result.hasCoupon).toBe(true);
      expect(result.userId).toBeDefined();
    });

    it('已注册用户再次请求应返回已有券', async () => {
      // 模拟 Redis 中已有注册标记
      mockRedis.get.mockImplementation((key) => {
        if (key === 'user:registered:13800138000') return '1';
        return null;
      });

      const result = await RiskService.checkAndRegister(
        '13800138000', '张三', 'device-001', '1.2.3.4',
      );

      expect(result.hasCoupon).toBe(true);
      expect(result.isExisting).toBe(true);
    });

    it('注册后应将用户写入 MySQL', async () => {
      await RiskService.checkAndRegister(
        '13800138000', '张三', 'device-001', '1.2.3.4',
      );

      // MySQL 用户表写入调用
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sys_users'),
        expect.any(Array),
      );
    });
  });

  // ═══════════════════════════════════════════════
  // 设备指纹黑名单拦截
  // ═══════════════════════════════════════════════

  describe('checkAndRegister — 设备黑名单拦截', () => {
    it('设备在90天黑名单内应被拦截', async () => {
      mockRedis.get.mockImplementation((key) => {
        if (key === 'risk:device_bl:device-001') return '1';
        return null;
      });

      await expect(
        RiskService.checkAndRegister('13800138000', '张三', 'device-001', '1.2.3.4'),
      ).rejects.toMatchObject({
        code: 40301,
        statusCode: 403,
      });

      // 应记录拦截日志
      expect(mockInterceptLog.logIntercept).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.stringContaining('设备指纹'),
        'HIGH',
      );
    });

    it('设备不在黑名单内应正常放行', async () => {
      mockRedis.get.mockResolvedValue(null); // 所有缓存查询返回 null

      const result = await RiskService.checkAndRegister(
        '13800138000', '张三', 'device-002', '1.2.3.4',
      );

      expect(result.hasCoupon).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════
  // 手机号历史注销库拦截
  // ═══════════════════════════════════════════════

  describe('checkAndRegister — 手机号黑名单拦截', () => {
    it('手机号在历史注销沉淀库内应被拦截', async () => {
      mockRedis.get.mockImplementation((key) => {
        if (key === 'risk:hash_bl:sha256-13800138000') return '1';
        return null;
      });

      await expect(
        RiskService.checkAndRegister('13800138000', '张三', 'device-001', '1.2.3.4'),
      ).rejects.toMatchObject({
        code: 40300,
        statusCode: 403,
      });
    });

    it('手机号不在历史注销库内应正常注册', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await RiskService.checkAndRegister(
        '13800138000', '张三', 'device-001', '1.2.3.4',
      );

      expect(result.hasCoupon).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════
  // 白名单放行
  // ═══════════════════════════════════════════════

  describe('checkAndRegister — 白名单放行', () => {
    it('白名单 IP 应跳过所有黑名单校验', async () => {
      mockWhitelist.isWhitelisted.mockResolvedValue(true);

      // 即使 Redis 返回黑名单标记，白名单也应放行
      mockRedis.get.mockImplementation((key) => {
        if (key === 'risk:device_bl:device-001') return '1';
        return null;
      });

      const result = await RiskService.checkAndRegister(
        '13800138000', '张三', 'device-001', '1.2.3.4',
      );

      expect(result.hasCoupon).toBe(true);
      // 白名单放行时需要调用 whitelistService.isWhitelisted
      expect(mockWhitelist.isWhitelisted).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════
  // 注销账号流程
  // ═══════════════════════════════════════════════

  describe('cancelAccount — 注销沉淀', () => {
    it('注销后应写入 Redis 黑名单', async () => {
      const result = await RiskService.cancelAccount(
        '13800138000', '1.2.3.4', 'device-001',
      );

      expect(result).toBe(true);
      // 应写入 phone_hash 黑名单
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('risk:hash_bl:'),
        expect.any(String),
        expect.any(Number),
      );
      // 应写入设备黑名单
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('risk:device_bl:'),
        '1',
        expect.any(Number),
      );
    });

    it('注销后应写入 MySQL 归档', async () => {
      await RiskService.cancelAccount('13800138000', '1.2.3.4', 'device-001');

      // 应写入风险哈希归档表
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO risk_hash_archives'),
        expect.any(Array),
      );
    });

    it('注销后应物理删除用户表记录', async () => {
      await RiskService.cancelAccount('13800138000', '1.2.3.4', 'device-001');

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM sys_users'),
        expect.any(Array),
      );
    });

    it('注销后应清除 Redis 注册标记', async () => {
      await RiskService.cancelAccount('13800138000', '1.2.3.4', 'device-001');

      expect(mockRedis.del).toHaveBeenCalledWith('user:registered:13800138000');
    });
  });

  // ═══════════════════════════════════════════════
  // 高频注销限流
  // ═══════════════════════════════════════════════

  describe('cancelAccount — 注销限流', () => {
    it('同一 IP 高频注销应触发限流', async () => {
      // 模拟第 5 次请求（超过 10 分钟窗口内 4 次上限）
      mockRedis.incr.mockResolvedValue(5);

      await expect(
        RiskService.cancelAccount('13800138000', '1.2.3.4', 'device-001'),
      ).rejects.toMatchObject({
        code: 42900,
        statusCode: 429,
      });
    });

    it('白名单 IP 注销应跳过限流', async () => {
      mockWhitelist.isWhitelisted.mockResolvedValue(true);
      mockRedis.incr.mockResolvedValue(100); // 即使计数器超限

      const result = await RiskService.cancelAccount(
        '13800138000', '1.2.3.4', 'device-001',
      );

      expect(result).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════
  // 解封
  // ═══════════════════════════════════════════════

  describe('unbanUser', () => {
    it('解封应清除 Redis + MySQL 黑名单', async () => {
      const result = await RiskService.unbanUser('fp-001', 'sha256-13800138000');

      expect(result).toBe(true);
      // 应调用 MySQL 删除
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM risk_hash_archives'),
        expect.any(Array),
      );
    });
  });

  // ═══════════════════════════════════════════════
  // IP 临时黑名单
  // ═══════════════════════════════════════════════

  describe('isIpBlacklisted', () => {
    it('IP 在临时黑名单内应返回 true', async () => {
      mockRedis.get.mockImplementation((key) => {
        if (key === 'risk:ip_bl:1.2.3.4') return 'captcha_fail';
        return null;
      });

      const result = await RiskService.isIpBlacklisted('1.2.3.4');
      expect(result).toBe(true);
    });

    it('IP 不在临时黑名单内应返回 false', async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await RiskService.isIpBlacklisted('1.2.3.4');
      expect(result).toBe(false);
    });
  });

  describe('clearIpBlacklist', () => {
    it('清除 IP 黑名单应成功', async () => {
      const result = await RiskService.clearIpBlacklist('1.2.3.4');
      expect(result).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith('risk:ip_bl:1.2.3.4');
    });
  });
});
