# 技术架构

更新：2026-11-05。用户已选择 Tauri 技术栈；本文件替代此前 SwiftUI 设计。

## 技术栈与环境

- Tauri 2.12.5：透明 WebView、原生磨砂、菜单栏、窗口管理。
- React 19 + TypeScript 5.8 + Vite 7：界面与状态。
- Rust 1.99.1：Codex RPC、身份核对、SQLite、消费处理。
- SQLite / rusqlite：本地设置与最近快照。
- 极小 Objective-C 桥接：订阅 NSWorkspace 的 Codex 启停、休眠及降低透明度事件；不是 SwiftUI 应用。
- tauri-plugin-autostart：用户主动操作后注册登录启动；不在启动时自动开启。
- Node 24.14.0、Xcode 27.1、macOS 26.6.2（arm64）为本次构建环境。最低部署目标 macOS 13，尚未在旧系统实测。

精确依赖见 package-lock.json、src-tauri/Cargo.lock。Rust 工具链安装在项目 `.toolchain`，不修改全局 PATH。

## 系统结构

```mermaid
flowchart LR
  Workspace[NSWorkspace 事件] --> Rust[Tauri 生命周期与菜单栏]
  Rust --> UI[React 卡片]
  UI --> Bridge[类型化 IPC]
  Bridge --> Provider[账户与额度服务]
  Provider --> RPC[Codex App Server stdio]
  RPC --> Official[Codex 官方账户服务]
  Bridge --> DB[SQLite]
```

## 模块

| 文件 | 职责 |
|---|---|
| src/App.tsx | 精简/展开、设置、卡片列表、明确的消费确认 |
| src/Gauge.tsx | SVG 分段光环与终点微光 |
| src/useWidget.ts | 刷新调度、生命周期、陈旧状态 |
| src/bridge.ts | Tauri IPC 与完全隔离的浏览器演示数据 |
| src/model.ts | 时间、比例和卡片显示规则 |
| src-tauri/src/lib.rs | 命令注册、菜单栏、原生事件转发 |
| src-tauri/src/rpc.rs | 发现 Codex、stdio 握手、请求匹配和超时 |
| src-tauri/src/provider.rs | 查询、账号复核、指定卡片消费 |
| src-tauri/src/model.rs | 上游字段归一化 |
| src-tauri/src/storage.rs | 四张 SQLite 表与事务 |
| src-tauri/native/workspace.m | 按 bundle ID 监听应用，不扫描进程表 |

## IPC 接口

| 命令 | 参数 | 结果/约束 |
|---|---|---|
| bootstrap | 无 | 设置、缓存、生命周期、是否演示模式；无网络请求 |
| save_preferences | preferences | 校验 1–60 分钟并保存 |
| refresh_snapshot | 无 | 读取真实账号和额度，写成功快照；不消费 |
| consume_credit | accountKey / creditId / attemptId | 仅确认按钮调用；精确所选 ID；无自动重试 |

事件：`codex-state` 携带 running/sleeping/reduceTransparency；`menu-action` 携带 show/settings/refresh。

## 官方接口与身份

每次操作启动一个短生命周期 Codex App Server，使用安装的 Codex 自有配置，不手工读取 token，不启动模型回合。读取完成后终止自己的辅助进程，不保留空闲服务器。

流程：initialize → initialized → account/read → account/rateLimits/read → account/read。前后账户信息变化时放弃结果。额度窗口按时长匹配 300 和 10080 分钟；缺失显示未知。

本机协议已实测返回 accountId；缓存键为账户 ID 与邮箱组合的 SHA-256。账户 ID 提供工作区范围，邮箱只作为工作区内用户区分，并非唯一身份依据。无账户 ID 时拒绝建立可消费上下文。

实际桌面端由 `com.openai.codex` 标识（本机安装名为 ChatGPT.app）。本机只读链路可用；没有主动切换用户当前账号或工作区做破坏性验证，所以复杂多工作区切换仍是实测边界。

## 指定卡消费

用户选择 → 确认框固定账号与卡片 → 后端重新读取身份和卡片 → 核对 accountKey 与有效状态 → `account/rateLimitResetCredit/consume` 传 creditId 和 UUID 幂等键 → 显示结果 → 刷新。

结果区分 reset / alreadyRedeemed / nothingToReset / noCredit。传输超时或未知响应显示待确认，不自动重试、不更换卡片、不在重启后恢复消费。

用户明确要求开发过程不真实调用消费接口。本次使用协议替身验证，不拿真实重置卡做测试。

依据：[官方 App Server](https://learn.chatgpt.com/docs/app-server)。参考项目提交 `07ad243057b7cd0f8fc2fb4292e00b83f8910060` 仅用于理解功能，没有复制其实现代码。

## 窗口与刷新

- 半透明原生磨砂 + CSS 玻璃层，桌面背景自然透出；不内置原型壁纸。
- 默认 5 分钟刷新；支持 1–60 分钟及手动模式；合并同时发生的刷新。
- 倒计时在可见时每 30 秒检查，展示到分钟；不产生周期消费请求。
- Codex 退出时隐藏并暂停自动刷新；休眠暂停，唤醒按运行状态更新。
- 主线程显示；阻塞 RPC、网络和快照写入放在后台任务。
- 网络失败保留缓存并标记，不视为实时数据。明确未登录或认证类型不支持时清空界面快照。

## 打包与验证

运行命令和本机包位置见 README。已完成构建、单元测试、真实只读查询与原生演示窗口检查。登录启动注册、真实休眠、多显示器、账号切换和长期资源指标尚未全量实测，不声称全部验收通过。
