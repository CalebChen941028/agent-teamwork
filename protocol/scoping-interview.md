# Scoping Interview Guide / 范围访谈指南

[English](#english) | [中文](#中文)

---

## English

### Overview
Before initiating any multi-agent teamwork execution, a scoping interview must be conducted with the user to align on boundaries, deliverable shapes, and risk tiers to prevent scope creep or misdirected effort.

### Core Interview Dimensions
1. **Objective & Context**: What specific business or engineering problem is being solved, and who are the stakeholders?
2. **The Goal Behind the Goal (Crucial)**:
   - Ask: *"Once this task is completed, what specific state, decision, or action do you expect to occur?"*
   - Heuristic: If completing the task still necessitates another meeting to figure out what to do, the objective can be elevated one level higher (e.g., from "Write a quarterly metrics slide deck" to "Equip executives to make 3 resource-allocation decisions in 30 minutes").
3. **Deliverable Shape Contract (`DELIVERABLE SHAPE LOCK`)**:
   - What are the exact required file paths, export symbol names, API method signatures, schema fields, or UI DOM selectors?
   - Agents must optimize *how* work is constructed without mutating *what shape* was requested.
4. **Deterministic Acceptance Criteria & Verification Anchor**:
   - Is there a deterministic test command (`npm test`, `pytest`, `cargo test`)?
   - If no test command exists, specify the empirical verification criterion so the system can synthesize a micro-test plan (`synthesizeMicroTestPlan`).
5. **Scope Boundaries (Non-Goals)**: What is explicitly *out of scope* for this initiative?
6. **Risk Tiering (Low / Medium / High / Critical)**:
   - Are there security, cryptography, database migrations, or breaking API changes involved? (Routes to `resolveMilestoneTopology`).

### Scoping Document Template
```markdown
# Initiative Scope Document
- **Primary Goal**: ...
- **The Goal Behind the Goal**: ...
- **Deliverable Shape Contract**:
  - File paths, export symbols, schema fields, or output shapes: ...
- **Acceptance Criteria**:
  1. ...
  2. ...
- **Out of Scope (Non-Goals)**:
  - ...
- **Target Directories & Code Paths**:
  - `src/...`
- **Verification Command**: `npm test` / `pytest` (or "None - synthesize empirical micro-tests")
- **Risk Tier**: `Low` | `Medium` | `High` | `Critical`
```

---

## 中文

### 概述
在启动多智能体协作之前，必须与用户完成范围访谈，锁定工作边界、交付形态契约与风险层级，避免无意义的膨胀或方向偏差。

### 核心访谈维度
1. **目标与背景**：要解决什么具体问题、交付给谁使用？
2. **目标背后的目标（终极追问）**：
   - 必问：*“这个任务做成之后，你希望发生什么实质性变化或推动什么决策？”*
   - 检验信号：如果这件事做完之后还需要开会讨论下一步，说明目标还能再提一层（如“制作季度汇报 PPT” $\rightarrow$ “让管理层在 30 分钟内对齐关键数据并作出三项预算决策”）。
3. **交付物形态强契约锁（`Deliverable Shape Lock`）**：
   - 明确具体的文件路径、导出符号名、接口签名、数据表字段或前端 DOM 选择器。
   - 智能体只能优化施工方式，严禁篡改用户指定的交付物结构与签名。
4. **验收标准与验证锚点**：
   - 是否有确定性的验收命令（`npm test`、`pytest`、`cargo test`）？
   - 若未提供，需明确可观测判据，以便系统自动合成实证微测方案（`synthesizeMicroTestPlan`）。
5. **范围边界（明确不做什么）**：本次绝对不碰哪些模块或延伸需求？
6. **风险等级判定（低 / 中 / 高 / 高危）**：
   - 是否涉及安全鉴权、数据迁移、核心重构或破坏性变更？（驱动 `resolveMilestoneTopology` 拓扑路由）。

### 任务范围说明书模板
```markdown
# 任务范围说明书
- **直接目标**：...
- **目标背后的目标**：...
- **交付物形态契约**：
  - 文件路径、导出符号、数据结构或输出形态契约：...
- **验收标准**：
  1. ...
  2. ...
- **明确不做（边界）**：
  - ...
- **涉及模块与文件路径**：
  - `src/...`
- **统一验收命令**：`npm test`（或“无，自动合成实证微测方案”）
- **风险等级**：`低 (Low)` | `中 (Medium)` | `高 (High)` | `高危 (Critical)`
```
