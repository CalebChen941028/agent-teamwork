---
name: teamwork
description: >-
  Teamwork 多智能体团队：编排者拆里程碑 → 多个施工 agent 并行推进（文件互不重叠）→ 每个里程碑
  过质检验收与对抗挑战 → 终局审计与报告。当用户输入 /teamwork，或要求以团队/多 agent 方式推进
  大型多步骤任务（整块新功能、大规模重构、深度研究课题、多模块改造）时使用。单点小任务不要用。
  启动前必须先与用户完成范围访谈。
  Teamwork multi-agent collaborative execution engine. Decomposes large initiatives into sequential milestones
  with non-overlapping parallel worker items. Features per-milestone quality gates, adversarial challenge attacks,
  stall replanning, and end-to-end audit. Requires scoping interview before kickoff.
---

# Teamwork — 多智能体团队协作 (Multi-Agent Teamwork Initiative)

概念受公开文档化的 agent 编排工作流启发（如 Google Antigravity 的 `/teamwork-preview`；机制实现主要参考开源项目 Magentic-One 与 claude-flow）。独立实现，与 Google 无关联、未获其背书；Antigravity 是 Google LLC 的商标，此处仅作概念说明。由动态工作流 `teamwork` 驱动。

## 阶段一：范围访谈 (Phase 1: Scoping Interview)

在启动团队之前，必须先与用户完成范围对齐（详见 `protocol/scoping-interview.md`），产出经用户确认的范围说明书：
1. **核心目标与背景**：要解决什么，服务谁。
2. **目标背后的目标 (The Goal Behind the Goal)**：这件事做成之后希望发生什么。
3. **可度量验收标准**：具体完成标准与测试/构建命令。
4. **范围边界与非目标 (Non-Goals)**：明确不做什么。
5. **涉及模块与文件路径**。

## 阶段二：启动交互协议 (Phase 2: Launch Protocol)

### 第 1 步：档位 + 诚信模式选择

- **编队档位 (teamProfile)**：
  1. **hybrid 混流（推荐）** — 编排者对工作项难度分层：机械/文档/样板类使用轻量模型，核心逻辑使用强模型；把关角色全程强模型。
  2. **quality 全强** — 所有角色均使用强模型。
  3. **economy 省钱** — 全部施工下沉轻量模型，质检/挑战/审计强模型把关。
- **诚信模式 (integrityMode)**：
  1. **development（推荐）** — 质检验收员把关每个里程碑。
  2. **demo** — 另加对抗挑战员二次攻击，防止夸大陈述。
  3. **benchmark** — 最严要求：每条结论必须附带亲自运行命令或读代码的证据。

### 第 2 步：启动工作流

```json
{
  "saved": {
    "name": "teamwork",
    "args": {
      "task": "<用户确认过的范围说明全文>",
      "integrityMode": "development",
      "teamProfile": "hybrid",
      "lightModel": "",
      "verifyCommand": "npm test"
    }
  }
}
```

## 核心机制 (Core Architecture)

- **动词化改写与跨域借法**：编排者将名词目标转写为动词行动，借用成熟工程与统计方法。
- **事实账本 (Facts Ledger)**：跨里程碑维护事实记录，避免累积历史上下文导致锚定偏差。
- **结构化对抗挑战 (Structured Adversarial Challenge)**：严格输出 `{"foundIssue": boolean, "evidence": string}`，无真凭实据不触发虚假返工。
- **严格路径隔离 (allowedPaths)**：各工作项分配互不重叠的文件路径；里程碑结束自动进行 git 越界检查。
- **停滞重规划 (Stall Replanning)**：里程碑返工 3 轮未过时，原记录标记为 `superseded`，触发一次全局重规划。
- **终局统一命令验收**：统一运行 `verifyCommand`；失败时准确记录 `verifyPassed = false` 并计入未解决缺口。

## Credits

- Architecture influenced by Microsoft Magentic-One (outer-loop stall adaptation, task ledger).
- Structured teamwork and scoping protocols inspired by claude-flow and Felix Rieseberg's workflows.
- Antigravity is a trademark of Google LLC. This open-source implementation is completely independent.
