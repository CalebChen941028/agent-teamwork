# Scoping Interview Guide / 范围访谈指南

[English](#english) | [中文](#中文)

---

## English

### Overview
Before initiating any multi-agent teamwork execution, a scoping interview must be conducted with the user to align on boundaries and prevent scope creep or misdirected effort.

### Core Interview Dimensions
1. **Objective & Context**: What specific business or engineering problem is being solved, and who are the stakeholders?
2. **The Goal Behind the Goal (Crucial)**:
   - Ask: *"Once this task is completed, what specific state, decision, or action do you expect to occur?"*
   - Heuristic: If completing the task still necessitates another meeting to figure out what to do, the objective can be elevated one level higher (e.g., from "Write a quarterly metrics slide deck" to "Equip executives to make 3 resource-allocation decisions in 30 minutes").
3. **Acceptance Criteria**: What deterministic, observable criteria define success?
4. **Scope Boundaries (Non-Goals)**: What is explicitly *out of scope* for this initiative?
5. **Architectural Assets**: Which modules, directories, or existing test suites (`npm test`, `pytest`, `cargo test`) serve as verification anchors?

### Scoping Document Template
```markdown
# Initiative Scope Document
- **Primary Goal**: ...
- **The Goal Behind the Goal**: ...
- **Acceptance Criteria**:
  1. ...
  2. ...
- **Out of Scope (Non-Goals)**:
  - ...
- **Target Directories & Code Paths**:
  - `src/...`
- **Verification Command**: `npm test` / `pytest`
```

---

## 中文

### 概述
在启动多智能体协作之前，必须与用户完成范围访谈，锁定工作边界，避免无意义的膨胀或方向偏差。

### 核心访谈维度
1. **目标与背景**：要解决什么具体问题、交付给谁使用？
2. **目标背后的目标（终极追问）**：
   - 必问：*“这个任务做成之后，你希望发生什么实质性变化或推动什么决策？”*
   - 检验信号：如果这件事做完之后还需要开会讨论下一步，说明目标还能再提一层（如“制作季度汇报 PPT” $\rightarrow$ “让管理层在 30 分钟内对齐关键数据并作出三项预算决策”）。
3. **验收标准**：怎样算完成？可操作、可验证的客观判据是什么？
4. **范围边界（明确不做什么）**：本次绝对不碰哪些模块或延伸需求？
5. **关联资产与命令**：涉及的工作区目录、现有的构建/测试验收命令。

### 任务范围说明书模板
```markdown
# 任务范围说明书
- **直接目标**：...
- **目标背后的目标**：...
- **验收标准**：
  1. ...
  2. ...
- **明确不做（边界）**：
  - ...
- **涉及模块与文件路径**：
  - `src/...`
- **统一验收命令**：`npm test`（或自定义脚本）
```
