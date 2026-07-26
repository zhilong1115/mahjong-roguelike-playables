# Platform Matrix

状态：`Living Document`

| 能力 | Web | YouTube Playables | TikTok Mini Games | Meta / Facebook |
|---|---|---|---|---|
| 核心技术 | HTML5 | HTML5/Web API | HTML runtime 或 Native | 待重新核实 |
| 入口 | URL | ZIP + `index.html` | 平台项目包 + SDK | 平台项目包 |
| 存档 | localStorage/IndexedDB | `ytgame.game.loadData/saveData` | TikTok SDK/平台能力 | 平台 SDK |
| 最高分 | 自行实现 | `ytgame.engagement.sendScore` | 平台能力 | 平台能力 |
| 暂停恢复 | Web fallback | `onPause/onResume` | 生命周期 API | 生命周期 API |
| 音频 | 本地设置 | YouTube 音频状态 | 平台音频状态 | 平台音频状态 |
| 网络 | 可配置 | 当前默认禁止外部调用 | 可信域名配置 | 待核实 |
| 发布优先级 | 开发基线 | P0 | P0 | P2 |

## 共同基线

- 运行时不依赖外部字体和非必要网络请求。
- 所有路径使用相对路径。
- 入口构建为 `index.html`。
- 手机触控完整可用。
- 状态在 resize、暂停和恢复时不丢失。
- 平台差异只存在于 `src/platforms/`。

## YouTube 清单

- SDK 在游戏代码之前加载。
- 正确调用 first frame 和 game ready。
- 先完成 loadData，再允许 saveData。
- 对 materially progressed 状态自动保存。
- 响应 YouTube 静音、暂停和恢复。
- 所有比例可玩，且不锁方向。
- 文件名只使用允许字符。
- 通过 Bundle Analyzer、SDK Test Suite 和设备测试。

## TikTok 清单

- 明确选择 HTML runtime。
- 初始化 Mini Games SDK。
- 避免禁止的动态代码能力。
- 脚本与 CSS 使用自身资源；网络域名按平台配置。
- 接入生命周期、存档、广告和语言能力。
- 使用官方 CLI 打包、预览和验证。

## Meta 清单

在进入移植前完成一次最新官方接入审计，再决定是否排入正式发布计划。不得依据旧版 Instant Games 文档直接实现。
