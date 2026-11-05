# 本地数据库设计

更新：2026-11-05。实现位置：`src-tauri/src/storage.rs`。

SQLite 文件位于 `~/Library/Application Support/local.codex.quota-widget/widget.sqlite3`。测试可用 CQ_WIDGET_DATA_DIR 指定独立目录。数据只在本机保存，不访问 Codex 自身数据库。

## 结构

为小规模快照保持结构简洁，查询需要的键与状态采用独立列，其余类型化字段保存为 JSON payload。payload 是本项目的安全模型，不是原始 API 响应。此前逐字段展开的草案由以下已实现结构替代。

### app_preferences

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| id | INTEGER | 主键且固定为 1 |
| payload | TEXT | NOT NULL，设置 JSON |

设置字段：compact、autoRefresh、refreshMinutes（1–60）、alwaysOnTop、followCodex、showTrayIcon、x、y、expandedSize。showTrayIcon 为旧数据兼容字段，读取缺失时默认 true。x/y 为可空物理像素坐标，允许副屏产生的负坐标。expandedSize 为可空 `{width, height}` 逻辑点尺寸，旧数据缺失时默认为 null，展开态默认 368×524，保存尺寸下限为 330×260；迷你态固定 360×104。登录启动实际状态由系统插件读取，不用设置值伪装已启用。

### account_cache

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| account_key | TEXT | 主键；SHA-256(accountId + 分隔符 + email) |
| payload | TEXT | NOT NULL；key/email/planType/workspaceName |
| fetched_at | INTEGER | NOT NULL；Unix 秒 |
| available_count | INTEGER | NULL 表示未提供，非负值由解析层保证 |
| detail_state | TEXT | NOT NULL；unknown/empty/present/partial |

只保留最近成功账号，不建设账号池。邮箱不是唯一键。

### quota_window

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| account_key | TEXT | NOT NULL，关联账户 |
| minutes | INTEGER | NOT NULL；300 或 10080 |
| payload | TEXT | NOT NULL；minutes/usedPercent/resetsAt |

联合主键 `(account_key, minutes)`。只保存 Codex 主额度桶；usedPercent 和 resetsAt 可空。剩余比例和倒计时不保存。

### reset_credit

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| account_key | TEXT | NOT NULL，关联账户 |
| credit_id | TEXT | NOT NULL；服务端不透明 ID |
| status | TEXT | NOT NULL；保留服务端状态 |
| expires_at | INTEGER | NULL 表示未提供 |
| payload | TEXT | NOT NULL；类型化卡片模型 |

联合主键 `(account_key, credit_id)`。payload 包含 id/status/title/description/resetType/expiresAt/grantedAt。

索引 `idx_credit_account_status_expiry(account_key, status, expires_at)` 用于账号下卡片的状态与到期查询。

## 关系与事务

quota_window 和 reset_credit 的 account_key 外键关联 account_cache，ON DELETE CASCADE。应用启动时创建并复用 SQLite 连接，开启 `PRAGMA foreign_keys=ON`，schema 版本 `user_version=1`。

成功快照写入同一个事务：删除旧账户快照，插入新账户、窗口、卡片。设置表不受影响。失败回滚，不留下半份快照。

返回摘要数量与详情行数分开存储。详情未提供则记录 unknown，不把旧卡片冒充最新明细；详情部分返回则记录 partial，不根据缺失条目判定已使用。整个请求失败时保留上次成功快照，界面标记陈旧。

## 安全与验证

不保存 token、Cookie、密码、认证文件、完整响应或聊天内容。查询参数绑定。数据库是缓存，消费前必须重新核对服务端身份及卡片。

已测试：首次创建、重开、偏好持久化、替换账号后仅保留新快照及窗口。尚无 v2 迁移；新增版本时须先实现迁移，不能悄悄清空设置。

本次只扩展设置 JSON 可选字段，不改表结构，schema 仍为 v1。Rust 测试覆盖旧 JSON 兼容与展开尺寸重开后保持。
