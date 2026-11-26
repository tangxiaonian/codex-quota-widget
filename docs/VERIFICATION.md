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

## 2026-11-12 WorkBuddy 多来源接入

- Rust 12 项模拟/存储测试通过；两个真实账号测试默认跳过。已单独运行 WorkBuddy 真实只读测试，成功读取当前账号积分、总量和三个分组，未输出凭据原文。
- TypeScript 13 项测试通过，涵盖积分精度、未知值和按已启用来源跟随显示。
- WebKit 模拟页面验证 360×104 下的双来源、单 Codex、单 WorkBuddy、错误提示及仅启用一个来源，无横向溢出、无需滚动、提示不遮挡额度。验证点击来源进入详情、切换 Codex 保留两项额度、来源开关至少保留一项；模拟 WorkBuddy 网络失败保留积分、登录失效清除积分、恢复登录后重新读取成功。
- Release .app 构建通过并已启动。本机屏幕处于锁定状态，实际原生窗口点击与截图未完成，不能据此宣称原生交互全量验收通过。
- WorkBuddy 汇总接口没有提供到期日期、今日/月度消耗，本次实现按实际数据省略这些字段。真实重置卡未消费。

### 多来源自查与修正（2026-11-12）

- 规范审查发现两项 P2：Codex 操作提示跨来源显示、旧版 uid+JWT 前缀未归一化，均已修复。需求审查发现一项 P2：两种 WorkBuddy 迷你视图未提示低余额，已补齐。
- 数据与状态自查修复三项：已用量改取 CycleUsedCapacity；切换账号且网络失败时清除前一账号积分；来源开关改变跟随条件时，设置页保持可见至关闭。
- TypeScript 14 项、Rust 13 项模拟/存储测试通过。Rust 两项真实账号测试默认跳过，WorkBuddy 已单独执行真实只读查询。
- WebKit 额外验证低余额在两种迷你模式变红、登录失效清空/恢复、Codex 模拟用卡提示切至 WorkBuddy 后消失。模拟用卡仅在明确不含 Tauri bridge 的浏览器假数据页面执行。
- 屏幕仍锁定，原生点击、真实应用退出/重启跟随行为仍未全量验收。

### 积分到期日与迷你进度条（2026-11-12）

- 真实只读查询成功获取 19 个可用积分包，19 个均解析到到期时间，汇总余额保持独立。
- TypeScript 15 项、Rust 14 项测试通过，覆盖日期解析不混用周期结束时间、未知日期后排、排序不改变快照。
- WebKit 验证双来源总览的 3 条进度条、单 WorkBuddy 的进度条、单 Codex 的既有两条进度条；360×104 下正常、低余额和异常提示均无溢出遮挡。展开态验证赠送包在无日期的套餐包前。

- 随后桌面解锁，已在原生窗口打开 WorkBuddy 详情，通过可访问性树核对 19 条包日期按升序排列。已收起为双来源迷你条并截取本机窗口，目视确认 Codex 两条进度、WorkBuddy 一条进度完整展示，未遮挡文字。

### 迷你来源切换与标签对齐（2026-11-12）

单来源视图原来的全透明图标覆盖选择器已替换为始终可见的来源下拉框。WebKit 验证全部来源、Codex、WorkBuddy 多次往返，控件不隐藏且 360×104 不溢出；原生菜单已验证 WorkBuddy 切回全部来源。Codex 5h/周标签分别置于各自条上方，并按用户要求右对齐到对应条的右端，与 WorkBuddy 读数一致。

- 新版原生窗口再次验证 Codex → 全部来源成功；最终截图确认 Codex 5h、周读数各自在对应条的上方且右对齐，WorkBuddy 读数右对齐。原生窗口保持迷你总览。

## 2026-11-15：常驻内存诊断与网络会话复用

- 开始时位于 main（03f742b），保留已有未提交的 WorkBuddy 与界面改动；本轮未提交代码。
- 用户原进程 PID 20939 已运行约 2 天 15 小时，每分钟自动刷新。`proc_pid_rusage` 测得主进程 physical footprint 约 200–201 MiB；RSS 约 29–38 MiB，两者统计口径不同。WebContent 进程另占约 93–97 MiB，不把它算成主进程堆。
- `heap` 发现约 180 万个 XPC 字符串；`leaks` 报告约 163 MiB 不可达对象，主要为代理配置 XPC 数组、字典与字符串。没有观察到空闲查询子进程持续残留。
- 独立无凭据 HTTPS HEAD 探针复现：12 次查询每次创建并销毁 NSURLSession，检测到 189,616 字节泄漏；复用会话为 15,360 字节。直接调用系统代理配置 API 并释放的对照未复现同样积累，因此修复限定在网络会话生命周期。
- 生产 `quota_http.m` 直接链接到无凭据探针：12 次与 60 次请求均检测到 188 个、10,768 字节的泄漏对象，footprint 均约 7 MiB。短测未随请求次数增加；仍存在少量系统对象，不能称为零泄漏或长期稳定验证。
- `CARGO_NET_OFFLINE=true npm run test:rust`：14 项通过，2 项真实服务测试默认跳过。`CARGO_NET_OFFLINE=true npm run desktop:build`：Release .app 构建通过。
- 单独执行更新后的 `workbuddy::live_summary` 真实只读测试通过，获取 23 个可用包且全部解析到日期。原生修复版重启后可访问性树显示真实 Codex 额度与订阅日期，未使用重置卡。
- 新主进程 PID 82132，启动后约 2 分钟和 3 分钟的 physical footprint 分别为 22.52、21.58 MiB；后一次 `leaks` 检测为 27,104 字节。这里比较的是旧常驻进程与新进程短时采样，不承诺连续运行数天保持同一数值。WebKit、图形和网络辅助进程仍有各自开销，未做长期完整进程树资源验收。

## 2026-11-22 Antigravity CLI 额度

- 本机 Antigravity 2.33.0 的本地额度接口对未授权请求返回 401。首版采用官方 CLI 报告，桌面端仅用于跟随显示。
- `agy` 1.5.13 的真实只读报告回传 3 个模型组、5 个额度窗口，5 个均解析到恢复时间。Rust 的 `antigravity::tests::live_usage` 通过，解析器要求报告是 `/usage` 且模型回合数为零。
- TypeScript 16 项、Rust 15 项常规测试通过。WebKit 演示验证三来源四条进度、迷你和展开切换、状态提示不遮挡、设置切换与至少保留一个来源。真实额度通过 Rust 入口单独验证。
- Release 构建通过，应用包执行本机临时签名并通过 `codesign --verify --strict`。重启后通过原生窗口确认新版正常显示。Antigravity 开关上线默认关闭，真实额度与界面的组合验证覆盖 Rust 查询和 WebKit 演示两个环节。

### Antigravity Token 直连验证

- 本机 Antigravity 2.34.0 使用登录钥匙串，备用凭据文件不存在。临时探针完成一次用户授权后直接查额度，HTTP 200，0.85 秒，返回一组 5 小时和周窗口。
- 直连候选应用完成钥匙串授权后请求同一接口，返回 HTTP 403 `SUBSCRIPTION_REQUIRED`。当前机器的官方 CLI 对照仍成功返回 3 组、5 个窗口，故直连不替换当前可用版本。
- Rust 15 项、TypeScript 16 项通过，Release 构建通过。WebKit 模拟验收覆盖静默读取、用户主动授权和授权后显示。原生应用证实静默路径及时显示授权入口，当前账号下直连额度未通过端到端验收。

### 2026-11-23 切换至无 CLI 版本

- 按用户要求切换运行包，Antigravity 只使用桌面端 Token 直连。已退出上一版 CLI 小组件，Release 重新构建并通过本机签名校验。
- TypeScript 16 项测试通过。最终包启动后原生卡片显示「Antigravity 桌面端」与手动钥匙串授权入口，静默读取未弹窗。先前授权后收到的 `SUBSCRIPTION_REQUIRED` 仍是该账号的直连验收边界。

### 2026-11-23 桌面端额度可见但直连失败

- 用户确认 Antigravity 桌面端 Models 显示额度。旧小组件重试复现「登录凭据不可用」，该提示合并了本地凭据无效与服务端 HTTP 401。
- 新增独立诊断区分本机登录记录格式、Access Token 到期和 Google 401。使用模拟数据验证缺少 Token、RFC3339 小数秒到期时间及 Go 默认未设置的日期；Release 包构建和本机签名校验通过。
- 新包启动后经本机钥匙串授权，实际卡片显示「本机 Antigravity Access Token 已过期，等待桌面端续期」。这次错误在发起网络请求前产生。桌面端自身取数与本地共享登录记录的 Token 续期行为仍需区分，未验证该账号可持续直连。

### 2026-11-23 使用桌面端 Models 页面

- 经用户授权，临时探针向 Google 续期两次均得到 HTTP 200。新 Access Token 查询 `retrieveUserQuotaSummary` 仍返回 HTTP 403 `SUBSCRIPTION_REQUIRED`。桌面端日志显示其定期调用 `loadCodeAssist`、`fetchAvailableModels`。同一当前账号的新 Token 查询前者返回 200，但响应没有项目上下文，查询后者返回 403。未将这次探针的自动续期加入小组件。
- macOS 辅助功能读取本机 Antigravity 2.34.0 的英文 Models 页面，检测到两个模型组、四个额度窗口。直接链接生产原生模块的探针耗时约 79 毫秒。百分比按页面的 Remaining 字段展示，恢复时间从桌面端倒计时估算，页面没有倒计时时保留未知。
- Rust 常规测试 16 项、TypeScript 测试 16 项通过。两项 Rust 真实服务测试默认跳过。刷新未启动 Antigravity CLI，未调用重置卡消费接口。
- Release 应用已重新构建、本机临时签名并通过签名验证。系统日志确认当前小组件已获辅助功能授权。Antigravity Models 页打开后，原生卡片手动刷新成功，与同次读取的 Models 数据一致。Gemini 5 小时剩余 73%、周剩余 89%，两项均显示恢复倒计时。展开态显示 Claude/GPT 两项均为 100%，迷你态仅显示 Gemini 两条进度条。验证后恢复原来的展开状态。

### 独立 OAuth 授权核查

- 静态比对确认 Cockpit Tools 的默认 Antigravity OAuth 客户端标识与本机官方桌面端一致。[OAuth 实现](https://github.com/jlcodes99/cockpit-tools/blob/main/crates/cockpit-core/src/modules/oauth.rs)
- Google 提供通用桌面 OAuth 流程。本次未在 Google 的公开文档中找到第三方客户端可调用的个人 Antigravity 剩余额度接口或对应的只读授权范围。官方 SDK 的 `usage_metadata` 描述单轮及累计 Token 用量。Antigravity 使用条款第 6 条明确限制通过第三方工具访问该服务。[Google 桌面 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app) · [Antigravity SDK](https://antigravity.google/blog/introducing-google-antigravity-sdk) · [Antigravity 使用条款](https://antigravity.google/terms)

### 2026-11-24 浏览器 OAuth 验证范围

- 用户确认，Cockpit Tools 中的 Antigravity 账号通过浏览器 OAuth 授权导入。本机 Cockpit Tools 1.3.81 当天日志记录了三次 `retrieveUserQuotaSummary` 返回 HTTP 200，并将三次响应合并到额度数据。
- 之前的 HTTP 403 来自复用桌面端钥匙串凭据的临时探针，只适用于当时的凭据和请求。后续以小组件自身的浏览器 OAuth 流程获取授权，并通过小组件的真实刷新入口验证剩余额度和恢复时间。按用户要求停止使用临时凭据探针。

### 小组件独立 OAuth 实现

- 已实现小组件发起的浏览器 OAuth、PKCE 与本机回调、专属钥匙串、过期续期和额度请求。清除了旧的 Models 读取和桌面端凭据路径。
- 本机回调测试通过实际回环套接字收取模拟授权码，另有状态不匹配、错误路径及用户拒绝用例。Rust 17 项、TypeScript 16 项通过。Release 应用完成构建和本机临时签名，签名检查通过。真实 Google 授权及额度刷新仍需获准读取 Antigravity 个人额度的 Google 桌面 OAuth 客户端配置，本机尚未提供。

### Google 桌面客户端真实授权验收

- 导入用户提供的 Google 桌面客户端配置后，从 Release 小组件的「使用 Google 授权」发起真实流程。Google 授权页返回 HTTP 400 `invalid_scope`，明确拒绝 `https://www.googleapis.com/auth/aicode`。流程在发出授权码前终止，未进入令牌交换和额度查询阶段。此结果适用于本次提供的小组件 OAuth 客户端。

### 2026-11-25 替换为本机 Language Server + agy CLI 双路线

- 移除浏览器 OAuth、回环回调、专属钥匙串及 Google 后端直连代码（删除 `antigravity/callback.rs`、`oauth.rs`、`quota.rs` 及前端「使用 Google 授权」入口）。
- 改为本机 `language_server`（`127.0.0.1` 回环 HTTPS + `KERN_PROCARGS2` 读取 `ANTIGRAVITY_SERVER_CSRF_TOKEN` + 仅限 `127.0.0.1` 放行自签名证书）优先、官方 `agy >= 1.1.11` CLI（`--log-file /dev/null -p "/usage" --output-format json`）兜底。
- `npm run build` 通过；`npm test` 16 项通过；`CARGO_NET_OFFLINE=true npm run test:rust` 20 项常规单测通过（覆盖 `KERN_PROCARGS2` 环境变量提取、多进程优先级与非 Antigravity 过滤、`lsof` 端口去重、`agy` 版本下限校验、CLI snake_case 与 Language Server camelCase 报告解析）。
- 本机真实只读测试 `antigravity::tests::live_local_or_cli_quota` 通过（耗时 0.32s），命中 `source=languageServer`、`plan=Some("Pro")`、`groups=2`，全程未触发钥匙串弹窗、未发起 OAuth 请求、未调用 Codex 重置卡消费接口。
- `CARGO_NET_OFFLINE=true npm run desktop:build` 通过，生成本机 Release 应用包 `src-tauri/target/release/bundle/macos/Codex Quota Widget.app`（13.01 MiB，未做正式分发签名/公证）。
- 未覆盖项：关闭 Antigravity 桌面端后的 `agy` CLI 真实兜底路径、原生应用重启后的窗口手工点击验收与多屏回归。

### 2026-11-25 三阶段升级验收（菜单栏直显、贴边圆环条与本地 Token 用量统计）

- **前端构建与单测**：`npm run build` 通过；`npm test` 21 项通过（新增 5 项覆盖菜单栏读数 `tightest`/`all`/`none` 与低余额 `!` 告警、Burn-rate ETA 预测与重置清空、贴边圆环条悬停内侧展开坐标钉死、`WindowController` 不把 Rail 尺寸覆盖 `expandedSize`、以及 Token/币种格式化）。
- **Rust 单测与迁移**：`CARGO_NET_OFFLINE=true npm run test:rust` 22 项常规测试通过，含 SQLite `v1 -> v2` 平滑迁移且单文件增量重算幂等测试、Codex 累计差分与缓存拆分解析测试。
- **本机真实本地日志扫描验证**（`usage::tests::live_local_usage_scan`，独立临时 SQLite，只读不上传、不改用户数据）：
  - 成功扫描 2,117 个本地会话文件，覆盖全部 3 个来源（Codex 5.49 亿、WorkBuddy 6.07 亿、Antigravity 1.13 亿部分统计，近 30 天合计 12.69 亿 Token，等值 API 约 `$61.32`）；
  - 随后已将逐文件事务优化为锁外解析 + 单事务批量写入。
- **本机打包与实机迭代**：根据用户实机反馈完成五轮体验打磨（隐藏圆环条窗口级矩形底板、圆环优先展示 5h 额度、桌面任意拖动与 28pt 近边吸附、无焦点全局鼠标监测悬停、悬停卡直显今日 Token、底边 `railOffsetY` 零位移补偿、单帧原子 `setFrame` 防闪烁、菜单栏回归纯图标），最终 `npm run build`、21 项 TS 单测、22 项 Rust 单测及 `CARGO_NET_OFFLINE=true npm run desktop:build` 全部通过（13.36 MiB，未做正式分发签名/公证）；全程未触碰 Codex 重置卡消费接口。
