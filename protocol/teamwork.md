# Teamwork Protocol Specification / 多智能体协作协议规范

[English](#english) | [中文](#中文)

---

## English

### 1. Overview

`agent-teamwork` orchestrates multi-agent teams across long-horizon engineering tasks, combining milestone-driven execution with **Harness² Recursive Adaptation**:
- **Phase 1: Scoping Interview & Alignment**: Confirms objective, "goal behind the goal", non-goals, deliverable shape contract, and acceptance criteria (`protocol/scoping-interview.md`).
- **Phase 2: Experience Lookup & Milestone Decomposition**: Loads transferable `{ cue, lesson, evidence }` entries from the cross-task Experience Library (`~/.config/agent-teamwork/experience.json`), converts nominal goals to verbs (`restatedGoal`), emits initial `invariant`/`domain` guardrails, and splits work into sequential milestones with non-overlapping `allowedPaths`.
- **Phase 3: Parallel Milestone Execution & Incremental Boundary Check**: Snapshots baseline dirty files, dispatches parallel worker items with clean contexts and active Harness² guardrails, and computes incremental out-of-bounds file modifications via `findOutOfBoundsFiles`.
- **Phase 4: Adversarial Quality Gate & Guardrail Proposal**: Critic checks milestone completion and incremental path boundaries, proposing concise `invariant`/`domain` guardrails when gaps occur; Challenger produces structured `{ foundIssue: boolean, evidence: string }` to prevent empty suspicion reworks.
- **Phase 5: Targeted Rework, Stall Signature Early-Exit & Replanning**: Up to 3 rework rounds enforcing `allowedPaths` and adversarial re-verification. Exits early if `computeGapSignature` repeats across consecutive rounds. If still failing, marks superseded failed milestones (`superseded: true`), composes updated Harness² guardrails, and re-plans remaining work.
- **Phase 6: Final Acceptance Command & End-to-End Audit**: Deterministic verification command with tail output preservation and `computeFailureSignature` stall detection; honest conclusion reflecting command success or failure.
- **Phase 7: Harness² Experience Reflection & Reporting**: Auditor distills non-confounded `{ cue, lesson, evidence, verdict, confidence }` entries into the persistent Experience Library; Scribe generates the deliverable report.

### 2. State Machine (English)

```
[User Confirmed Scope]
         │
         ▼
Phase 1: Load Experience Library (.teamwork/experience.json) & Plan Milestones
         │
         ▼
Milestone Loop (Queue):
   ├── Per-Milestone Fresh Context + Baseline Git Dirty Snapshot
   ├── Parallel Worker Execution (allSettled + heavy retry + active Guardrails)
   ├── Incremental Out-of-Bounds Path Check (findOutOfBoundsFiles)
   ├── Critic Acceptance Check (+ propose invariant/domain Guardrails)
   ├── Adversarial Challenge (Structured { foundIssue, evidence })
   └── Rework Loop (Up to 3 rounds, allowedPaths + gap-signature stall early-exit)
         ├── Passed (Critic + Challenger) ──► Add to Facts Ledger ──► Next Milestone
         └── Failed or Stalled?
                 ├── Replans Available? ──► Compose New Guardrails & Re-plan Queue ──► Mark Failed Milestone Superseded
                 └── Replans Exhausted? ──► Record Open Gap ──► Next Milestone
         │
         ▼
Phase 6: Final Verification Command (Tail Capture + Failure Signature Early-Exit)
   ├── Exit 0? ──► verifyPassed = true
   └── Exit != 0? ──► verifyPassed = false ──► Add to Open Gaps & Findings
         │
         ▼
Phase 7: End-to-End Audit, Harness² Experience Reflection & Report Generation
   ├── Filter out "confounded" lessons; persist validated { cue, lesson, evidence }
   └── Conclusion reflects: openGaps, verifyPassed status, and audit verdict
```

---

## 中文

### 1. 概述

`agent-teamwork` 面向长周期复杂工程任务编排多智能体团队，融合里程碑并行推进与 **Harness² 双层递归自适应**：
- **阶段一：范围访谈与边界对齐**：确认直接目标、“目标背后的目标”、明确不做的边界、交付物形态契约锁与统一验收标准（详见 `protocol/scoping-interview.md`）。
- **阶段二：经验库检索与里程碑拆解**：读取跨任务持久化经验库（`~/.config/agent-teamwork/experience.json`）中的 `{ cue, lesson, evidence }` 三元组；完成动词化改写（`restatedGoal`），输出初始 `invariant`（通用纪律）与 `domain`（领域规范）护栏，并拆解为 `allowedPaths` 互不重叠的顺序里程碑。
- **阶段三：并行施工与增量路径边界校验**：开工前记录工作区基准脏文件快照，以独立上下文和动态护栏并行派发施工工作项，施工后通过 `findOutOfBoundsFiles` 比对本里程碑新增改动文件，精准拦截跨界修改。
- **阶段四：质检验收与结构化对抗挑战**：质检验收员核验真实代码与测试输出，针对缺口提议 `proposedGuardrails`；对抗挑战员强制输出 `{"foundIssue": boolean, "evidence": string}`，无确凿实证绝不触发无效返工。
- **阶段五：靶向返工、停滞签名早停与整体重规划**：最多 3 轮外科手术式返工（严守 `allowedPaths` 并支持返工后二次挑战）；若连续两轮 `computeGapSignature` 缺口签名完全一致则立即早停；若仍卡死且有重规划配额，将原失败记录标记为 `superseded: true`，升级护栏并重规划剩余里程碑。
- **阶段六：终局统一验收命令与全面审计**：运行 `verifyCommand`（合并保留末尾 2000 字符堆栈 + 失败签名早停），如实记录 `verifyPassed` 状态。
- **阶段七：Harness² 经验反思与综合报告**：总审计员提炼非混杂（剔除 `confounded`）的可迁移经验写回经验库，报告撰写员产出客观克制的交付报告。

### 2. 状态机（中文）

```
[用户确认范围说明书]
         │
         ▼
阶段 1：加载跨任务经验库 (.teamwork/experience.json) & 动词化拆解里程碑
         │
         ▼
里程碑队列循环 (Queue)：
   ├── 新建里程碑独立上下文 + 记录基准 Git 脏文件快照
   ├── 并行施工 (Promise.allSettled + 强模型自动重试 + 动态护栏注入)
   ├── 增量路径越界检查 (findOutOfBoundsFiles)
   ├── 质检验收员核对 (+ 提议 invariant/domain 动态护栏)
   ├── 对抗挑战员攻击 (结构化 { foundIssue, evidence })
   └── 靶向返工循环 (最多 3 轮，allowedPaths 硬约束 + 缺口签名早停)
         ├── 通过 (质检 + 二次挑战) ──► 记入事实账本 ──► 下一里程碑
         └── 失败或停滞？
                 ├── 仍有重规划额度？ ──► 升级动态护栏 & 重规划剩余队列 ──► 原失败记录标为 Superseded
                 └── 重规划额度耗尽？ ──► 记入未解决缺口 (Open Gap) ──► 下一里程碑
         │
         ▼
阶段 6：终局统一验收命令 (保留末尾 2000 字符 + 错误签名早停)
   ├── 退出码 0？ ──► verifyPassed = true
   └── 退出码 != 0？ ──► verifyPassed = false ──► 记入 Open Gaps 与高危 Findings
         │
         ▼
阶段 7：端到端总审计、Harness² 经验反思 & 报告交付
   ├── 剔除 "confounded" 混杂归因，持久化有效 { cue, lesson, evidence }
   └── 结论文案严格对齐 openGaps、verifyPassed 与审计结论
```
