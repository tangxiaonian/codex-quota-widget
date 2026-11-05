# Codex Quota Widget 项目规则

## 当前状态

用户已授权开发，并明确选择 **Tauri + Rust + React/TypeScript**，不再采用 SwiftUI。已实现本机应用与测试，第四版原型为视觉基准。

**开发和验证期间禁止真实调用重置卡消费接口。只做代码审查与模拟测试，真实操作留给用户自行点击使用。** 这项约束覆盖旧文档中的真实用卡验收要求。

当前已建立 Git 仓库。进入目录先确认分支和已有改动；不自动提交或推送。

## 阅读顺序

- docs/PRD.md：需求和验收。
- docs/ARCHITECTURE.md：当前模块与官方协议。
- docs/DB_DESIGN.md：已实现的四表模型。
- docs/PLAN.md 与 docs/VERIFICATION.md：进度和证据边界。
- prototype/card-prototype-v4.png：玻璃卡片与分段光环。

## 技术栈与目录

Tauri 2、Rust、React 19、TypeScript 5.8、Vite 7、SQLite/rusqlite；少量 Objective-C 用于 NSWorkspace 原生事件，无 SwiftUI。部署目标 macOS 13+，实测 macOS 26.6.2 arm64。版本锁见 Cargo.lock 与 package-lock.json。

```text
src/App.tsx          # 页面组合与导航
src/components/      # 头部、额度、卡片列表、设置、确认等视图
src/hooks/           # 用卡流程与窗口事件绑定
src/window/          # 窗口控制、屏幕几何和 Tauri 窗口适配
src/                 # 模型、账户 IPC、刷新调度
src-tauri/src/       # Rust 命令、RPC、数据解析、存储
src-tauri/native/    # macOS 事件桥接
src-tauri/icons/     # 本项目图标
src-tauri/capabilities/ # 最小窗口与自启动权限
scripts/             # 本地工具链与构建入口
tests/               # TypeScript 模型测试
docs/                # 需求、方案和验收证据
prototype/           # 视觉历史稿
output/playwright/   # 演示界面验证截图
.toolchain/          # 本机 Rust 工具链，不提交
```

## 构建与测试

```bash
npm ci
npm run dev                      # 浏览器假数据预览
npm run build                    # TypeScript + Vite
npm test                         # 不访问网络的显示逻辑测试
npm run test:rust                # Rust 模拟协议、模型、数据库测试
npm run test:native              # AppKit 临时窗口回归，需桌面会话；不访问账号
npm run desktop:build -- --debug # 本机可运行 .app
npm run desktop:dev              # 原生开发模式，会读取真实额度
```

脚本优先加载项目内 .toolchain，否则使用系统 Rust。不要改写 HOME/CODEX_HOME。不要把 Xcode/Swift 命令当成本项目主构建命令。

原生演示使用 `src-tauri/target/debug/codex-quota-widget --demo`。只读检查使用 `--read-only-check`；其代码路径不能加入消费调用。真实消费绝不用于 smoke test、自动 UI 测试或错误分支测试。

## 编码规范

- 中文直接说结论，说明静态、编译、模拟、本机运行和真实服务验证分别覆盖什么。
- Rust snake_case，TS lowerCamelCase，React 组件 UpperCamelCase；领域解析与视图分离。
- 新增或修改方法写职责注释；复杂逻辑解释原因，不逐行翻译源码。
- 视图通过 bridge.ts 调用受限命令，不直接读凭据、执行 shell 或访问后台 HTTP。
- 阻塞网络和快照写入在后台；定时刷新与倒计时分开；不加入持续背景动画。
- 账号与卡片必须明确归属；未知字段保留未知，不补造额度或有效期。
- 接口失败原始响应不得直接进入日志或界面。
- 只为真实业务写必要防护；低概率竞态等额外复杂度须先解释风险、概率、代码成本并征求用户同意。
- 测试覆盖误用卡、串账号、额度显示、存储事务等行为，不为静态文案写机械测试。

## 禁止事项

- 不自动切换、登录、登出 Codex；不修改 Codex 应用包、认证文件、数据库或配置。
- 不在日志、文档、数据库、fixture 或终端输出 token、Cookie、密码和认证原文。
- 不自动使用重置卡；不省略 creditId 降级成自动选卡；超时不自动重新消费。
- 不启用用户系统自启动，除非用户在界面主动选择。
- 不建立账号池、代理、多平台后台、遥测或云同步。
- 不复制未核查许可证的参考项目源码。
- 不用原型整图实现 UI；实际壁纸由桌面透出。
- 不自动发布、公证或全局安装插件。不把本机 Debug 包称为正式签名发行版。

## 文档同步

修改协议、数据结构、测试命令时同步文档。任何未实测项目在验证记录中保留，不因编译通过标记完整运行验收通过。
