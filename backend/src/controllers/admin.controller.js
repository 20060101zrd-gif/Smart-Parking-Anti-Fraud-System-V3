// backend/src/controllers/admin.controller.js

const authService = require('../services/auth.service');

const riskService = require('../services/risk.service');

const auditService = require('../services/audit.service');

const interceptLogService = require('../services/intercept-log.service');

const whitelistService = require('../services/whitelist.service');

const db = require('../data/mysql.client');
const redisClient = require('../data/redis.client');
const encryption = require('../utils/encryption');

const { success, fail } = require('../utils/response');




class AdminController {

  // 管理员登录

  async login(req, res, next) {

    try {

      const { username, password } = req.body;




      if (!username || !password) {

        return fail(res, 400, 40000, '账号或密码不可为空');

      }




      // 调用服务层进行账密校验与 JWT 签发

      const { token, adminId, username: adminName } = await authService.login(username, password);




      // 安全规范：强管控凭证写入 HttpOnly Cookie，阻止前端 JS 窃取

      res.cookie('admin_token', token, {

        httpOnly: true,

        sameSite: 'strict',

        maxAge: 2 * 60 * 60 * 1000, // 2小时 (与 JWT 有效期一致)

        path: '/'

      });




      // 响应体中绝对不包含 token

      return success(res, { adminId, username: adminName }, '登录成功');

    } catch (err) {

      next(err);

    }

  }

  // 管理员退出登录

  async logout(req, res, next) {

    try {

      // jwtAuth 中间件已将解析后的载荷挂载到 req.admin

      // 其中 exp 为 JWT 标准声明的过期时间戳（秒）

      const { jti, exp, adminId } = req.admin;




      // 1. 将当前 JWT 的 JTI 写入 Redis 吊销黑名单

      await authService.revokeToken(jti, exp, adminId);




      // 2. 记录安全审计日志

      auditService.logAction(adminId, 'LOGOUT', jti, req.ip);




      // 3. 彻底清除客户端 HttpOnly Cookie

      res.cookie('admin_token', '', {

        httpOnly: true,

        sameSite: 'strict',

        maxAge: 0, // 设置生命周期为 0 立即失效

        path: '/'

      });




      return success(res, { success: true }, '退出登录成功');

    } catch (err) {

      next(err);

    }

  }

  // 凭证主动吊销

  async revokeJwt(req, res, next) {

    try {

      const { targetJti, expireAt } = req.body;




      if (!targetJti || !expireAt) {

        return fail(res, 400, 40000, '吊销目标参数不完整');

      }




      await authService.revokeToken(targetJti, expireAt, req.admin.adminId);

      

      // 记录审计日志

      auditService.logAction(req.admin.adminId, 'REVOKE_JWT', targetJti, req.ip);




      return success(res, { revoked: true }, '凭证已成功吊销');

    } catch (err) {

      next(err);

    }

  }




  // 风控黑名单解封

  async unbanRisk(req, res, next) {

    try {

      const { fingerprint } = req.body;




      if (!fingerprint) {

        return fail(res, 400, 40000, '必须提供目标哈希指纹');

      }




      // 调用风控服务解除拦截状态 (由于此处无手机号明文，仅解封指纹)

      await riskService.unbanUser(fingerprint, null);




      // 记录审计日志

      auditService.logAction(req.admin.adminId, 'UNBAN_USER', fingerprint, req.ip);




      return success(res, { success: true }, '黑名单解封成功');

    } catch (err) {

      next(err);

    }

  }




  // 强制用户删除与拉黑

  async forceDeleteUser(req, res, next) {

    try {

      const { phone, reason = '管理员强制抹除' } = req.body;




      if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {

        return fail(res, 400, 40000, '无效的手机号参数');

      }




      await riskService.cancelAccount(phone);




      // 记录审计日志

      auditService.logAction(req.admin.adminId, 'FORCE_DELETE_USER', phone, req.ip);




      return success(res, { success: true }, '用户已被强制擦除并列入黑名单');

    } catch (err) {

      next(err);

    }

  }




  // 监控大盘数据查询

  async getDashboard(req, res, next) {

    try {

      const page = parseInt(req.query.page) || 1;

      const pageSize = parseInt(req.query.pageSize) || 20;

      const offset = (page - 1) * pageSize;




      // 并行查询三类核心大盘数据

      const [blacklists, auditLogs] = await Promise.all([

        db.all(
          `SELECT fingerprint, phone_mask, created_at, expires_at, 'hash' AS bl_type FROM risk_hash_archives
           UNION ALL
           SELECT device_fingerprint AS fingerprint, '' AS phone_mask, created_at, NULL AS expires_at, 'device' AS bl_type FROM sys_blacklist
           ORDER BY created_at DESC LIMIT ? OFFSET ?`, [pageSize, offset]
        ),

        db.all(`SELECT admin_id, action_type, target_resource, ip_address, created_at FROM sys_audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?`, [pageSize, offset])

      ]);



      // 构造大盘聚合响应
      const dashboardData = {
        activeUsers: [],
        blacklists,
        auditLogs
      };




      return success(res, dashboardData, '大盘数据拉取成功');

    } catch (err) {

      next(err);

    }

  }

  // 🆕 强制刷盘拦截日志（用于测试/运维，绕过 2s 定时器）
  async forceFlushInterceptLogs(req, res, next) {
    try {
      const count = await interceptLogService.flushAndWrite();
      return success(res, { flushed: count }, `已强制刷盘 ${count} 条拦截日志`);
    } catch (err) {
      next(err);
    }
  }

  // 🆕 一键清空拦截日志
  async clearInterceptLogs(req, res, next) {
    try {
      // 先刷盘在内存中的日志，再清空
      await interceptLogService.flushAndWrite();
      const result = await db.run(`DELETE FROM risk_intercept_logs`);
      const deleted = result?.changes || 0;
      auditService.logAction(req.admin.adminId, 'CLEAR_INTERCEPT_LOGS', `清空 ${deleted} 条拦截日志`, req.ip);
      return success(res, { deleted }, `已清空 ${deleted} 条拦截日志`);
    } catch (err) {
      next(err);
    }
  }

  // 🆕 风控拦截日志分页查询
  async getInterceptLogs(req, res, next) {
    try {
      const { page, pageSize, ip, startDate, endDate } = req.query;

      const toMySql = (d) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');

      const result = await interceptLogService.queryLogs({
        page,
        pageSize,
        ip,
        startDate: startDate ? toMySql(startDate) : null,
        endDate:   endDate   ? toMySql(endDate)   : null
      });

      return success(res, result, '拦截日志查询成功');
    } catch (err) {
      next(err);
    }
  }

  // ═══════════════════════════════════════════════
  // 🆕 白名单管理（需超级管理员权限）
  // ═══════════════════════════════════════════════

  // 查询白名单列表
  async getWhitelist(req, res, next) {
    try {
      const [ips, devices] = await Promise.all([
        whitelistService.listIps(),
        whitelistService.listDevices()
      ]);

      return success(res, {
        ips:    ips    || [],
        devices: devices || [],
        total:  (ips?.length || 0) + (devices?.length || 0)
      }, '白名单查询成功');
    } catch (err) {
      next(err);
    }
  }

  // 添加白名单
  async addToWhitelist(req, res, next) {
    try {
      const { type, value, remark = '' } = req.body;

      if (!type || !value) {
        return fail(res, 400, 40000, '缺少类型（ip/device）或白名单值');
      }

      if (!['ip', 'device'].includes(type)) {
        return fail(res, 400, 40000, '类型必须为 ip 或 device');
      }

      // 记录审计日志
      auditService.logAction(
        req.admin.adminId,
        'ADD_WHITELIST',
        `${type}:${value}`,
        req.ip
      );

      if (type === 'ip') {
        await whitelistService.addIp(value.trim(), remark, req.admin?.adminId);
        return success(res, { ip: value.trim() }, `IP ${value} 已加入白名单`);
      } else {
        await whitelistService.addDevice(value.trim(), remark, req.admin?.adminId);
        const devicePreview = (value || '').substring(0, 16);
        return success(res, { deviceHash: value.trim() }, `设备 ${devicePreview}... 已加入白名单`);
      }
    } catch (err) {
      next(err);
    }
  }

  // 移除白名单
  async removeFromWhitelist(req, res, next) {
    try {
      const { type, value } = req.body;

      if (!type || !value) {
        return fail(res, 400, 40000, '缺少类型（ip/device）或白名单值');
      }

      if (!['ip', 'device'].includes(type)) {
        return fail(res, 400, 40000, '类型必须为 ip 或 device');
      }

      // 记录审计日志
      auditService.logAction(
        req.admin.adminId,
        'REMOVE_WHITELIST',
        `${type}:${value}`,
        req.ip
      );

      if (type === 'ip') {
        await whitelistService.removeIp(value.trim());
        return success(res, { ip: value.trim() }, `IP ${value} 已移出白名单`);
      } else {
        await whitelistService.removeDevice(value.trim());
        const devicePreview = (value || '').substring(0, 16);
        return success(res, { deviceHash: value.trim() }, `设备 ${devicePreview}... 已移出白名单`);
      }
    } catch (err) {
      next(err);
    }
  }

  // 🆕 通过手机号添加设备白名单（一步到位，无需手动复制设备哈希）
  async addToWhitelistByPhone(req, res, next) {
    try {
      const { phone, remark = '通过手机号添加' } = req.body;

      if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
        return fail(res, 400, 40000, '请输入有效的手机号');
      }

      const phoneHash = encryption.hashPhone(phone);

      // 1. 先查活跃用户 sys_users
      const userRow = await db.get(
        `SELECT device_hash FROM sys_users WHERE phone_hash = ? AND status = 1 LIMIT 1`,
        [phoneHash]
      );

      let deviceHash = userRow?.device_hash || null;
      let source = 'sys_users';

      // 2. 如果活跃用户中没找到，查注销沉淀库 sys_blacklist
      if (!deviceHash) {
        const blRow = await db.get(
          `SELECT device_fingerprint FROM sys_blacklist WHERE phone_hash = ? LIMIT 1`,
          [phoneHash]
        );
        deviceHash = blRow?.device_fingerprint || null;
        source = 'sys_blacklist';
      }

      if (!deviceHash) {
        return fail(res, 404, 40400, '未找到该手机号关联的设备哈希，用户可能尚未注册或已被彻底清除');
      }

      // 3. 加入白名单
      await whitelistService.addDevice(deviceHash, remark, req.admin?.adminId);

      // 4. 审计日志
      auditService.logAction(
        req.admin.adminId,
        'ADD_WHITELIST_BY_PHONE',
        `phone→${phoneHash.substring(0, 16)}... device→${deviceHash.substring(0, 16)}...`,
        req.ip
      );

      const devicePreview = deviceHash.substring(0, 16);
      return success(res, {
        deviceHash,
        phone_hash: phoneHash,
        source,
        display: `${devicePreview}...`
      }, `手机号关联设备 ${devicePreview}... 已加入白名单（来源：${source === 'sys_users' ? '活跃用户' : '注销沉淀库'}）`);
    } catch (err) {
      next(err);
    }
  }

  // 🆕 清除 IP 临时黑名单
  async clearIpBlacklist(req, res, next) {
    try {
      const { ip } = req.body;
      if (!ip) return fail(res, 400, 40000, '缺少 IP 参数');
      await riskService.clearIpBlacklist(ip);
      auditService.logAction(req.admin.adminId, 'CLEAR_IP_BL', ip, req.ip);
      return success(res, { ip }, `IP ${ip} 已从临时黑名单中移除`);
    } catch (err) { next(err); }
  }

  // 🆕 系统概览 — 统计卡片 + 趋势图 (支持 7/30 天切换)
  async getOverview(req, res, next) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const range = Math.min(30, Math.max(7, parseInt(req.query.range) || 7));
      const [ti, tu, bc, wl, tr, regTr] = await Promise.all([
        db.get('SELECT COUNT(*) AS cnt FROM risk_intercept_logs WHERE DATE(created_at) = ?', [today]),
        db.get('SELECT COUNT(*) AS cnt FROM sys_users WHERE status = 1'),
        db.get("SELECT (SELECT COUNT(*) FROM risk_hash_archives WHERE expires_at > NOW()) + (SELECT COUNT(*) FROM sys_blacklist) AS cnt"),
        db.get('SELECT COUNT(*) AS cnt FROM sys_whitelist'),
        db.all(`SELECT DATE(created_at) AS day, COUNT(*) AS cnt FROM risk_intercept_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY DATE(created_at) ORDER BY day ASC`, [range]),
        db.all(`SELECT DATE(registered_at) AS day, COUNT(*) AS cnt FROM sys_users WHERE registered_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY DATE(registered_at) ORDER BY day ASC`, [range])
      ]);

      // 🆕 合并 Redis 实时黑名单计数
      let redisBlCount = 0;
      try {
        const hashKeys = await redisClient.scanKeys('risk:hash_bl:*');
        const devKeys = await redisClient.scanKeys('risk:device_bl:*');
        redisBlCount = (hashKeys?.length||0) + (devKeys?.length||0);
      } catch (e) { /* Redis 不可用 */ }
      const blacklistCount = (bc?.cnt||0) + redisBlCount;

      // 补全日期...
      // mysql2 把 DATETIME 转 JS Date 再序列化为 ISO 字符串，先格式化为 YYYY-MM-DD
      const fmtDay = (v) => {
        if (!v) return '';
        if (typeof v === 'string') return v.slice(0, 10);
        if (v instanceof Date) {
          const y = v.getFullYear(), m = String(v.getMonth()+1).padStart(2,'0'), d = String(v.getDate()).padStart(2,'0');
          return `${y}-${m}-${d}`;
        }
        return String(v).slice(0, 10);
      };
      const dayMap = {}; const regMap = {};
      (tr||[]).forEach(t=>{dayMap[fmtDay(t.day)]=t.cnt});
      (regTr||[]).forEach(t=>{regMap[fmtDay(t.day)]=t.cnt});
      const fullTrend = []; const fullReg = [];
      for (let i = range-1; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate()-i);
        const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        fullTrend.push({day:ds, cnt:dayMap[ds]||0});
        fullReg.push({day:ds, cnt:regMap[ds]||0});
      }
      // 异常检测
      const values = fullTrend.map(t=>t.cnt);
      const avg = values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0;
      const threshold = avg * 1.8;
      const trendWithAnomaly = fullTrend.map(t=>({...t, isAnomaly: t.cnt > threshold && t.cnt > 0}));

      return success(res, {
        todayIntercept: ti?.cnt||0, totalUsers: tu?.cnt||0, blacklistCount,
        whitelistCount: wl?.cnt||0,
        trend: trendWithAnomaly, registerTrend: fullReg, avgIntercept: Math.round(avg), range
      }, '概览数据查询成功');
    } catch (err) { next(err); }
  }

  // 🆕 黑名单管理 — 分页列表（MySQL + Redis 双源，支持手机号搜索）
  async getBlacklist(req, res, next) {
    try {
      const page = Math.max(1, parseInt(req.query.page)||1), pageSize = Math.min(100,Math.max(1,parseInt(req.query.pageSize)||20));
      const offset = (page-1)*pageSize, search = (req.query.search||'').trim();
      
      // 🆕 如果搜索的是手机号（非哈希指纹），先转换成 phone_hash 再查
      let phoneHashFilter = '';
      if (search && /^1[3-9]\d{9}$/.test(search)) {
        try {
          const encryption = require('../utils/encryption');
          phoneHashFilter = encryption.hashPhone(search);
        } catch (e) { /* 无法 hash 时忽略 */ }
      }

      // 1. MySQL 黑名单联合查询
      let whereClauseHash = 'WHERE 1=1';
      let whereClauseDevice = 'WHERE 1=1';
      const paramsHash = [];
      const paramsDevice = [];
      if (search) {
        if (phoneHashFilter) {
          // 手机号搜索：同时用 phone_hash 精确匹配和 fingerprint 匹配（兼容旧数据把手机号存成 fingerprint）
          whereClauseHash += ' AND (phone_hash = ? OR fingerprint = ?)';
          paramsHash.push(phoneHashFilter, search);
          whereClauseDevice += ' AND (phone_hash = ? OR device_fingerprint = ?)';
          paramsDevice.push(phoneHashFilter, search);
        } else {
          // 指纹搜索：模糊匹配fingerprint
          whereClauseHash += ' AND fingerprint LIKE ?';
          paramsHash.push(`%${search}%`);
          whereClauseDevice += ' AND device_fingerprint LIKE ?';
          paramsDevice.push(`%${search}%`);
        }
      }

      const [rows, tr] = await Promise.all([
        db.all(
          `SELECT id, fingerprint, phone_hash, '' AS phone_mask, '用户注销' AS reason, created_at, expires_at, 'hash' AS bl_type
           FROM risk_hash_archives ${whereClauseHash}
           UNION ALL
           SELECT id, device_fingerprint AS fingerprint, phone_hash, '' AS phone_mask, reason, created_at, NULL AS expires_at, 'device' AS bl_type
           FROM sys_blacklist ${whereClauseDevice}
           ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          [...paramsHash, ...paramsDevice, pageSize, offset]
        ),
        db.get(
          `SELECT (SELECT COUNT(*) FROM risk_hash_archives ${whereClauseHash}) + (SELECT COUNT(*) FROM sys_blacklist ${whereClauseDevice}) AS cnt`,
          [...paramsHash, ...paramsDevice]
        )
      ]);

      // 2. Redis 实时黑名单 key 扫描
      let redisEntries = [];
      try {
        const hashBlKeys = await redisClient.scanKeys('risk:hash_bl:*');
        const deviceBlKeys = await redisClient.scanKeys('risk:device_bl:*');
        for (const key of hashBlKeys) {
          const ttl = await redisClient.ttl(key);
          const masked = key.split('risk:hash_bl:').pop() || key;
          redisEntries.push({
            id: `redis_${masked.substring(0,8)}`,
            fingerprint: masked.substring(0,16)+'...',
            raw_fingerprint: masked,
            phone_hash: masked,
            phone_mask: '',
            reason: '手机号历史注销拦截',
            created_at: new Date().toISOString(),
            expires_at: ttl > 0 ? `${Math.floor(ttl/86400)}天后` : '永久',
            bl_type: 'redis_hash'
          });
        }
        for (const key of deviceBlKeys) {
          const ttl = await redisClient.ttl(key);
          const masked = key.split('risk:device_bl:').pop() || key;
          redisEntries.push({
            id: `redis_dev_${masked.substring(0,8)}`,
            fingerprint: masked.substring(0,16)+'...',
            raw_fingerprint: masked,
            phone_mask: '',
            reason: '设备高风险拦截',
            created_at: new Date().toISOString(),
            expires_at: ttl > 0 ? `${Math.floor(ttl/86400)}天后` : '永久',
            bl_type: 'redis_device'
          });
        }
        // 搜索过滤：手机号搜索按 phone_hash 精确匹配（兼容旧 key 直接存手机号）
        if (search) {
          if (phoneHashFilter) {
            redisEntries = redisEntries.filter(e =>
              e.phone_hash === phoneHashFilter || e.phone_hash === search
            );
          } else {
            redisEntries = redisEntries.filter(e =>
              e.fingerprint.includes(search) || e.reason.includes(search)
            );
          }
        }
      } catch (e) { /* Redis 不可用时静默降级 */ }

      // 3. 合并，总数 = MySQL + Redis
      const allRows = [...rows, ...redisEntries];
      const total = (tr?.cnt||0) + redisEntries.length;

      return success(res, { list: allRows, total, page, pageSize }, '黑名单查询成功（含 Redis 实时拦截）');
    } catch (err) { next(err); }
  }

  // 🆕 黑名单 — 手动添加（支持设备指纹 + 手机号）
  async addBlacklist(req, res, next) {
    try {
      const { fingerprint, phone, reason } = req.body;
      const encryption = require('../utils/encryption');
      const ea = new Date(Date.now()+90*24*3600000).toISOString().slice(0,19).replace('T',' ');

      if (phone && /^1[3-9]\d{9}$/.test(phone)) {
        // 手机号路径：hash 后写入双表（phone_blacklist_map + risk_hash_archives）
        const phoneHash = encryption.hashPhone(phone);
        const phoneMask = phone.slice(0,3) + '****' + phone.slice(7);
        const fp = 'PHONE:' + phoneHash.slice(0,32);
        await db.run(
          `INSERT INTO phone_blacklist_map (phone_hash, fingerprint, phone_mask, created_at, expires_at) VALUES (?, ?, ?, NOW(), ?)
           ON DUPLICATE KEY UPDATE created_at = VALUES(created_at), expires_at = VALUES(expires_at)`,
          [phoneHash, fp, phoneMask, ea]);
        await db.run(
          `INSERT INTO risk_hash_archives (fingerprint, phone_hash, phone_mask, created_at, expires_at) VALUES (?, ?, ?, NOW(), ?)
           ON DUPLICATE KEY UPDATE phone_hash = VALUES(phone_hash), phone_mask = VALUES(phone_mask), created_at = VALUES(created_at), expires_at = VALUES(expires_at)`,
          [fp, phoneHash, phoneMask, ea]);
        await db.run(`INSERT INTO sys_operation_logs (admin_id,action_type,target_resource,detail,ip_address) VALUES (?,'ADD_BLACKLIST',?,?,?)`,
          [req.admin.adminId, phoneMask, reason||'手动添加（手机号）',req.ip||'127.0.0.1']).catch(()=>{});
        return success(res,{phone:phoneMask},'黑名单条目已添加（手机号）');
      }

      if (!fingerprint) return fail(res,400,40000,'缺少指纹或手机号参数');
      await db.run(
        `INSERT INTO risk_hash_archives (fingerprint, phone_mask, created_at, expires_at) VALUES (?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE phone_mask = VALUES(phone_mask), created_at = VALUES(created_at), expires_at = VALUES(expires_at)`,
        [fingerprint, '', ea]);
      await db.run(`INSERT INTO sys_operation_logs (admin_id,action_type,target_resource,detail,ip_address) VALUES (?,'ADD_BLACKLIST',?,?,?)`,
        [req.admin.adminId,fingerprint,reason||'手动添加',req.ip||'127.0.0.1']).catch(()=>{});
      return success(res,{fingerprint},'黑名单条目已添加（设备指纹）');
    } catch (err) { next(err); }
  }

  // 🆕 黑名单 — 删除
  async removeBlacklist(req, res, next) {
    try {
      const { id, fingerprint } = req.body;
      if (!id && !fingerprint) return fail(res,400,40000,'缺少 id 或 fingerprint');
      const w = id?'id = ?':'fingerprint = ?', param = id||fingerprint;

      await db.run(`DELETE FROM risk_hash_archives WHERE ${w}`,[param]);
      // 🆕 同步清理 sys_blacklist（设备维度）
      await db.run(
        id ? `DELETE FROM sys_blacklist WHERE id = ?` : `DELETE FROM sys_blacklist WHERE device_fingerprint = ?`,
        [param]
      ).catch(() => {});

      await db.run(`INSERT INTO sys_operation_logs (admin_id,action_type,target_resource,detail,ip_address) VALUES (?,'REMOVE_BLACKLIST',?,?,?)`,
        [req.admin.adminId,String(param),'管理员解除黑名单',req.ip||'127.0.0.1']).catch(()=>{});
      return success(res,{removed:param},'黑名单条目已移除');
    } catch (err) { next(err); }
  }

  // 🆕 操作日志查询
  async getOperationLogs(req, res, next) {
    try {
      const page=Math.max(1,parseInt(req.query.page)||1), pageSize=Math.min(100,Math.max(1,parseInt(req.query.pageSize)||20));
      const [rows,tr]=await Promise.all([
        db.all('SELECT id,admin_id,action_type,target_resource,detail,ip_address,created_at FROM sys_operation_logs ORDER BY created_at DESC LIMIT ? OFFSET ?',[pageSize,(page-1)*pageSize]),
        db.get('SELECT COUNT(*) AS cnt FROM sys_operation_logs')
      ]);
      return success(res,{list:rows,total:tr?.cnt||0,page,pageSize},'操作日志查询成功');
    } catch (err) { next(err); }
  }

  // 🆕 黑名单 — 通过手机号搜索（管理员输入明文手机号 → hash → 返回匹配的 fingerprint）
  async searchBlacklistByPhone(req, res, next) {
    try {
      const { phone } = req.query;
      if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
        return fail(res, 400, 40000, '请输入有效的手机号');
      }
      const encryption = require('../utils/encryption');
      const phoneHash = encryption.hashPhone(phone);
      const entries = await db.all(
        `SELECT fingerprint, phone_mask, expires_at FROM phone_blacklist_map WHERE phone_hash = ?`,
        [phoneHash]
      );
      return success(res, {
        phone_hash: phoneHash.substring(0, 16) + '...',
        entries,
        found: entries.length > 0
      }, entries.length > 0 ? '已查到黑名单记录' : '该手机号不在黑名单中');
    } catch (err) { next(err); }
  }

  // 🆕 黑名单 — 通过手机号解封（管理员输入明文手机号 → hash → 删除所有关联黑名单）
  async unbanByPhone(req, res, next) {
    try {
      const { phone } = req.body;
      if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
        return fail(res, 400, 40000, '请输入有效的手机号');
      }
      const encryption = require('../utils/encryption');
      const phoneHash = encryption.hashPhone(phone);

      // 1. 从映射表获取 fingerprint（兼容旧数据可能未写入映射表的情况）
      const mapEntry = await db.get(
        `SELECT fingerprint FROM phone_blacklist_map WHERE phone_hash = ?`, [phoneHash]
      );

      // 2. 检查 Redis 实时黑名单（覆盖仅写入 Redis 的旧数据场景）
      let redisHit = false;
      try {
        const redisClient = require('../data/redis.client');
        // 2.1 精确 key 删除
        for (const suffix of [phoneHash, phone]) {
          const val = await redisClient.get(`risk:hash_bl:${suffix}`);
          if (val) redisHit = true;
          await redisClient.del(`risk:hash_bl:${suffix}`);
        }
        // 2.2 兜底扫描：key 格式不固定时也能命中并删除
        const hashBlKeys = await redisClient.scanKeys('risk:hash_bl:*');
        for (const key of hashBlKeys) {
          const suffix = key.split('risk:hash_bl:').pop() || '';
          if (suffix === phoneHash || suffix === phone) {
            redisHit = true;
            await redisClient.del(`risk:hash_bl:${suffix}`);
          }
        }
      } catch (e) { /* Redis 不可用时忽略 */ }

      if (!mapEntry && !redisHit) {
        return fail(res, 404, 40400, '该手机号未在黑名单中');
      }

      // 3. 从 risk_hash_archives 删除（优先用 fingerprint，否则按 phone_hash）
      if (mapEntry?.fingerprint) {
        await db.run(
          `DELETE FROM risk_hash_archives WHERE fingerprint = ?`, [mapEntry.fingerprint]
        );
      } else {
        await db.run(
          `DELETE FROM risk_hash_archives WHERE phone_hash = ?`, [phoneHash]
        ).catch(() => {});
      }
      // 4. 从 phone_blacklist_map 删除
      await db.run(
        `DELETE FROM phone_blacklist_map WHERE phone_hash = ?`, [phoneHash]
      ).catch(() => {});
      // 5. 同步清理 sys_blacklist 中关联该手机号的设备记录（注销时可能写入）
      await db.run(
        `DELETE FROM sys_blacklist WHERE phone_hash = ?`, [phoneHash]
      ).catch(() => {});

      // 6. 审计日志
      const auditService = require('../services/audit.service');
      auditService.logAction(req.admin.adminId, 'UNBAN_BY_PHONE', phoneHash.substring(0, 16) + '...', req.ip);

      return success(res, { phone_hash: phoneHash.substring(0, 16) + '...' }, '黑名单解封成功');
    } catch (err) { next(err); }
  }

  // 🆕 黑名单 — 通过 phone_hash 直接解封（无需输入明文手机号）
  async unbanByPhoneHash(req, res, next) {
    try {
      const { phone_hash: phoneHash } = req.body;
      if (!phoneHash || typeof phoneHash !== 'string' || phoneHash.length < 32) {
        return fail(res, 400, 40000, '缺少有效的 phone_hash');
      }

      const redisClient = require('../data/redis.client');
      const auditService = require('../services/audit.service');

      // 1. 从映射表 / 归档表获取 fingerprint
      const mapEntry = await db.get(
        `SELECT fingerprint FROM phone_blacklist_map WHERE phone_hash = ?`, [phoneHash]
      );
      const archiveEntry = await db.get(
        `SELECT fingerprint FROM risk_hash_archives WHERE phone_hash = ?`, [phoneHash]
      );

      // 2. 清除 Redis 实时黑名单
      let redisHit = false;
      try {
        const val = await redisClient.get(`risk:hash_bl:${phoneHash}`);
        if (val) redisHit = true;
        await redisClient.del(`risk:hash_bl:${phoneHash}`);
      } catch (e) { /* Redis 不可用时忽略 */ }

      if (!mapEntry && !archiveEntry && !redisHit) {
        return fail(res, 404, 40400, '该 phone_hash 未在黑名单中');
      }

      // 3. 从 risk_hash_archives 删除（优先用 fingerprint，否则按 phone_hash）
      const targetFingerprint = archiveEntry?.fingerprint || mapEntry?.fingerprint;
      if (targetFingerprint) {
        await db.run(
          `DELETE FROM risk_hash_archives WHERE fingerprint = ?`, [targetFingerprint]
        ).catch(() => {});
      }
      await db.run(
        `DELETE FROM risk_hash_archives WHERE phone_hash = ?`, [phoneHash]
      ).catch(() => {});

      // 4. 从 phone_blacklist_map 删除
      await db.run(
        `DELETE FROM phone_blacklist_map WHERE phone_hash = ?`, [phoneHash]
      ).catch(() => {});

      // 5. 同步清理 sys_blacklist
      await db.run(
        `DELETE FROM sys_blacklist WHERE phone_hash = ?`, [phoneHash]
      ).catch(() => {});

      auditService.logAction(req.admin.adminId, 'UNBAN_BY_HASH', phoneHash.substring(0, 16) + '...', req.ip);

      return success(res, { phone_hash: phoneHash.substring(0, 16) + '...' }, '黑名单解封成功');
    } catch (err) { next(err); }
  }

  // 🆕 用户管理 — 分页查询 + 自动解密手机号（脱敏展示）
  async getUsers(req, res, next) {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
      const offset = (page - 1) * pageSize;
      const search = (req.query.search || '').trim();

      // 构建搜索条件
      let where = 'WHERE 1=1';
      const params = [];

      if (search) {
        // 按手机号搜索：先转成 phone_hash 再精确匹配
        if (/^1[3-9]\d{9}$/.test(search)) {
          const phoneHash = encryption.hashPhone(search);
          where += ' AND phone_hash = ?';
          params.push(phoneHash);
        } else {
          // 按姓名模糊搜索
          where += ' AND name LIKE ?';
          params.push(`%${search}%`);
        }
      }

      // 查总数
      const countRow = await db.get(
        `SELECT COUNT(*) AS total FROM sys_users ${where}`, params
      );
      const total = countRow?.total || 0;

      // 查分页数据
      const rows = await db.all(
        `SELECT id, phone, phone_hash, device_hash, name, status, registered_at, cancelled_at
         FROM sys_users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );

      // 日期格式化：MySQL DATETIME → YYYY-MM-DD HH:mm:ss
      const fmtDate = (v) => {
        if (!v) return '';
        const d = v instanceof Date ? v : new Date(v);
        if (isNaN(d.getTime())) return String(v).slice(0, 19).replace('T', ' ');
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      };

      // 解密 + 脱敏手机号
      const list = rows.map(row => {
        let phoneDisplay = '(解密失败)';
        try {
          const plainPhone = encryption.decrypt(row.phone);
          // 脱敏：138****5678
          phoneDisplay = plainPhone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
        } catch (e) {
          phoneDisplay = (row.phone || '').substring(0, 16) + '...';
        }

        return {
          id: row.id,
          name: row.name,
          phone: phoneDisplay,
          phoneHash: (row.phone_hash || '').substring(0, 16) + '...',
          deviceHash: (row.device_hash || '').substring(0, 16) + '...',
          status: row.status === 1 ? '正常' : '已注销',
          registeredAt: fmtDate(row.registered_at),
          cancelledAt: fmtDate(row.cancelled_at)
        };
      });

      // 审计日志
      auditService.logAction(req.admin.adminId, 'QUERY_USERS', `page=${page}&search=${search}`, req.ip);

      return success(res, { list, total, page, pageSize }, '用户列表查询成功');
    } catch (err) { next(err); }
  }

  // 单个用户手机号解密（按 ID）
  async getUserPhone(req, res, next) {
    try {
      const id = parseInt(req.params.id);
      if (!id) return fail(res, 400, 40000, '无效的用户ID');
      const row = await db.get('SELECT phone FROM sys_users WHERE id = ?', [id]);
      if (!row) return fail(res, 404, 40400, '用户不存在');
      const plainPhone = encryption.decrypt(row.phone);
      auditService.logAction(req.admin.adminId, 'VIEW_PHONE_SINGLE', `user_id=${id}`, req.ip);
      return success(res, { id, phone: plainPhone }, '手机号解密成功');
    } catch (err) { next(err); }
  }

  // 批量解密手机号
  async decryptPhones(req, res, next) {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return fail(res, 400, 40000, '请提供用户ID列表');
      }
      if (ids.length > 100) return fail(res, 400, 40000, '单次最多解密100条');

      const placeholders = ids.map(() => '?').join(',');
      const rows = await db.all(
        `SELECT id, phone FROM sys_users WHERE id IN (${placeholders})`,
        ids
      );
      const phones = {};
      for (const row of rows) {
        phones[row.id] = encryption.decrypt(row.phone);
      }
      auditService.logAction(req.admin.adminId, 'VIEW_PHONE_BATCH', `count=${ids.length}`, req.ip);
      return success(res, { phones }, `已解密 ${Object.keys(phones).length} 条手机号`);
    } catch (err) { next(err); }
  }

  // 🆕 踢出用户：删除 sys_users + 清理关联黑名单，允许重新注册领券
  async kickUser(req, res, next) {
    try {
      const id = parseInt(req.body.id);
      if (!id) return fail(res, 400, 40000, '无效的用户ID');
      const row = await db.get('SELECT phone, phone_hash, device_hash FROM sys_users WHERE id = ?', [id]);
      if (!row) return fail(res, 404, 40400, '用户不存在');

      const plainPhone = encryption.decrypt(row.phone);
      const phoneHash = row.phone_hash || '';

      // 1. 删除用户记录
      await db.run('DELETE FROM sys_users WHERE id = ?', [id]);

      // 2. 清理黑名单（如果有）
      if (phoneHash) {
        await db.run('DELETE FROM phone_blacklist_map WHERE phone_hash = ?', [phoneHash]).catch(() => {});
        await db.run('DELETE FROM risk_hash_archives WHERE phone_hash = ?', [phoneHash]).catch(() => {});
        await db.run('DELETE FROM sys_blacklist WHERE phone_hash = ?', [phoneHash]).catch(() => {});
      }
      if (row.device_hash) {
        await db.run('DELETE FROM sys_blacklist WHERE device_fingerprint = ?', [row.device_hash]).catch(() => {});
        await db.run('DELETE FROM risk_hash_archives WHERE fingerprint = ?', [row.device_hash]).catch(() => {});
      }

      // 3. 清理 Redis 黑名单缓存 + 注册标记
      try {
        if (phoneHash) await redisClient.del(`risk:hash_bl:${phoneHash}`);
        if (row.device_hash) await redisClient.del(`risk:dev_bl:${row.device_hash}`);
        if (plainPhone) await redisClient.del(`user:registered:${plainPhone}`);
      } catch {}

      auditService.logAction(req.admin.adminId, 'KICK_USER', `id=${id} phone=${plainPhone.substring(0,3)}****${plainPhone.substring(7)}`, req.ip);
      return success(res, { id, phone: plainPhone.substring(0,3) + '****' + plainPhone.substring(7) }, '用户已踢出，可重新注册领券');
    } catch (err) { next(err); }
  }

}




module.exports = new AdminController();             