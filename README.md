# Production Source · 天胡 TIANHU

正式代码。玩法改动只在这里发生，`prototype/` 下的 Demo 已归档为历史对照。

开发与测试要求 Node.js 22+；项目目前零 npm 依赖。

```bash
python3 -m http.server 4173 --bind 127.0.0.1
# 打开 http://127.0.0.1:4173/src/  （?seed=数字 复盘，&intro=0 跳过说明）
```

## 分层

```text
core/       规则内核，纯 JS，不碰 DOM
  tiles     牌与牌种、可复盘随机源
  patterns  胡牌分解与番种识别
  shanten   还差几张
  deal      保底可解发牌（可指定必现牌种）
  effects   五系效果的唯一解释器
  scoring   八步结算流水线，输出有序 steps
  run       一局状态机：三圈 × 三关 × 两副、跳局、最多八家百宝阁
content/    五系内容，以及圈关 / 圈主 / 牌组 / 手气 / 牌帖数据
state/      存档：schemaVersion 3 + v1 → v2 → v3 迁移
render/     像素绘制（牌面、印章、像素字），零外部请求
ui/         开始 / 选牌组 / 选关 / 牌桌 / 商店界面、动画、音效
platforms/  平台适配层接口与 web 实现
main.mjs    启动组装
```

依赖方向固定为 `ui → core → content`。`core` 不引用 `ui`、`render`、`platforms`，
所以规则可以在 Node 里直接测试。

## 约定

- 只用具名导出，不用默认导出。
- 新玩法内容先进 `content/`，效果类型不够用时才动 `core/effects.mjs`。
- 结算顺序由 `core/scoring.mjs` 唯一决定；动画只是它的播放器，不参与算分。
- 卡面文案必须写明 `本副` / `本关` / `本局` / `一次性` / `局外`，不写「永久」。
- 改了规则就补 `tests/src-*.test.mjs`；改了界面就跑 `tests/src-viewport-smoke.mjs`。

```bash
node --test tests/src-*.test.mjs
node tests/src-viewport-smoke.mjs
```

技术分层见 `docs/decisions/0012-production-stack-and-layering.md`；当前圈关实现见状态仍为
`Proposed` 的 `docs/decisions/0013-ante-structure-and-meta-shell.md`；当前进度见 `docs/09-progress.md`。
