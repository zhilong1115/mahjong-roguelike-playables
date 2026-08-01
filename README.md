# Mahjong Roguelike Playables

面向 YouTube Playables、TikTok Mini Games 和普通网页发布的轻量麻将构筑肉鸽。

当前阶段：`Production / 正式开发`（框架已落地，内容与数值仍在实验中）。

## 现在在做什么

正式版骨架已经可以完整试玩：[`src/`](src/index.html)。玩法改动只在 `src/` 发生，`prototype/` 下的 Demo 全部归档为历史对照。

环境要求：Node.js 22 或更高版本（正式规则测试使用 Node 内置 test runner）。试玩本身不需要安装 npm 依赖。

```bash
node tools/dev-server.mjs
```

打开 `http://127.0.0.1:4173/src/`（加 `?seed=数字` 复盘同一局，加 `&intro=0` 跳过说明）。

- 当前 `Proposed` 外层切片 = 东 / 南两圈 × 闲局 / 庄局 / 圈主三关 × 每关一副；闲局和庄局可跳过换手气，圈主必须打
- 每个打赢的非最终关后进入百宝阁，标准局共 6 副、最多 5 家商店；第 1 / 3 / 5 家是三流派请将台，通关后可选西圈加赛
- 每副 14 张结构牌、5 次换牌、6 次签缘；亮组花一次求签，通常三选一，广缘兆应验时四选一
- 被动签选中即生效并收进摘要；顶部只有 3 格可主动使用的锦囊，首批为续巡、洗壁和点石
- 灵签已显示银 / 金 / 彩签阶；鸿运与广缘可在单格待缘位保留到下一次求签后消费
- 得分 `牌值 × 番势`，结算按固定顺序逐条播放动画，可点击快进
- 五系构筑：**灵签**（本副）· **番谱**（升番种）· **福将**（占将位）· **牌骨**（牌种静态材质）· **牌印**（牌种事件触发）
- 现行 41 张五系功能卡由单一 Library 管理；游龙 / 雷杠 / 七巧三条路线各有起势、成势、终局福将和流派灵签
- 开始界面可选牌组；存档当前为 schema v5，并保留 v1 → v5 逐版本迁移；随机全部走可复盘 seed

正式版测试：

```bash
node --test tests/src-*.test.mjs
node tests/src-viewport-smoke.mjs
```

进度、下一步与已知问题见 [`docs/09-progress.md`](docs/09-progress.md)。

## 历史原型

都还能跑，用于对照，不再跟进玩法改动：

- V3 街机切片 [`prototype/v3-arcade-demo/`](prototype/v3-arcade-demo/index.html)：六开运位 + 三签选一的第一版可玩证明
- V2 三副牌加商店版 [`prototype/v2-run-shop-demo/`](prototype/v2-run-shop-demo/index.html)
- V1 渐进锁组版 [`prototype/progressive-meld-demo/`](prototype/progressive-meld-demo/index.html)
- 初版单文件 Demo [`prototype/legacy-demo.html`](prototype/legacy-demo.html)（视觉基线，标题里的旧名不可用于发布）

## 项目目标

- 即点即玩，约 3 秒内出现第一次可操作界面。
- 单手触控优先，同时支持鼠标和键盘。
- 每个有效决策约 5–15 秒，每个检查点不超过 90 秒。
- 一套核心游戏，多套平台适配层。
- 玩法简单上手，深度来自灵签、番谱、福将、牌骨、牌印的组合和风险选择。

## 文档地图

1. [`docs/00-vision.md`](docs/00-vision.md) — 产品愿景和待定问题
2. [`docs/01-production-plan.md`](docs/01-production-plan.md) — 阶段、里程碑和冻结点
3. [`docs/02-game-design.md`](docs/02-game-design.md) — 核心玩法设计源文件
4. [`docs/03-ux-responsive.md`](docs/03-ux-responsive.md) — 横竖屏、触控和界面规则
5. [`docs/04-technical-architecture.md`](docs/04-technical-architecture.md) — 正式代码架构
6. [`docs/05-platform-matrix.md`](docs/05-platform-matrix.md) — YouTube、TikTok、Web、Meta
7. [`docs/06-qa-release.md`](docs/06-qa-release.md) — 测试和发布验收
8. [`docs/07-roadmap.md`](docs/07-roadmap.md) — 接下来的工作顺序
9. [`docs/08-content-catalog.md`](docs/08-content-catalog.md) — 五系内容与首批测试卡池
10. [`docs/09-progress.md`](docs/09-progress.md) — 当前实现、验收入口与已知问题
11. [`docs/decisions/`](docs/decisions/) — 已决定和待决定事项
12. [`docs/playtests/`](docs/playtests/) — 每次试玩记录

## 下一步

正式版框架、`0017` 六关短局和 `0029` 三格主动锦囊切片已经落在 `src/`，但这些玩法仍是 `Proposed`，不是冻结规则。接下来先用手机试玩锦囊的救胡感与使用率，再验证 5–8 分钟局长和商店频率。详见 [`docs/09-progress.md`](docs/09-progress.md)。
