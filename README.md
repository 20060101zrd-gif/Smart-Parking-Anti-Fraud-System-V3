# Parking Guard -- 智能停车风控反欺诈系统

> 全栈风控平台，防羊毛党刷取停车场新人优惠券

![Tests](https://img.shields.io/badge/Tests-240/240%20Passed-brightgreen) ![Node.js](https://img.shields.io/badge/Node.js-18.x-green) ![Docker](https://img.shields.io/badge/Docker-Supported-blue) ![License](https://img.shields.io/badge/License-MIT-yellow)

---

## 这个系统是做什么的？

商场停车场搞推广活动 -- **新用户注册就送一张免费停车券**。

结果来了羊毛党：他们用脚本批量注册假账号，领取停车券，注销后再注册……无限循环薅羊毛。

这个系统做三件事：**识别作弊行为、自动拦截、同时让正常用户不受影响**。

就像停车场门口的一个智能保安：好人直接进，可疑的人做个拼图验证（证明你是人不是机器），确定是坏人的直接拦住。

---

## 系统怎么防？

四道防线，层层过滤每一次注册请求：

```
用户点击「注册领券」
      |
      v
[第一道：IP 频控]
同一网络地址 60 秒内注册超过 5 次
--> 弹出滑块拼图验证码（40101）
      | 通过
      v
[第二道：设备黑名单]
注销时生成不可逆设备指纹，拉入 90 天黑名单
--> 同一部手机换号也无法重新注册（40301）
      | 通过
      v
[第三道：手机号注销库]
注销时手机号 SHA256 哈希沉淀到注销库
--> 同一手机号换设备也无法绕过（40300）
      | 通过
      v
[第四道：验证码失败锁定]
10 分钟内验证码连续失败 3 次
--> IP 自动封禁 24 小时（40302）
      | 通过
      v
  注册成功，发放停车券
```

| 场景 | 触发条件 | 系统反应 | 错误码 |
|:---|:---|:---|:---|
| 正常注册 | 无异常 | 直接通过，发券 | 20000 |
| 同 IP 注册太频繁 | 60s 内 5+ 次 | 弹出滑块验证码 | 40101 |
| 验证码连续失败 | 10min 内 3+ 次 | IP 封禁 24 小时 | 40302 |
| 注销过的设备重注册 | 设备在 90 天黑名单 | 直接拒绝 | 40301 |
| 注销过的手机号重注册 | 手机号在注销库 | 直接拒绝 | 40300 |
| 疯狂点注销 | 10min 内 4+ 次 | 熔断拒绝 (429) | 42900 |
| 白名单用户 | 管理员手动添加 | 免检全部风控 | -- |

---

## 系统整体结构

| 层 | 技术 | 职责 |
|:---|:---|:---|
| 手机 App | React Native + Expo | 注册领券 / 滑块验证 / 注销账号 / 风控拦截提示 |
| 后端服务 | Node.js + Express | 四层中间件链 + RiskService / CaptchaService / AuthService |
| 缓存 | Redis 7 | 限流计数器 / 黑名单高速命中 / TTL 自动过期 |
| 数据库 | MySQL 8.0 | 11 张风控表 (InnoDB) / 手机号 AES-256 加密 / SHA256 哈希索引 |
| 测试 | 240 用例 | 红队渗透 + 蓝队验收 + Jest 单元测试 |
| 部署 | Docker Compose | 3 个容器（backend / redis / mysql）一键启动 |

---

## 系统截图

### C 端（手机 App）

| 注册页面 | 注册成功 | 已有优惠券 |
|:---:|:---:|:---:|
| ![](screenshots/c-register-page.jpg) | ![](screenshots/c-register-success.jpg) | ![](screenshots/c-coupon-active.jpg) |

| 注销确认 | 风控拦截 | 滑块验证 |
|:---:|:---:|:---:|
| ![](screenshots/c-cancel-confirm.jpg) | ![](screenshots/c-risk-blocked.jpg) | ![](screenshots/c-captcha-slider.jpg) |

### B 端（管理后台）

**安全登录**

<img src="screenshots/b-admin-login.png" width="600" />

**风控监控大盘**

<img src="screenshots/b-admin-dashboard.png" width="600" />

**拦截日志**

<img src="screenshots/b-intercept-logs.png" width="600" />

**黑名单管理**

<img src="screenshots/b-blacklist.png" width="600" />

**白名单管理**

<img src="screenshots/b-whitelist.png" width="600" />

**规则配置**

<img src="screenshots/b-rules-config.png" width="600" />

**用户管理（脱敏）**

<img src="screenshots/b-users-list.png" width="600" />

**用户管理（明文）**

<img src="screenshots/b-users-revealed.png" width="600" />

### 基础设施

**Docker 容器**

<img src="screenshots/infra-docker.png" width="600" />

**Redis 黑名单 Key**

<img src="screenshots/infra-redis.png" width="600" />

**MySQL 用户表（密文）**

<img src="screenshots/infra-mysql-users.png" width="600" />

**MySQL 拦截日志**

<img src="screenshots/infra-mysql-logs.png" width="600" />

---

## 数据安全

### 手机号：双层存储

同一个手机号产生两份数据，各司其职：

```
13812345678
   |
   +--> sys_users.phone (AES-256-CBC 加密)
   |    格式: iv:cipher
   |    可逆: 是，需 ENCRYPT_KEY 解密
   |    用途: 管理员查看用户详情
   |
   +--> sys_users.phone_hash (SHA256 加盐哈希)
        格式: 64 位 hex
        可逆: 否，单向不可逆
        用途: 黑名单匹配、查重
```

**为什么两份？**

- 查黑名单只需要「是或否」，SHA256 比对比逐条解密快几个数量级
- 哈希操作不触碰解密密钥，遵循最小化敏感信息暴露原则

**加密细节**

- AES-256-CBC，密钥来自 `.env` 的 `ENCRYPT_KEY` 经 SHA256 派生为 32 字节
- 每次加密随机生成 16 字节 IV，格式 `iv:cipher`，自包含
- 随机 IV 确保相同手机号每次加密结果不同，阻断频率分析

### 用户管理：手机号显示与隐藏

管理员后台默认显示脱敏手机号（`138****5678`）。

- 每行「显示」按钮：调用 `/users/phone/:id` 获取明文
- 工具栏「显示全部明文」：批量解密当前页
- 每次解密操作写入审计日志，全程可追溯
- 明文显示后按钮变为「隐藏」，可一键切换回脱敏

### 管理员密码：Argon2id

密码不存明文，用 Argon2id（2015 年密码哈希竞赛冠军）保存。

参数 `memoryCost=16MB, timeCost=2`：正常登录 50-100ms 无感，GPU 暴力破解每秒仅十几次。

### 登录凭证：RS256 JWT

登录后 JWT 存 HttpOnly Cookie，前端 JS 不可读。

选择 RS256（非对称）的理由：

- 私钥仅签发服务持有，暴露面最小
- 公钥可安全分发验证，泄露不影响安全
- `algorithms: ['RS256']` 防止 `alg: none` 降级攻击

Cookie 加固：`httpOnly` 防 XSS，`sameSite: strict` 防 CSRF。

---

## 技术选型

### Node.js + Express（后端框架）

**解决什么问题**：JavaScript 全栈，移动端 React Native 和后端用同一种语言，一个人能搞定前后端。Express 的中间件是洋葱圈模型，可以像搭积木一样把限流、鉴权、校验串起来 -- 本项目用到的四层中间件链就是最直接的例子：

```javascript
router.post('/register',
  ipBlacklist,      // 第一层：检查 IP 是否在 24h 封禁中
  regIpLimiter,     // 第二层：60s 内超 5 次触发验证码
  globalIpLimiter,  // 第三层：全局 10 次/秒防刷
  phoneLimiter,     // 第四层：单手机号 1 次/5 秒
  userController.register
);
```

风控系统是 IO 密集型（大量的 Redis/MySQL 网络请求），Node.js 的事件循环 + 非阻塞 IO 天然适合。

### MySQL 8.0（持久化存储）

**解决什么问题**：风控系统的核心数据（用户、黑名单、拦截日志、审计记录）天然是结构化关系数据。InnoDB 引擎的行级锁和 MVCC 保证高并发注册下读写不互斥。参数化查询（`?` 占位符）天然防 SQL 注入。

注销操作涉及 5 步（删除用户、写黑名单、写归档、写设备黑名单、同步 Redis），MySQL 的事务（`BEGIN/COMMIT`）保证要么全做要么全不做。

### Redis 7（缓存与限流引擎）

**解决什么问题**：限流计数器必须极快响应，而且必须是**原子操作**。Redis 的 `INCR` 命令是单线程原子执行的，两个请求同时来不会出现「都读到旧值 3，都 +1 写成 4」的竞态问题。

Redis `EXPIRE` 天然支持滑动窗口的时间重置 -- 第一个请求设 60 秒 TTL，窗口内的请求共享这个倒计时，窗口结束自动清零，不需要额外的定时清理任务。

**Redis 宕机也不会崩**：限流自动切到内存 Map + setTimeout，黑名单切到内存 Set，验证码答案切到内存缓存。每个模块都有 `if (!redisClient.isReady)` 的降级路径。

### React Native + Expo（移动端）

**解决什么问题**：一套代码同时跑 iOS 和 Android。作为个人全栈项目，精力应该花在风控逻辑上而不是原生适配。Expo 把 Xcode/Android Studio 的原生配置细节封装掉，开发聚焦在业务页面。

### Docker Compose（部署）

**解决什么问题**：三个服务（后端、MySQL、Redis）有启动依赖 -- MySQL 必须先完全就绪后后端才能启动。Docker Compose 的 `depends_on` + `condition: service_healthy` 保证正确顺序。命名卷（`redis_data`、`mysql_data`）保证容器重启后数据不丢。

内置健康探针：`/health`（存活探针，返回 200 表示进程在线）、`/health/ready`（就绪探针，TCP 直连检测 MySQL + Redis，3 秒超时）。从宕机恢复时自动预热连接池。

---

## 自动化测试

测试报告自动生成于 `tests/reports/`。

### 红队渗透测试：26 用例，100% 通过，评级 A+

| 模块 | 攻击项 | 防线守住 | 评级 |
|:---|:---|:---|:---|
| 风控核心渗透 | 16 | 16 | A+ |
| 数据层安全（SQL 注入 / 密钥绕过） | 4 | 4 | A+ |
| 管理后台攻防（JWT 伪造 / 越权） | 6 | 6 | A+ |

- 恶意重刷压测：**13,696 次请求，1,369 QPS，平均延迟 6.8ms**
- JWT 伪造攻击：**2 次非法伪造全部拦截，0 次越权**
- 黑名单膨胀注入：**100 条，97 条被限流拦截（97%）**

### 蓝队功能验收：182 用例，100% 通过

| 模块 | 用例 | 通过 | 备注 |
|:---|:---|:---|:---|
| 风控核心（三级分级 / IP 封禁 / 滑块 / 白名单） | 69 | 69 | 耗时 241s |
| 数据层（表结构 / 读写一致 / 并发 / 事务 / 加密） | 8 | 8 | -- |
| 管理员后台（登录 / 限流 / 黑名单 CRUD / 概览） | 10 | 10 | -- |
| 工程化改造（统一格式 / JWT 鉴权 / 权限拦截） | 10 | 10 | -- |
| App 配置校验（app.json / eas.json / 资源 / 依赖） | 29 | 29 | -- |
| 健康探针（存活 / 就绪 / MySQL 降级 / Redis 降级） | 44 | 44 | 耗时 53s |
| 优雅关闭（SIGTERM / SIGKILL / 资源释放） | 12 | 12 | 耗时 25s |

### Jest 单元测试：32 用例，100% 通过

- `risk.service.test.js`：18 用例全部通过
- `encryption.test.js`：14 用例全部通过

```bash
cd tests && npm install && node index.js    # 一键运行全部测试
```

---

## 快速启动

### 1. 克隆并配置

```bash
git clone https://github.com/20060101zrd-gif/Smart_Parking_Anti_Fraud_System_V3.git
cd Smart_Parking_Anti_Fraud_System_V3
cp .env.example .env       # 编辑 .env 中的密码
```

### 2. 一键启动

```bash
docker-compose up -d --build

# 风控管理后台:  http://localhost:3000/index.html
# 用户管理页面:  http://localhost:3000/users.html
```

### 3. 一键解密手机号（命令行工具）

```bash
cd backend
node decrypt.js              # 脱敏模式（138****5678），截图安全
node decrypt.js --full       # 完整手机号
node decrypt.js --limit=10   # 只看最近 10 条
node decrypt.js --help       # 帮助
```

### 4. 运行测试

```bash
cd tests && npm install
node index.js
```

---

## API 接口清单

### C 端（用户）

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| `POST` | `/api/v1/user/register` | 注册领券，经过四层中间件链 |
| `POST` | `/api/v1/user/verify-captcha` | 滑块验证 + 注册 |
| `POST` | `/api/v1/user/cancel` | 注销账号，触发 90 天黑名单 |
| `GET` | `/api/v1/captcha/generate` | 获取滑块验证码 |
| `POST` | `/api/v1/captcha/verify` | 提交滑块位置，答案一次性核销 |

### B 端（管理员）

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| `POST` | `/api/v1/admin/login` | 登录，返回 JWT Cookie |
| `GET` | `/api/v1/admin/overview` | 风控大盘数据 |
| `GET` | `/api/v1/admin/intercept-logs` | 拦截日志，支持 IP/日期筛选 |
| `PUT` | `/api/v1/admin/config` | 动态调整风控规则 |
| `GET` | `/api/v1/admin/blacklist` | 黑名单，双源合并 + 手机号搜索 |
| `POST` | `/api/v1/admin/blacklist/add` | 手动添加黑名单 |
| `POST` | `/api/v1/admin/blacklist/remove` | 移除黑名单 |
| `POST` | `/api/v1/admin/blacklist/unban-phone` | 按手机号解封 |
| `GET` | `/api/v1/admin/whitelist` | 白名单列表 |
| `POST` | `/api/v1/admin/whitelist/add` | 添加白名单 |
| `POST` | `/api/v1/admin/whitelist/remove` | 移除白名单 |
| `GET` | `/api/v1/admin/users` | 用户列表，脱敏 + 分页 + 搜索 |
| `GET` | `/api/v1/admin/users/phone/:id` | 单用户手机号解密 |
| `POST` | `/api/v1/admin/users/decrypt-phones` | 批量解密，最多 100 条 |
| `GET` | `/api/v1/health` | 存活探针 |
| `GET` | `/api/v1/health/ready` | 就绪探针 |

> 解密接口均有审计日志记录。

---

## 项目结构

```text
parking-fraud-system/
+-- backend/
|   +-- src/
|   |   +-- controllers/    # 用户 & 管理员控制器
|   |   +-- services/       # 风控 / 审计 / 验证码 / 白名单
|   |   +-- middlewares/    # 限流 / JWT / 验证码Token / 黑名单
|   |   +-- data/           # Redis 客户端 / MySQL 连接池
|   |   +-- routes/         # API 路由 (v1)
|   |   +-- utils/          # 加密 / 日志 / 响应
|   +-- public/             # 管理后台（风控大盘 + 用户管理 SPA）
|   +-- sql/                # MySQL 初始化脚本
|   +-- decrypt.js          # 命令行工具：一键解密用户手机号
|   +-- Dockerfile
+-- mobile/
|   +-- src/
|   |   +-- screens/        # 注册 / 领券 / 注销
|   |   +-- components/     # 滑块验证码
|   +-- App.js
+-- tests/
|   +-- red-team/           # 6 个渗透攻击模块
|   +-- blue-team/          # 7 个功能验收模块
|   +-- unit/               # Jest 单元测试
|   +-- reports/            # 自动生成测试报告
|   +-- index.js            # 一键运行全部测试
+-- screenshots/
+-- docker-compose.yml
+-- redis.conf
+-- README.md
```

---

## CI/CD

**GitHub Actions** -- push/PR 触发全量自动化测试：`npm ci` --> Jest --> Docker Compose 启动 --> 红队 + 蓝队

**Codemagic** -- main 分支 push 触发 iOS unsigned IPA 构建

---

## 已知局限

- **分布式扩展**：当前单节点部署。多节点集群可基于已有 Redis 加 Redlock 分布式锁，解决跨节点计数器一致性。
- **风控维度**：当前以手机号哈希 + IP 为主，可扩展接入设备硬件物理指纹（传感器特征、屏幕参数等）。
- **日志监控**：当前拦截日志存 MySQL，可接入 ELK / Grafana 实现实时告警与可视化。

---

## 开源协议

MIT License -- 详见 [LICENSE](LICENSE)
