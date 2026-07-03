# 智能停车风控反欺诈系统

> Smart Parking Anti-Fraud System — 全栈风控平台，覆盖 C 端领券 + B 端管控 + 红蓝对抗测试

![Tests](https://img.shields.io/badge/Tests-240/240%20Passed-brightgreen) ![Node.js](https://img.shields.io/badge/Node.js-18.x-green) ![Docker](https://img.shields.io/badge/Docker-Supported-blue) ![License](https://img.shields.io/badge/License-MIT-yellow)

这是一个全栈智能停车风控反欺诈项目，针对线下停车场景中羊毛党恶意刷取新人优惠券的业务痛点，完整覆盖 C 端用户注册领券业务闭环与 B 端风控管理后台。系统核心设计了多道防线：基于 Redis 的滑动窗口限流、Argon2id 不可逆设备指纹黑名单、RS256 非对称 JWT 身份鉴权、AES-256-CBC 手机号加密存储，以及 MySQL + Redis 双层数据架构。

---

## 一、测试结果全景

| 测试套件 | 用例数 | 通过率 | 评级 |
| :--- | :--- | :--- | :--- |
| Red Team 渗透攻击 | 26 | **100%** | A+ (卓越) |
| Blue Team 功能验收 | 182 | **100%** | 全部通过 |
| Jest 单元测试 | 32 | **100%** | 全部通过 |
| **合计** | **240** | **100%** | — |

<details>
<summary>Red Team 渗透测试详情</summary>

| 模块 | 攻击项 | 防线守住 | 通过率 | 评级 |
| :--- | :--- | :--- | :--- | :--- |
| 风控核心渗透 | 16 | 16 | 100% | A+ |
| 数据层安全 (SQL注入/密钥绕过) | 4 | 4 | 100% | A+ |
| 管理后台攻防 (JWT/越权) | 6 | 6 | 100% | A+ |
| 恶意重刷压测 | 13,696 次 | 1,369 QPS / 6.8ms | — | — |
| JWT 伪造攻击 | 2 | 全部拦截 | — | — |
| 黑名单膨胀注入 | 100 | 97 被限流 (97%) | — | — |

</details>

<details>
<summary>Blue Team 功能验收详情</summary>

| 模块 | 用例数 | 通过 | 通过率 |
| :--- | :--- | :--- | :--- |
| 风控核心 (三级分级/IP黑名单/滑块/白名单) | 69 | 69 | 100% |
| 数据层 (表结构/读写一致/并发/事务/加密) | 8 | 8 | 100% |
| 管理员后台 (登录/限流/黑名单CRUD/概览) | 10 | 10 | 100% |
| 工程化改造 (统一格式/JWT鉴权/权限拦截) | 10 | 10 | 100% |
| App 配置校验 (app.json/eas.json/资源/依赖) | 29 | 29 | 100% |
| 健康探针端点 (存活/就绪/MySQL降级/Redis降级) | 44 | 44 | 100% |
| 优雅关闭验证 (SIGTERM/SIGKILL/资源释放) | 12 | 12 | 100% |

</details>

<details>
<summary>Jest 单元测试详情</summary>

| 套件 | 用例 | 通过 |
| :--- | :--- | :--- |
| `risk.service.test.js` | 18 | 18 |
| `encryption.test.js` | 14 | 14 |

</details>

---

## 二、系统功能演示

### C 端用户链路

| 注册领券 | 注册成功 | 已有账户 |
| :---: | :---: | :---: |
| ![](screenshots/c-register-page.jpg) | ![](screenshots/c-register-success.jpg) | ![](screenshots/c-coupon-active.jpg) |

| 账号注销 | 风控拦截 | 滑块验证 |
| :---: | :---: | :---: |
| ![](screenshots/c-cancel-confirm.jpg) | ![](screenshots/c-risk-blocked.jpg) | ![](screenshots/c-captcha-slider.jpg) |

### B 端管理后台

* **安全登录页**
  <img src="screenshots/b-admin-login.png" />

* **风控监控大盘**
  <img src="screenshots/b-admin-dashboard.png" />

* **拦截日志列表**
  <img src="screenshots/b-intercept-logs.png" />

* **黑名单管理**
  <img src="screenshots/b-blacklist.png" />

* **白名单管理**
  <img src="screenshots/b-whitelist.png" />

* **风控规则配置**
  <img src="screenshots/b-rules-config.png" />

### 基础设施

| Docker 容器状态 | Redis 风控黑名单 |
| :---: | :---: |
| <img src="screenshots/infra-docker.png" width="480" /> | <img src="screenshots/infra-redis.png" width="480" /> |

| MySQL sys_users 表 | MySQL risk_intercept_logs 表 |
| :---: | :---: |
| <img src="screenshots/infra-mysql-users.png" width="480" /> | <img src="screenshots/infra-mysql-logs.png" width="480" /> |

---

## 三、核心风控能力

### 三级风险分级

```
LOW (正常)    -> 直接注册，发放停车券
MEDIUM (频控) -> 触发滑块人机验证 (40101)
HIGH (黑名单) -> 直接拒绝 (40300/40301/40302)
```

* **设备指纹黑名单**：注销后 90 天冷冻，同一设备无法重新注册 (40301)
* **IP 临时黑名单**：连续 3 次验证失败后自动封禁 24h (40302)
* **手机号注销库**：SHA256 加盐哈希沉淀，换设备也无法绕过 (40300)
* **IP 注册频控**：60s 内超过 5 次触发中风险人机验证
* **注销频控**：10min 内超过 4 次触发 429 熔断

### 数据安全

* 手机号 AES-256-CBC 加密存储 (密文格式 `iv:cipher`)
* 设备指纹 Argon2id 不可逆哈希
* JWT RS256 非对称签名 (防伪造/篡改)
* SQL 注入全量拦截
* Redis 内存降级 (宕机时不崩溃)

---

## 四、技术栈

| 层 | 技术 |
| :--- | :--- |
| 移动端 | Expo SDK 54, React Native |
| 后端 | Node.js 18, Express.js |
| 数据库 | MySQL 8.0 (InnoDB, utf8mb4) |
| 缓存 | Redis 7 (Alpine, RDB 持久化) |
| 安全 | Argon2id, JWT RS256, AES-256-CBC |
| 测试 | Jest, Autocannon (压测), 红蓝对抗套件 |
| 运维 | Docker Compose, 健康探针, 优雅关闭 |
| CI/CD | GitHub Actions, Codemagic (iOS unsigned IPA) |

---

## 五、项目结构

```text
parking-fraud-system/
├── backend/
│   ├── src/
│   │   ├── controllers/    # 用户 & 管理员控制器
│   │   ├── services/       # 风控 / 审计 / 验证码 / 白名单
│   │   ├── middlewares/    # 限流 / JWT / 验证码Token / 黑名单
│   │   ├── data/           # Redis 客户端 / MySQL 连接池
│   │   ├── routes/         # API 路由 (v1)
│   │   └── utils/          # 加密 / 日志 / 响应
│   ├── public/             # 管理后台静态页面
│   ├── sql/                # MySQL 初始化脚本
│   ├── Dockerfile
│   └── jest.config.js
├── mobile/
│   ├── src/
│   │   ├── screens/        # 注册 / 领券 / 注销
│   │   └── components/     # 滑块验证码
│   └── App.js
├── tests/
│   ├── red-team/           # 6 个渗透攻击模块 + run.js
│   ├── blue-team/          # 7 个功能验收模块 + run.js
│   ├── unit/               # Jest 单元测试 + run.js
│   ├── reports/            # 自动生成的 .md / .txt 战报
│   └── index.js            # 一键运行全部测试
├── screenshots/
├── docker-compose.yml
├── redis.conf
└── README.md
```

---

## 六、核心 API 清单

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `POST` | `/api/v1/user/register` | C 端注册领券 (三级风险分级) |
| `POST` | `/api/v1/user/cancel` | C 端注销 (PII 擦除 + 90 天冷冻) |
| `POST` | `/api/v1/user/verify-captcha` | C 端滑块验证 + 注册 |
| `GET` | `/api/v1/captcha/generate` | 获取滑块验证码 |
| `POST` | `/api/v1/captcha/verify` | 提交滑块位置 |
| `POST` | `/api/v1/admin/login` | B 端登录 (RS256 JWT) |
| `GET` | `/api/v1/admin/overview` | 风控大盘数据 |
| `GET` | `/api/v1/admin/intercept-logs` | 拦截日志分页 |
| `GET` | `/api/v1/admin/blacklist` | 黑名单分页 |
| `POST` | `/api/v1/admin/blacklist/add` | 添加黑名单 |
| `POST` | `/api/v1/admin/blacklist/remove` | 移除黑名单 |
| `GET` | `/api/v1/admin/whitelist` | 白名单查询 |
| `POST` | `/api/v1/admin/whitelist/add` | 添加白名单 |
| `PUT` | `/api/v1/admin/config` | 修改风控规则阈值 |
| `GET` | `/api/v1/health` | 存活探针 |
| `GET` | `/api/v1/health/ready` | 就绪探针 (MySQL+Redis 状态) |

---

## 七、快速启动

### 前置要求

* Docker & Docker Compose
* Node.js 18+
* 或：本地 MySQL 8.0 + Redis 7

### 1. 克隆 & 配置

```bash
git clone https://github.com/20060101zrd-gif/Smart_Parking_Anti_Fraud_System_V3.git
cd Smart_Parking_Anti_Fraud_System_V3
cp .env.example .env       # 编辑 .env 中的密码
```

### 2. 一键启动 (Docker)

```bash
docker-compose up -d --build
# 管理后台: http://localhost:3000
# 管理后台单页: http://localhost:3000/index.html
```

### 3. 裸机开发

```powershell
# PowerShell: 覆盖 Docker 容器名 -> 127.0.0.1
$env:REDIS_HOST="127.0.0.1"; $env:MYSQL_HOST="127.0.0.1"; $env:MYSQL_PORT="3307"
cd backend && npm install && node src/index.js
```

### 4. 运行测试

```bash
cd tests
npm install
node index.js                 # 一键：红队 + 蓝队
node red-team/run.js          # 仅 Red Team 渗透
node blue-team/run.js         # 仅 Blue Team 验收
node unit/run.js              # 仅 Jest 单元测试
```

测试报告自动输出到 `tests/reports/`。

---

## 八、CI/CD

本项目同时配置了 GitHub Actions (`.github/workflows/test.yml`) 和 Codemagic (`codemagic.yaml`) 两条 CI 管线：

**GitHub Actions** — 自动化测试

* **触发条件**: master/main 分支 push / PR
* **流程**: `npm ci` -> Jest 单元测试 -> Docker Compose 启动 -> Red Team + Blue Team 全量测试
* **环境**: ubuntu-latest, Node 20

**Codemagic** — iOS unsigned IPA 构建

* **触发条件**: main 分支 push / PR
* **环境**: Node 20, Xcode 16
* **流程**: `npm install` -> `expo prebuild` -> `xcodebuild archive` -> `.ipa`
* **产物**: `mobile/unsigned.ipa`

---

## 九、方案边界与局限性

* **架构扩展**：当前为单节点容器化部署，若演进为分布式集群，需引入 Redis 分布式锁以解决跨节点的防刷并发一致性问题。
* **风控维度**：当前核心拦截特征以手机号哈希与 IP 滑动窗口为主，暂未接入端设备底层的硬件物理指纹采集。
* **审计日志**：管理后台的操作审计日志目前仅 MySQL 本地持久化归档，暂未对接 ELK 等外部集中式日志监控系统。

---

## 十、开源协议

MIT License — 详见 [LICENSE](LICENSE)
