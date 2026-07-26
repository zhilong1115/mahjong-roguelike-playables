# Project Operating Rules

## Source of truth

按以下优先级工作：

1. 用户在当前任务中的明确要求
2. `docs/decisions/` 中状态为 `Accepted` 或 `Frozen` 的决定
3. `docs/00-vision.md` 和 `docs/02-game-design.md`
4. 其他项目文档与配置
5. `prototype/legacy-demo.html` 的既有行为

原型只证明想法可行，不自动成为正式规则。

## Change workflow

进行玩法、UI、技术或平台变更时：

1. 明确变更要解决的问题和成功信号。
2. 判断它属于 `Idea`、`Proposed`、`Accepted` 还是 `Frozen`。
3. 先更新对应设计文档或 decision record，再实现已确认的方向。
4. 实现最小可测试版本。
5. 运行相关自动测试和屏幕矩阵测试。
6. 把结果记入 `docs/playtests/`；未验证的判断不得写成结论。

## Design rules

- 第一输入目标不超过 3 秒；教程目标不超过 45 秒。
- 所有关键操作必须支持触控和鼠标，不依赖悬停、右键或精确拖拽。
- 复杂度来自组合决策，不来自长篇说明或隐藏规则。
- 核心游戏不得直接调用平台 SDK；通过平台适配接口调用。
- YouTube 版本默认离线自包含，不依赖外部字体、分析或内容服务。
- 不复制第三方游戏名称、素材、音频、商标或可识别的整体视觉外观。

## Responsive rules

- 不锁定设备方向。
- 每次 UI 改动至少验证 `config/viewports.json` 中的 required 视口。
- 不允许页面级意外滚动、裁切关键按钮或重置游戏状态。
- 关键触控目标以 48×48 CSS px 为目标；较小视觉元素可增加透明点击区。

## Engineering rules

- `prototype/legacy-demo.html` 作为归档，不直接修改，除非用户明确要求修改原型。
- 正式代码进入 `src/`，构建产物进入被忽略的 `dist/`。
- 游戏规则、内容数据、状态序列化、渲染和平台适配必须分离。
- 随机玩法使用可记录的 seed；牌型判定和存档迁移必须有自动测试。
- 存档包含 schema version，并保持向后兼容。

## Completion rules

只有同时满足以下条件，任务才算完成：

- 文档与实现一致。
- 相关测试通过。
- required 视口没有关键内容溢出或不可操作。
- 没有新增未经记录的平台限制或设计假设。
