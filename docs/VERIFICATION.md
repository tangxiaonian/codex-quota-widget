# 验证记录

日期：2026-11-05；所有时间采用 Asia/Shanghai。

## 环境

- macOS 26.6.2 arm64，Xcode 27.1，Node 24.14.0。
- 项目专用 Rust 1.99.1，Tauri 2.12.5。
- Codex bundle ID：com.openai.codex；安装名 ChatGPT.app。
- 桌面内置 Codex CLI：0.166.0-alpha.6；系统 CLI：0.166.0。

## 已执行

| 检查 | 结果 |
|---|---|
| npm run build | TypeScript 检查及 Vite 构建通过 |
| npm test | 4 项通过：缺失额度、倒计时、过期/排序、消费结果文本 |
| npm run test:rust | 7 项通过：窗口映射、部分明细、账户作用域、指定 B、禁止自动重试、账户不符阻止消费、只读流程、存储重开/替换（部分在同一测试） |
| npm run desktop:build -- --debug | 成功生成 macOS .app |
| 编译程序 --read-only-check | 读取 ChatGPT 套餐、两个额度窗口与重置卡明细通过；输出不含个人标识 |
| 浏览器演示 | 设置中可应用自定义 7 分钟；精简与展开可切换，选择卡 B 的确认页绑定 B；模拟使用后仅 B 移除、A 保留 |
| 最终应用包启动 | Finder 启动成功，实际窗口 390×278pt，应用自身 SQLite 已保存两个额度窗口与卡片明细；没有点击真实消费 |
| 原生 --demo | 应用进程成功启动，窗口约 390×302pt（含演示标识），独立截图检查通过 |

截图：

- [精简态](../output/playwright/compact.png)
- [展开态](../output/playwright/expanded.png)
- [原生演示窗口](../output/playwright/native-demo.png)
- [真实额度精简窗口](../output/playwright/native-live-compact.png)

浏览器壁纸仅用于预览，原生应用没有嵌入该壁纸。原生窗口截图可证明本机窗口渲染，不等于所有壁纸、系统版本上的材质效果都已验证。

## 2026-11-05 下午迭代（16:20–16:55）

| 检查 | 结果 |
|---|---|
| npm run build / npm test | 通过；测试增至 5 项，新增卡名汉化断言（"Full reset (Weekly + 5 hr)" → "完整重置（周额度 + 5 小时）"，未知标题原样透传） |
| npm run desktop:build -- --debug | 两次增量构建成功 |
| 菜单栏"显示卡片"置前 | 菜单点击路径因宿主进程无辅助功能权限无法用 osascript 复现；改走同一 `show_card()` 的单实例二次启动路径实测：Finder 持有焦点时触发，0.3s 内 "Codex Quota Widget" 成为最前应用并保持至测试进程退出；原生 `activateIgnoringOtherApps:YES + makeKeyAndOrderFront` 代码审查通过 |
| 滚动条隐藏 | `.native-body .card` 与 `.credit-list` 改为 `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`，保留滚动能力；浏览器预览确认无滚动条 |
| 卡名汉化 | 浏览器演示展开态确认英文服务端标题显示为中文；未知标题不翻译 |
| 卡片瘦身 | 默认窗口收紧（展开 448×690 → 398×580，精简 330×296），内边距/字号/仪表盘直径整体下调；预览确认布局协调、无大片留白 |
| 精简态保留账号 | 精简态显示账号行（邮箱 + 套餐徽章），隐藏工作区副标题与重置卡列表；PRD 第 2、3 节与 AC-03 已同步 |

浏览器演示新截图：[展开态含中文卡名](../output/playwright/expanded-localized.png)、[精简态含账号行](../output/playwright/compact-account.png)、[展开态整页](../output/playwright/expanded-full.png)。

菜单点击路径的 osascript 复现属于权限受限项，未覆盖；如需完全复现需在具有辅助功能权限的终端执行。

## 2026-11-05 傍晚迭代（17:00–17:15）

| 检查 | 结果 |
|---|---|
| npm run build / npm test | 通过（5 项 TS 测试） |
| npm run test:rust | 8 项通过；新增旧设置 JSON 缺 showTrayIcon 字段时默认 true 的兼容测试 |
| npm run desktop:build -- --debug | 构建成功并重启应用 |
| 精简态迷你条 | 浏览器预览确认：360×104 横条，头部一行（C 标/邮箱/套餐/展开按钮），两行细额度条带百分比与恢复时间；状态横幅改为悬浮层不撑高窗口 |
| 菜单栏图标开关 | 设置页新增"菜单栏图标"开关；Rust 侧 save_preferences 保存后即时 set_visible，启动时按存档恢复；隐藏后可从展开卡片进设置恢复（帮助文案已注明） |
| 文档同步 | PRD 精简态描述与 F-02、DB_DESIGN 设置字段已更新 |

新截图：[迷你条](../output/playwright/mini-bar.png)、[展开态](../output/playwright/expanded-after-mini.png)、[设置页开关](../output/playwright/settings-tray-switch.png)。

tray 图标实际隐藏的系统级效果（菜单栏区域视觉确认）受录屏权限限制未截图，逻辑由 tray_by_id + set_visible 实现；设置页开关的持久化行为由 Rust 测试覆盖旧数据兼容。

## 消费代码审查

消费入口仅在 hooks/useRedemption.ts 的显式确认处理器调用 bridge.consume。refresh、定时器和 --read-only-check 均无消费调用。provider.consume 校验非空卡 ID、UUID、账号一致、卡片存在且有效；传准确 creditId；结果超时不重试。

模拟协议断言：选择较晚到期的 B，消费参数仍为 B；账户不符时消费调用为零；失败最多一次消费请求。浏览器演示在内存模拟，不连真实服务。

**整个开发过程未发起真实重置卡消费请求。真实使用效果按用户要求留待其自行使用，不声称线上消费验证通过。**

## 未覆盖

登录启动注册、系统重启、真实休眠、完整 Codex 重启、账号与工作区切换、多屏、旧系统、持续资源测量。为避免打断正在进行的 Codex 工作，本轮没有主动退出 Codex 或切换其账户。

当前包为本机 Debug 构建，没有 Developer ID 签名、公证和公开发布。基础只读链路实测通过不等于以上所有兼容性验收通过。

## 2026-11-05 夜间：窗口修复与工程化

- 基线：main / 3d6d7af，开始时工作区干净；本轮未提交代码。
- `npm test`：10 项通过，新增模式切换停止隐藏、刷新不重设大小、展开尺寸跨模式和控制器重建保留、副屏负坐标/不同缩放、断屏回退和完整工作区约束、首次位置避开吸附区。
- `npm run test:rust`：8 项通过；旧设置无 expandedSize 默认 null；实际 SQLite 关闭重开后尺寸保留；指定卡 B 和消费不重试仍使用替身。
- `npm run test:native`：真实 AppKit 临时窗口通过。覆盖隐藏完成后退出、淡出中途取消、显式显示后鼠标离开仍可见、拖离顶部退出；同时断言原始位置不被隐藏动画改变。
- 原生演示完整应用：360×104 迷你条启动；显式显示将 alpha 从 0 恢复到 1；鼠标展开到 368×524；拖动左下角得到 531×706；收起、顶部悬停恢复、展开、鼠标移出后保持 531×706 且 alpha=1。
- 浏览器演示：自定义 7 分钟生效，选择第二张卡的确认页绑定 B，模拟使用后仅 A 保留；收起成功；控制台 Errors=0、Warnings=0。
- 新截图：`output/playwright/refactor-native-mini.png`、`refactor-native-expanded.png`、`refactor-native-resized.png`、`refactor-confirmation.png`、`refactor-expanded.png`、`refactor-mini.png`。

### 本轮资源采样边界

- 调整前运行一次 `--read-only-check`：wall time 1.92s；没有发起消费，不启动模型回合。单次测量不代表稳定网络延迟，也未拆分进程启动和网络耗时；因此没有据此改成长连接。
- `CQ_WIDGET_BENCHMARK=1 npm run test:native`：隐藏状态 3s，AppKit 测试进程平均 CPU 0.236%，最大 RSS 42.97 MiB。这是直接运行生产隐藏模块的临时测试窗口，不是 Tauri 主进程/WebKit/App Server 完整进程树指标，也不是长期续航测量。
- 完整原生应用可见性和尺寸使用 CoreGraphics 窗口信息核对；物理多屏、真实休眠、账号切换仍未覆盖。几何单元测试不冒充物理多屏验收。

本轮真实服务仅只读；重置卡调用仅发生在 Fake Transport 与浏览器内存演示中。

- 打包：Debug 构建通过；最终 `npm run desktop:build` Release 构建通过，生成 `src-tauri/target/release/bundle/macos/Codex Quota Widget.app`，约 12.36 MiB。这是本机优化构建，未做正式分发签名/公证。

- Release 独立数据目录持久化验收：原生窗口实际拖到 552×740；只读查询测试 SQLite 确认 expandedSize 已保存；终止并重新启动后 CoreGraphics 报告仍为 552×740、alpha=1。该验收只读真实额度，没有操作重置卡，未改用户正常配置。

- 已结束演示及隔离验收进程，启动最终 Release 应用并恢复用户原有配置；未启用登录启动、未提交 Git。
