# Tests

环境要求：Node.js 22+。项目目前不需要安装 npm 依赖。

## 正式版（src/）

```bash
node --test tests/src-*.test.mjs     # 规则 / 结算 / 一局流程 / 存档 / 集成
node tests/src-viewport-smoke.mjs    # required 视口 + 开始 / 牌组 / 选关 / 牌桌 / 商店流程
```

- `src-rules`：1–4 张动作、胡牌分解、七种番种、还差几张、发牌器保底与必现牌种。
- `src-scoring`：`0011` 八步结算顺序、steps 累加自洽、五系各自的贡献与上限。
- `src-run`：开运位经济、三签选一、三圈 × 三关 × 两副、跳局手气、圈主、牌组、商店与失败重试。
- `src-save`：往返、半副恢复后结果一致、v1 → v2 → v3 迁移、坏档不覆盖进度。
- `src-integration`：固定 seed 整局可复现、最多八家百宝阁、长期内容确实改变后续结算。

正式版规则与集成测试只跑 `src-*`；全仓规则回归（包含历史原型）可用：

```bash
node --test tests/*.test.mjs
```

## 原型时期的回归测试

渐进锁组 Demo 规则测试：

```bash
node --test tests/progressive-meld-rules.test.mjs
```

V2 三副牌、待结算经济、牌型、商店与第二轮流程测试：

```bash
node --test tests/run-shop-demo.test.mjs
```

V3 街机切片规则、发牌器、开运位经济、三签选一与百宝阁测试：

```bash
node --test tests/v3-arcade-demo.test.mjs
```

V2 required 视口与商店 smoke test（需要本机 Chrome；脚本会自行启动临时静态服务器）：

```bash
node tests/v2-viewport-smoke.mjs
```

该脚本检查页面级滚动、关键区域裁切、14 张牌可见、最小触控区、手牌溢出和 resize 状态保持，并覆盖 360×800、390×844、844×390、768×1024、960×960、1280×720 以及商店横竖屏。

V3 required 视口 smoke test（同样需要本机 Chrome，使用固定 seed 自动打完三副牌；这是历史原型检查，不代表正式版圈关流程）：

```bash
node tests/v3-viewport-smoke.mjs
```

除上面六个视口外，还检查玩法说明屏、三签选一面板（最窄竖屏与主横屏）、结算屏、百宝阁横竖屏，以及 6 个开运位是否始终在场。加 `KEEP_VIEWPORT_ARTIFACTS=1` 可保留截图目录。
