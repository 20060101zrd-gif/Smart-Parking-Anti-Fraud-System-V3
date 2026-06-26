# 智能停车风控反欺诈系统 (Smart Parking Anti-Fraud System)

![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg) ![Docker](https://img.shields.io/badge/Docker-Supported-blue.svg) ![License](https://img.shields.io/badge/License-MIT-yellow.svg)

这是一个企业级的全栈风控反欺诈系统，致力于解决线下智能停车场景中“羊毛党”恶意刷取新人停车券的问题，完整覆盖 C 端用户业务闭环与 B 端管控后台。系统内建双写数据层、不可逆设备指纹、Redis 滑动窗口限流以及 RS256 非对称 JWT 鉴权等核心防线。

---

## 一、核心商业价值

1. **营销预算防损**：通过缓存状态记忆与设备指纹，有效对抗接码平台批量领券。
2. **注销合规风控闭环**：采用 Argon2id 不可逆哈希，物理擦除 PII 的同时实现 90 天风控冷冻，彻底阻断黑产通过“注销后重新注册”来无限刷券的漏洞。
3. **阻断慢速膨胀注入**：在核心接口前置 Redis INCR 滑动窗口限流，精准熔断慢速攻击。
4. **内部权限保护**：采用 RS256 非对称加密签发 JWT，从根本上杜绝凭证篡改与越权。

---

## 二、系统功能演示

### C 端用户链路

| 注册领券 | 领券成功 | 防重复领券 | 注销确认 | 防注销重刷拦截 |
| :--- | :--- | :--- | :--- | :--- |
| ![注册领券](screenshots/c-register-page.jpg) | ![领券成功](screenshots/c-register-success.jpg) | ![防重复领券](screenshots/c-coupon-active.jpg) | ![注销确认](screenshots/c-cancel-confirm.jpg) | ![防注销重刷拦截](screenshots/c-risk-blocked.jpg) |

### B 端管理后台

* **安全登录页**
  ![安全登录页](screenshots/b-admin-login.png)
* **风控监控大盘**
  ![风控监控大盘](screenshots/b-admin-dashboard.png)

---

## 三、技术栈

| 模块 | 技术架构 |
| :--- | :--- |
| **C端移动端** | Expo, React Native |
| **后端框架** | Node.js, Express.js |
| **持久化存储** | SQLite (历史归档/操作审计) |
| **高速缓存** | Redis (状态记忆/JWT黑名单/限流熔断) |
| **安全算法** | Argon2id, JWT (RS256) |
| **运维部署** | Docker, Alpine Linux |

---

## 四、核心 API 清单

* `POST /api/v1/user/register`：C 端领券（含设备指纹比对与防刷校验）
* `POST /api/v1/user/cancel`：C 端注销（PII 物理擦除与 90 天特征冻结）
* `POST /api/v1/admin/login`：B 端登录（校验并签发 RS256 非对称凭证）
* `GET /api/v1/admin/dashboard`：B 端大盘（风控黑名单与操作审计查询）

---

## 五、项目目录结构

```text
Smart_Parking_Anti_Fraud_System/
├── backend/                  # 核心后端服务，内含 .keys 密钥目录、src 源码、Dockerfile
├── mobile/                   # C 端移动端应用
├── tests/                    # 自动化安全渗透套件，内含 src 测试脚本、reports 战报、index.js 主控入口
├── screenshots/              # UI 演示截图
├── docker-compose.yml        # 容器编排配置
└── README.md                 # 项目说明
```

---

## 六、自动化安全渗透测试

本项目原生内置自动化安全渗透套件，具备一键压测、越权探测与限流绕过测试能力。
系统具备极高的并发处理性能，单节点（测试环境：4 核 8G）抗压指标达到 **6000+ QPS**。测试完成后，完整战报会自动生成在 `tests/reports/` 目录下。

**安全战报示例：**

```text
# 智能停车风控系统 - 安全渗透测试战报

- 恶意重刷: 61060 次请求, 6106.4 QPS, 1.15ms 延迟 -> 防御成功
- JWT 伪造: 拦截非法伪造 2 次 -> 防御成功
- 黑名单膨胀: 拦截 100 条慢速注入 (HTTP 429) -> 防御成功
```

---

## 七、快速启动

1. **克隆项目仓库**
```bash
git clone [https://github.com/YourUsername/Smart_Parking_Anti_Fraud_System.git](https://github.com/YourUsername/Smart_Parking_Anti_Fraud_System.git)
cd Smart_Parking_Anti_Fraud_System
```

2. **环境变量配置**
首次运行请在 `backend/` 目录下复制模板并配置文件：
```bash
# Linux / macOS 
cp backend/.env.example backend/.env

# Windows (PowerShell / CMD)
copy backend\.env.example backend\.env
```

3. **一键容器化启动（推荐）**
启动后可访问 `http://localhost:3000` 进入管理后台：
```bash
docker-compose up -d --build
```

4. **本地非 Docker 启动（可选）**
若不想使用 Docker，也可在本地直接启动（需提前运行 Redis）：
```bash
cd backend
npm install
node src/index.js
```

5. **执行安全审计**
```bash
# 请确保在项目根目录下执行
cd tests
node index.js
```

---

## 八、方案边界与局限性

* **架构扩展**：当前为单节点容器化部署，若演进为分布式集群，需引入 Redis 分布式锁以解决跨节点的防刷并发一致性问题。
* **风控维度**：当前核心拦截特征以手机号哈希与 IP 滑动窗口为主，暂未接入端设备底层的硬件物理指纹采集。
* **审计日志**：管理后台的操作审计日志目前仅做 SQLite 本地持久化归档，暂未对接 ELK 等外部集中式日志监控系统。

---

## 九、开源协议

本项目基于 **MIT License** 开源，详情请参见仓库根目录下的 [LICENSE](LICENSE) 文件。