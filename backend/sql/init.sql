-- ============================================================
-- parking-fraud-system 全量建表脚本 (MySQL 8.0)
-- docker-compose 启动时自动执行
-- ============================================================

-- 1. 管理员账号表
CREATE TABLE IF NOT EXISTS sys_admins (
    id              INT           AUTO_INCREMENT PRIMARY KEY,
    username        VARCHAR(128)  NOT NULL UNIQUE               COMMENT '管理员用户名',
    password_hash   VARCHAR(255)  NOT NULL                      COMMENT 'Argon2id 密码哈希',
    status          TINYINT       NOT NULL DEFAULT 1            COMMENT '1=正常 0=禁用',
    last_login_ip   VARCHAR(45)                                 COMMENT '最近登录 IP',
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员账号表';

-- 2. 审计日志表（高频批量写入）
CREATE TABLE IF NOT EXISTS sys_audit_logs (
    id              INT           AUTO_INCREMENT PRIMARY KEY,
    admin_id        INT           NOT NULL                      COMMENT '操作管理员 ID',
    action_type     VARCHAR(64)   NOT NULL                      COMMENT '操作类型',
    target_resource VARCHAR(255)  NOT NULL                      COMMENT '操作对象',
    ip_address      VARCHAR(45)   NOT NULL                      COMMENT '操作 IP',
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
    INDEX idx_audit_admin    (admin_id),
    INDEX idx_audit_created  (created_at DESC),
    INDEX idx_audit_action   (action_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审计日志表';

-- 3. 用户注册表
CREATE TABLE IF NOT EXISTS sys_users (
    id              INT           AUTO_INCREMENT PRIMARY KEY,
    phone           VARCHAR(255)  NOT NULL                      COMMENT '手机号（AES 加密存储）',
    phone_hash      VARCHAR(64)   NOT NULL                      COMMENT '手机号 SHA256 哈希（不可逆，用于查重）',
    device_hash     VARCHAR(64)   DEFAULT ''                    COMMENT '设备指纹哈希',
    name            VARCHAR(64)   NOT NULL                      COMMENT '用户姓名',
    status          TINYINT       NOT NULL DEFAULT 1            COMMENT '1=正常 2=已注销',
    registered_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
    cancelled_at    DATETIME                                    COMMENT '注销时间',
    INDEX idx_users_phone_hash  (phone_hash),
    INDEX idx_users_device_hash (device_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户注册表';

-- 4. 设备指纹黑名单表
CREATE TABLE IF NOT EXISTS sys_blacklist (
    id                  INT           AUTO_INCREMENT PRIMARY KEY,
    device_fingerprint  VARCHAR(128)  NOT NULL UNIQUE           COMMENT '设备指纹哈希',
    phone_hash          VARCHAR(64)                             COMMENT '关联手机号哈希',
    reason              VARCHAR(255)  NOT NULL DEFAULT ''       COMMENT '拉黑原因',
    created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '拉黑时间',
    INDEX idx_blacklist_phone (phone_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='设备指纹黑名单表';

-- 5. 不可逆哈希风控归档表（历史注销沉淀库）
CREATE TABLE IF NOT EXISTS risk_hash_archives (
    id              INT           AUTO_INCREMENT PRIMARY KEY,
    fingerprint     VARCHAR(128)  NOT NULL UNIQUE               COMMENT '复合哈希指纹（手机号+设备）',
    phone_hash      VARCHAR(64)   DEFAULT ''                    COMMENT '手机号加盐SHA256哈希（用于快速匹配）',
    phone_mask      VARCHAR(16)   NOT NULL DEFAULT ''           COMMENT '手机号脱敏（已废弃，不存储任何手机号信息）',
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '归档时间',
    expires_at      DATETIME      NOT NULL                      COMMENT '过期时间（90天后）',
    INDEX idx_hash_archives_phone (phone_hash),
    INDEX idx_hash_archives_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='风控哈希归档表（注销黑名单）';

-- 6. 风控拦截日志表
CREATE TABLE IF NOT EXISTS risk_intercept_logs (
    id               INT           AUTO_INCREMENT PRIMARY KEY,
    ip_address       VARCHAR(45)   NOT NULL                     COMMENT '被拦截的客户端 IP',
    device_hash      VARCHAR(64)   DEFAULT ''                   COMMENT '设备指纹哈希（可选）',
    intercept_reason VARCHAR(255)  NOT NULL                     COMMENT '拦截原因描述',
    risk_level       VARCHAR(10)   NOT NULL                     COMMENT '风险等级：HIGH/MEDIUM/LOW',
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '拦截时间',
    INDEX idx_intercept_created (created_at DESC),
    INDEX idx_intercept_ip      (ip_address),
    INDEX idx_intercept_level   (risk_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='风控拦截日志表';

-- 7. 风控规则配置表 (模块三)
CREATE TABLE IF NOT EXISTS sys_config (
    id              INT           AUTO_INCREMENT PRIMARY KEY,
    config_key      VARCHAR(64)   NOT NULL UNIQUE              COMMENT '配置键名',
    config_value    VARCHAR(255)  NOT NULL                     COMMENT '配置值',
    updated_by      VARCHAR(64)   DEFAULT 'system'            COMMENT '修改人',
    updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='风控规则配置表';

-- 8. 管理员操作日志表 (模块三)
CREATE TABLE IF NOT EXISTS sys_operation_logs (
    id              INT           AUTO_INCREMENT PRIMARY KEY,
    admin_id        INT           NOT NULL                     COMMENT '操作管理员 ID',
    action_type     VARCHAR(64)   NOT NULL                     COMMENT '操作类型',
    target_resource VARCHAR(255)  NOT NULL                     COMMENT '操作对象',
    detail          TEXT                                       COMMENT '操作详情',
    ip_address      VARCHAR(45)   NOT NULL                     COMMENT '操作 IP',
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
    INDEX idx_oplog_admin   (admin_id),
    INDEX idx_oplog_action  (action_type),
    INDEX idx_oplog_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员操作日志表';

-- 9. 手机号黑名单映射表（手机号哈希 → 指纹映射，用于手机号查询/解封）
CREATE TABLE IF NOT EXISTS phone_blacklist_map (
    id              INT           AUTO_INCREMENT PRIMARY KEY,
    phone_hash      VARCHAR(64)   NOT NULL UNIQUE               COMMENT '手机号加盐SHA256哈希',
    fingerprint     VARCHAR(128)  NOT NULL                      COMMENT '对应复合指纹',
    phone_mask      VARCHAR(16)   NOT NULL DEFAULT ''           COMMENT '手机号脱敏（已废弃，不存储）',
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '加入时间',
    expires_at      DATETIME      NOT NULL                      COMMENT '过期时间',
    INDEX idx_phone_bl_hash (phone_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='手机号黑名单映射表';

-- 10. 白名单表（设备 + IP 双维度持久化，配合 Redis 高速查询）
CREATE TABLE IF NOT EXISTS sys_whitelist (
    id              INT           AUTO_INCREMENT PRIMARY KEY,
    type            VARCHAR(16)   NOT NULL                      COMMENT '白名单类型：ip / device',
    value           VARCHAR(255)  NOT NULL                      COMMENT '白名单值（IP 地址或设备哈希）',
    remark          VARCHAR(255)  NOT NULL DEFAULT ''           COMMENT '备注说明',
    created_by      INT                                       COMMENT '添加人管理员 ID',
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '添加时间',
    UNIQUE KEY uk_wl_type_value (type, value),
    INDEX idx_wl_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='白名单表（Redis 不可用时持久化恢复）';

-- 11. 默认风控配置种子数据
INSERT IGNORE INTO sys_config (config_key, config_value) VALUES
('device_register_limit', '3'),
('ip_register_limit', '5'),
('captcha_fail_max', '3'),
('ip_blocklist_ttl_hours', '24'),
('device_blacklist_ttl_days', '90'),
('hash_archive_ttl_days', '90'),
('captcha_answer_ttl_sec', '60'),
('captcha_token_ttl_sec', '300');
