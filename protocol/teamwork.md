# Teamwork Protocol Specification / 多智能体协作协议规范

[English](#english) | [中文](#中文)

---

## English

### 1. Overview & System Positioning

`agent-teamwork` orchestrates multi-agent teams across long-horizon engineering tasks, combining milestone-driven execution with cutting-edge AI engineering paradigms (**Agentless, DyLAN/MacNet Dynamic Topology, CRITIC/Reflexion Empirical Verification, and Google Research Harness² Recursive Adaptation**):
- **Phase 1: Scoping Interview & Alignment**: Confirms objective, "goal behind the goal", non-goals, deliverable shape contract, and acceptance criteria (`protocol/scoping-interview.md`).
- **Phase 2: Hybrid Experience Retrieval & Dynamic Topology Planning**:
  - Scores transferable lessons from `~/.config/agent-teamwork/experience.json` via BM25/Jaccard cue matching + confidence weighting (`rankExperienceLibrary`).
  - Converts nominal goals to action verbs (`restatedGoal`).
  - Synthesizes initial invariant and domain guardrails (`composeHarnessGuardrails`).
  - Dynamically routes milestone execution topology across Low, Medium, High, and Critical risk tiers (`resolveMilestoneTopology`).
  - Splits work into sequential milestones with mutually exclusive `allowedPaths`.
- **Phase 3: Parallel Milestone Execution & Empirical Micro-Test Synthesis**:
  - Snapshots baseline dirty files before milestone execution.
  - If no global `verifyCommand` is provided, synthesizes language-aware empirical micro-test plans (`synthesizeMicroTestPlan`).
  - Enforces surgical block edit discipline (`<replace>` over monolithic rewrites) and pre-flight syntax checks (`python -m py_compile`, `node --check`).
  - Injects budget urgency alerts to prevent analysis paralysis in late rounds.
  - Dispatches parallel worker items with clean contexts and active Harness² guardrails.
  - Computes incremental out-of-bounds file modifications via `findOutOfBoundsFiles`.
- **Phase 4: Adversarial Quality Gate & Guardrail Evolution**:
  - Critic verifies real diffs and executes synthesized micro-tests, proposing concise `invariant`/`domain` guardrails when gaps occur.
  - Challenger produces structured `{ foundIssue: boolean, evidence: string }` to prevent unevidenced rework loops.
  - Merges and dedupes active guardrails using `composeHarnessGuardrails`.
- **Phase 5: Targeted Rework, Stall Signature Early-Exit & Replanning**:
  - Up to 3 rework rounds enforcing `allowedPaths` and adversarial re-verification.
  - Exits early if `computeGapSignature` repeats across consecutive rounds.
  - If still failing, marks superseded failed milestones (`superseded: true`), composes updated Harness² guardrails, and re-plans remaining work.
- **Phase 6: Final Acceptance Command & End-to-End Audit**:
  - Deterministic verification command with tail output preservation (`formatFailureOutput`) and `computeFailureSignature` stall detection.
  - Honest conclusion strictly reflecting `verifyPassed` and `openGaps` (`calculateTeamworkOpenGaps`).
- **Phase 7: Harness² Experience Reflection & Reporting**:
  - Auditor distills non-confounded `{ cue, lesson, evidence, verdict, confidence }` entries (`isValidExperienceEntry`) into the persistent Experience Library.
  - Scribe generates the deliverable report.

### 2. State Machine (English)

```
[User Confirmed Scope]
         │
         ▼
Phase 1: Hybrid Experience Retrieval (rankExperienceLibrary) & Dynamic Topology Planning
         │
         ▼
Milestone Loop (Queue):
   ├── Per-Milestone Fresh Context + Baseline Git Dirty Snapshot
   ├── Resolve Dynamic Risk Topology (Low / Med / High / Critical)
   ├── Empirical Micro-Test Plan Synthesis (synthesizeMicroTestPlan if verifyCommand absent)
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

### 1. 概述与系统定位

`agent-teamwork` 面向长周期复杂工程任务编排多智能体团队，融合前沿 AI 工程学方法论（**Agentless、DyLAN/MacNet 动态拓扑路由、CRITIC/Reflexion 实证微测、以及 Google Research Harness² 递归自适应**）：
- **阶段一：范围访谈与契约对齐**：确认直接目标、“目标背后的目标”、明确不做的边界、交付物形态契约锁与统一验收标准（详见 `protocol/scoping-interview.md`）。
- **阶段二：混合经验检索、动词化与动态拓扑规划**：
  - 基于 BM25/Jaccard 线索匹配与置信度权重检索跨任务经验库（`rankExperienceLibrary`）。
  - 完成动词化改写（`restatedGoal`）。
  - 合成初始通用纪律（invariant）与领域规则（domain）护栏（`composeHarnessGuardrails`）。
  - 动态解析里程碑风险拓扑（`resolveMilestoneTopology`：低/中/高/高危风险路由）。
  - 拆解为 `allowedPaths` 互斥的顺序里程碑。
- **阶段三：增量快照施工、实证微测合成与路径边界拦截**：
  - 开工前记录工作区基准脏文件快照。
  - 若未提供统一命令，针对交付物自动合成实证微测方案（`synthesizeMicroTestPlan`）。
  - 执行手术式局部块编辑纪律（`<replace>` 优于全文件重写）与单文件语法预检（`python -m py_compile`、`node --check`）。
  - 在多轮后程注入预算紧迫感告警，坚决打破分析瘫痪。
  - 以独立上下文和动态护栏并行派发施工工作项。
  - 施工后通过 `findOutOfBoundsFiles` 精准拦截越界改动。
- **阶段四：质检验收与结构化对抗挑战**：
  - 质检验收员核验真实代码并运行实证微测，针对缺口提议动态护栏。
  - 对抗挑战员强制输出 `{"foundIssue": boolean, "evidence": string}`，无确凿实证绝不触发无效返工。
  - 调用 `composeHarnessGuardrails` 合并与进化护栏。
- **阶段五：靶向返工、停滞签名早停与整体重规划**：
  - 最多 3 轮外科手术式返工（严守 `allowedPaths` 并支持返工后二次挑战）。
  - 若连续两轮 `computeGapSignature` 缺口签名完全一致则立即早停。
  - 若仍卡死且有重规划配额，将原失败记录标记为 `superseded: true`，升级护栏并重规划剩余里程碑。
- **阶段六：终局统一验收命令与全面审计**：
  - 运行 `verifyCommand`（合并保留末尾 2000 字符堆栈 + 失败签名早停），如实记录 `verifyPassed` 状态。
- **阶段七：Harness² 经验反思与综合报告**：
  - 总审计员提炼非混杂（剔除 `confounded`）的可迁移经验写回经验库。
  - 报告撰写员产出客观克制的交付报告。

### 2. 状态机（中文）

```
[用户确认范围说明书]
         │
         ▼
阶段 1：混合经验检索 (rankExperienceLibrary) & 动态拓扑规划
         │
         ▼
里程碑队列循环 (Queue)：
   ├── 新建里程碑独立上下文 + 记录基准 Git 脏文件快照
   ├── 动态解析风险拓扑 (低 / 中 / 高 / 高危)
   ├── 合成实证微测方案 (synthesizeMicroTestPlan 若未提供命令)
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
