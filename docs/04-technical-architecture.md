# Technical Architecture

状态：`Accepted`（技术栈与分层见 `decisions/0012`；平台 SDK 细节仍待定）

## 原则

- 保留轻量 Web 技术优势，不为了“完整”而引入重型引擎。
- 游戏核心与 DOM/Canvas、音频和平台 SDK 解耦。
- 所有平台共享同一份规则、内容和存档格式。
- 构建产物自包含、可测试、可重复生成。

## 建议目录

```text
src/
├── core/          # 牌型、距离、发牌、五系效果、结算流水线、一局状态机
├── content/       # 五系内容表与关卡表
├── state/         # 存档序列化、版本迁移与有序写入协调
├── ui/            # 界面、动画、音效
├── render/        # 麻将牌与像素图形
├── platforms/     # web / youtube / tiktok / meta 适配层
└── main.mjs       # 启动与依赖组装
```

依赖方向固定为 `ui → core → content`；`core` 不引用 `ui`、`render`、`platforms`。

## 平台接口

核心游戏只依赖统一接口：

```ts
interface PlatformAdapter {
  initialize(): Promise<void>;
  signalFirstFrame(): void;
  signalReady(): void;
  loadSave(): Promise<string | null>;
  save(data: string): Promise<void>;
  submitScore(score: number): Promise<void>;
  getLanguage(): Promise<string>;
  isAudioEnabled(): Promise<boolean>;
  onAudioChange(callback: (enabled: boolean) => void): () => void;
  onPause(callback: () => void): () => void;
  onResume(callback: () => void): () => void;
}
```

## 存档

最低包含：

- `schemaVersion`
- 当前 seed 与随机数进度
- 当前关卡和游戏状态
- 牌库、福神牌、道具、金钱和等级
- 已解锁内容与设置
- 最佳分数

每个版本提供显式迁移函数，不直接覆盖无法解析的旧存档。

所有平台的真实 `save` 调用必须严格串行：普通状态可短暂防抖，只保留尚未入队的最新快照；求签打开、重抽、选择、签兆替换和生命周期暂停等关键点立即入队。单次平台写入失败不能堵死后续保存，也不能允许旧请求晚完成后覆盖新状态。

## 测试边界

- 牌型识别：表驱动单元测试。
- 计分：固定 seed 的结果测试。
- 存档：往返序列化、旧版本迁移、异步写入顺序与失败恢复测试。
- UI：视口矩阵截图和关键按钮可达性。
- 平台：SDK mock 与官方 test suite。

## 已定技术决定（`decisions/0012`）

- 原生 ES Module + JSDoc，零依赖；不引入 TypeScript 与打包器，等内容规模或协作人数上来再迁移。
- 保留像素 Canvas 牌面渲染器：34 个牌种运行时自绘并缓存，零外部请求。
- 内容配置就是 `src/content/` 下的纯数据模块，不额外引入 JSON 或代码生成。
- 五系功能卡由 `src/content/library.mjs` 的单一 `CONTENT_LIBRARY` 管理；抽签、商店、计分和百牌谱共用同一数据对象。下架使用 `enabled: false`，无存档迁移不硬删 id。见 `decisions/0018-unified-content-library.md`。
- 结算流水线输出有序 steps，动画照着播，不参与算分。
- 存档存完整手内状态 + `schemaVersion`，不用 seed 重放。
- 当前正式切片使用 schema v5：除 v4 状态外，保存三格`satchel`、主动目标选择`activeChoice`、
  奖励型 / 额外换牌分账、洗壁次数与本副改命限制；v4 → v5 显式迁移为空锦囊且保留旧换牌收益。
- 灵签数据以`resolution: immediate | reserve`区分选中即生效与收入锦囊，主动规则挂在 Library 的`active`描述；
  `core/run.mjs`执行规则，`ui/app.mjs`只根据快照渲染确认与目标流程。

## 待定技术决定

- Playables 单文件包的构建脚本与体积预算。
- 局外存档是否与本局存档分库。
- 各平台 SDK 的真实生命周期时序。
- 是否需要回放能力。
