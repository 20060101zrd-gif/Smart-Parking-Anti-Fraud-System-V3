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

```
+----------------------------------------------------+
|  手机 App (React Native + Expo)                      |
|  注册领券 / 滑块验证 / 注销账号 / 风控拦截提示          |
+----------------------------------------------------+
|  后端服务 (Node.js + Express)                        |
|  中间件链: IP黑名单 --> 注册频控 --> 全局防刷 --> 手机号限流 |
|  服务层: RiskService / CaptchaService / AuthService   |
+---------------------+------------------------------+
|  Redis 7              |  MySQL 8.0                   |
|  限流计数器             |  11 张风控表 (InnoDB)          |
|  黑名单高速命中         |  手机号 AES-256 加密存储         |
|  TTL 自动过期          |  SHA256 哈希索引查重            |
+---------------------+------------------------------+
|  测试: 240 个用例 (红队渗透 + 蓝队验收)                  |
|  部署: Docker Compose 一键启动 (3 个容器)                |
+----------------------------------------------------+
```

---

## 数据安全

### 手机号 -- 双层存储

同一个手机号在系统中产生**两份不同用途**的数据：

```
用户输入的手机号: 13812345678
         |
         +--> AES-256-CBC 加密
         |    存到 sys_users.phone 列
         |    格式: iv_hex:cipher_hex（如 4b8e3a2f...:e81c7a3d...）
         |    用途: 管理员查看用户详情时解密
         |    能否还原: 能（需要密钥）
         |
         +--> SHA256 加盐哈希
              存到 sys_users.phone_hash 列
              格式: 64 位十六进制字符串
              用途: 黑名单匹配、注销库查重、注册唯一性校验
              能否还原: 不能（单向不可逆）
```

**为什么需要两份？**

查黑名单时不需要看到手机号原文，只需要知道「这个手机号是不是在黑名单里」。用 SHA256 哈希比对，比逐条 AES 解密快几个数量级，而且不需要触碰解密密钥 -- 遵循「最小化敏感信息暴露」原则。

**加密参数：**
- 算法：AES-256-CBC（密钥 32 字节，每次加密生成随机 16 字节 IV）
- 密钥来源：`.env` 中的 `ENCRYPT_KEY` --> SHA256 派生 --> 固定 32 字节
- 存储格式：`iv:cipher`（IV 和密文拼在一起，解密不需要另外查）

**用户管理与手机号解密：**

管理员后台「用户管理」页面列出所有注册用户，手机号默认脱敏显示（`138****5678`）。每行有「显示」按钮，点击后调用专用解密接口获取明文；工具栏有「显示全部明文」按钮，批量解密当前页。每次解密操作都记录审计日志 -- 确保明文手机号不会默认暴露，只在管理员主动操作且全程可追溯的情况下才显示。

### 管理员密码 -- Argon2id 慢哈希

管理员密码不存明文，用 Argon2id（2015 年国际密码哈希竞赛冠军）哈希后存储。选用参数 `memoryCost=16MB, timeCost=2` -- 每次验证约 50-100ms，正常登录无感，但显卡暴力破解每秒只能试十几次。

### 登录凭证 -- RS256 非对称 JWT

管理员登录后获得 JWT（存在 HttpOnly Cookie 中，前端 JS 读不到）。

**为什么选 RS256（非对称）而不是 HS256（对称）？**
- RS256 的私钥只在一处（签发服务的服务器上），暴露面最小
- 公钥可以安全分发给其他需要验证 JWT 的服务，即使公钥泄露也不会被伪造
- 代码里显式限制 `algorithms: ['RS256']` 防止攻击者把算法降级成 `none` 绕过签名

Cookie 安全配置：`httpOnly: true`（防 XSS 脚本窃取）、`sameSite: 'strict'`（防跨站伪造请求）。

---

## 技术选型

这里不讲「为什么不用某某技术」，只讲**选了谁、解决了什么具体问题**。

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

## 自动化测试：240 个用例

| 套件 | 用例数 | 通过率 | 评级 |
|:---|:---|:---|:---|
| 红队渗透攻击 | 26 | 100% | A+ |
| 蓝队功能验收 | 182 | 100% | 全部通过 |
| Jest 单元测试 | 32 | 100% | 全部通过 |
| **合计** | **240** | **100%** | -- |

- **红队（渗透攻击）**：JWT 伪造、SQL 注入、Token 重放、黑名单膨胀注入、暴力注册压测（13,696 次请求，1,369 QPS）
- **蓝队（功能验收）**：三级分级、IP 封禁、滑块攻防、白名单豁免、拦截日志完整性、健康探针、优雅关闭
- **Jest 单元测试**：`risk.service` + `encryption` 纯逻辑测试

```bash
cd tests && npm install && node index.js    # 一键运行
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

### C 端（用户使用）

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| `POST` | `/api/v1/user/register` | 注册领券（经过四层中间件链） |
| `POST` | `/api/v1/user/verify-captcha` | 滑块验证 + 注册（需 captchaToken） |
| `POST` | `/api/v1/user/cancel` | 注销账号（触发设备 + 手机号 90 天黑名单） |
| `GET` | `/api/v1/captcha/generate` | 获取滑块验证码（答案存 Redis，60s 过期） |
| `POST` | `/api/v1/captcha/verify` | 提交滑块位置（+-5px 容差，答案验证后立即删除防重放） |

### B 端（管理员使用）

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| `POST` | `/api/v1/admin/login` | 管理员登录（Argon2id 验证密码 --> RS256 JWT --> Cookie） |
| `GET` | `/api/v1/admin/overview` | 风控大盘（今日拦截数 / 用户总数 / 黑名单数 / 趋势图） |
| `GET` | `/api/v1/admin/intercept-logs` | 拦截日志分页（支持 IP / 时间范围筛选） |
| `PUT` | `/api/v1/admin/config` | 动态调整风控规则阈值 |
| `GET` | `/api/v1/admin/blacklist` | 黑名单分页（MySQL + Redis 双源合并，支持手机号搜索） |
| `POST` | `/api/v1/admin/blacklist/add` | 手动添加黑名单 |
| `POST` | `/api/v1/admin/blacklist/remove` | 解封黑名单 |
| `POST` | `/api/v1/admin/blacklist/unban-phone` | 按手机号解封（同时清理 Redis + MySQL） |
| `GET` | `/api/v1/admin/whitelist` | 白名单列表 |
| `POST` | `/api/v1/admin/whitelist/add` | 添加白名单（豁免所有风控检查） |
| `POST` | `/api/v1/admin/whitelist/remove` | 移除白名单 |
| `GET` | `/api/v1/admin/users` | 用户列表（AES 解密后脱敏展示，分页，支持手机号/姓名搜索） |
| `GET` | `/api/v1/admin/users/phone/:id` | 按 ID 解密单个用户手机号（含审计日志） |
| `POST` | `/api/v1/admin/users/decrypt-phones` | 批量解密手机号（含审计日志，最多 100 条） |
| `GET` | `/api/v1/health` | 存活探针 |
| `GET` | `/api/v1/health/ready` | 就绪探针（MySQL + Redis 连接状态） |

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

- **安全登录** -- Argon2id 密码校验 + RS256 JWT

  <img src="screenshots/b-admin-login.png" width="600" />

- **风控监控大盘** -- 实时拦截趋势、用户统计、黑名单数

  <img src="screenshots/b-admin-dashboard.png" width="600" />

- **拦截日志** -- 每条拦截的 IP、设备哈希、原因、风险等级

  <img src="screenshots/b-intercept-logs.png" width="600" />

- **黑名单管理** -- 支持手机号搜索、手动添加、解封

  <img src="screenshots/b-blacklist.png" width="600" />

- **白名单管理** -- 免检 VIP 通道

  <img src="screenshots/b-whitelist.png" width="600" />

- **规则配置** -- 在线调整限流阈值、黑名单天数

  <img src="screenshots/b-rules-config.png" width="600" />

- **用户管理（脱敏状态）** -- 手机号 AES 解密后脱敏显示（`138****5678`），按手机号搜索时自动转 SHA256 哈希匹配；操作列提供「显示」按钮，工具栏提供「显示全部明文」

  <img src="screenshots/b-users-list.png" width="600" />

- **用户管理（明文显示）** -- 点击「显示全部明文」后，手机号变为绿色完整明文，操作列按钮变为「隐藏」；再次点击可切换回脱敏状态。所有解密操作记入审计日志

  <img src="screenshots/b-users-revealed.png" width="600" />

### 基础设施

- **Docker 容器** -- 三个服务（backend / redis / mysql）全部运行中

  <img src="screenshots/infra-docker.png" width="600" />

- **Redis 黑名单 Key** -- `redis-cli KEYS pf:risk:*` 展示缓存中的黑名单

  <img src="screenshots/infra-redis.png" width="600" />

- **MySQL 用户表** -- `phone` 列为 AES-256-CBC 密文，非明文

  <img src="screenshots/infra-mysql-users.png" width="600" />

- **MySQL 拦截日志表** -- 原因、风险等级、时间戳

  <img src="screenshots/infra-mysql-logs.png" width="600" />

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
