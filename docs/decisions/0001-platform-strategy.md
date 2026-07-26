# 0001 — Platform Strategy

状态：`Accepted`

日期：2026-07-24

## 决定

把游戏设计为即点即玩的轻量 HTML5 游戏。优先支持 YouTube Playables、TikTok Mini Games HTML runtime 和普通移动网页；Meta/Facebook 作为后续候选。

核心游戏与平台 SDK 分离，通过 adapter 提供启动、存档、音频、暂停、语言和分数能力。

## 原因

- 目标场景是排队、等人、通勤等碎片时间。
- HTML5 可以共享大部分代码和内容。
- 当前原型已经使用 Web 技术并具有较小包体。

## 后果

- 所有核心交互必须支持触控。
- 必须优先控制加载时间、包体和恢复能力。
- 不能把平台专属能力写进游戏规则层。
