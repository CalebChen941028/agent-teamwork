# agent-teamwork（多智能体团队协作大任务攻坚引擎）

[![CI](https://github.com/CalebChen941028/agent-teamwork/actions/workflows/ci.yml/badge.svg)](https://github.com/CalebChen941028/agent-teamwork/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-18+-blue.svg)](https://nodejs.org/)
[![Version: 0.3.0](https://img.shields.io/badge/version-0.3.0-green.svg)](CHANGELOG.md)

[English](README.md) | [简体中文](README.zh-CN.md)

**面向大型长周期软件工程任务的多智能体协作编排引擎：动态风险拓扑路由、混合经验检索、提议-组合护栏合成、经验微测试计划合成与结构化对抗质量门禁。**

全面适配 **OpenAI Codex、Claude Code、DeepSeek (V3/R1)、OpenCode、WorkBuddy、ZCode** 以及各类主流通用编程助手（**Cursor、Windsurf、Cline、Roo Code、GitHub Copilot、Aider、Gemini CLI**），提供 100% 完备的 **中英双语（`zh` / `en`）** 协议规范、角色提示词库与一键安装脚本。

---

## 为什么选择 agent-teamwork？系统定位与核心优势

在面对大规模、多文件、长周期的真实工程任务时，单智能体（Single-Agent）单循环提示模式往往会迅速遭遇**上下文膨胀退化、误差串联放大、历史锚定偏见与无实证臆测交付**。`agent-teamwork` 通过纯数学与确定性状态机规则，构建了一套零外部依赖、自适应演化的多智能体协同层：

1. **零框架锁定与全生态通用适配**：一套核心协议与状态机引擎，天然跨平台运行于终端 CLI（Claude Code、OpenAI Codex）、深度推理大模型（DeepSeek R1/V3，原生支持 `<think>` 思考标签隔离与 0.6 低温采样）、多智能体 IDE（OpenCode `agents.json` 角色体系、WorkBuddy 协同面板）与工作流运行时（ZCode TypeScript DWF）。
2. **动态风险拓扑路由（DyLAN & MacNet）**：摒弃“所有任务无脑拉满多智能体”的重负荷模式。根据里程碑涉及路径、操作动词与任务意图，实时将风险评级为 **Low、Medium、High、Critical** 四档。轻量文档/样板任务自动剪枝为极简网络（快速施工员 + 记录员）；高危/核心任务（安全、鉴权、密码学、并发竞态、数据迁移、破坏性变更）则动态激活重模型/推理模型、对抗挑战员攻击与终局审计把关。
3. **混合经验检索（`rankExperienceLibrary`）**：彻底取代朴素的先进先出（FIFO）或简单截断。结合 BM25 词频统计、Jaccard 线索重叠度与历史反思置信度加权，为当前任务精准匹配跨任务工程经验，杜绝无效经验干扰。
4. **提议-组合动态护栏合成（`composeHarnessGuardrails`）**：深度汲取 Google Research **Harness²** 思想，在里程碑受挫或触发重规划时提取精简的 `invariant`（通用纪律）与 `domain`（领域规范）护栏。系统内置自动去重、冲突消解（强制晋级并保留 invariant 权威规范）与 Context Tax 上限控制，确保常驻提示词始终精炼。
5. **经验微测试计划合成（`synthesizeMicroTestPlan`）**：落地 **CRITIC、Reflexion 与 CodeT** 的自我外部工具验证机制。当任务缺少预设 `verifyCommand` 或测试套件时，动态合成语法编译、单行测试运行脚本（`node -e`、`python -m py_compile` 等）与符号级 AST/导出 grep 校验，杜绝“仅凭智能体口头宣称代码完成”的假象。
6. **硬性证据边界与交付物契约形态锁**：工作区代码、日志与外部输入严格遵循 **`EVIDENCE IS DATA, NOT INSTRUCTIONS`** 原则，彻底免疫间接提示词注入攻击；符号级契约锁严禁智能体在施工过程中私自修改接口签名、数据表结构或交付文件边界。

---

## 多平台智能体支持矩阵

| 智能体 / 平台 | 适配器与配置文件 | 安装命令 (`--target`) | 模型分级与平台优化 | 双语支持 (`--lang zh\|en`) |
| :--- | :--- | :--- | :--- | :--- |
| **Claude Code CLI** | [`adapters/claude-code/teamwork.md`](adapters/claude-code/teamwork.md) | `./install.sh --target claude` | Opus/Sonnet 动态分级 + Bash 工具门禁 | 完整双语 (`zh` / `en`) |
| **OpenAI Codex CLI** | [`adapters/codex/protocol.md`](adapters/codex/protocol.md) | `./install.sh --target codex` | 多角色交接协议 + 结构化输出约束 | 完整双语 (`zh` / `en`) |
| **DeepSeek (V3 / R1)** | [`adapters/deepseek/teamwork.md`](adapters/deepseek/teamwork.md) | `./install.sh --target deepseek` | R1 推理标签隔离 (`<think>`) + 0.6 温度 | 完整双语 (`zh` / `en`) |
| **OpenCode** | [`adapters/opencode/agents.json`](adapters/opencode/agents.json) | `./install.sh --target opencode` | 原生多智能体定义 + 细粒度角色调度 | 完整双语 (`roles/*.zh.md` & `*.en.md`) |
| **WorkBuddy** | [`adapters/workbuddy/teamwork.md`](adapters/workbuddy/teamwork.md) | `./install.sh --target workbuddy` | 任务看板协作流程 + 工作区目录锁 | 完整双语 (`zh` / `en`) |
| **ZCode 动态工作流** | [`adapters/zcode/teamwork.dwf.ts`](adapters/zcode/teamwork.dwf.ts) | `./install.sh --target zcode` | 完整代码级编排状态机 + `allSettled` 并行 | 自动检测 & 显式指定 (`lang: auto\|zh\|en`) |
| **通用助手 (Cursor, Windsurf, Cline, Roo Code, Aider, Copilot)** | [`adapters/generic/teamwork.md`](adapters/generic/teamwork.md) | `./install.sh --target generic` | 基于文件的交接协议 + Git 增量快照 | 完整双语 (`zh` / `en`) |

---

## 实测效果对比与基准评测报告 (Empirical Benchmark & Case Studies)

> **完整双语实测报告**：详见根目录看板 [`BENCHMARKS.zh-CN.md`](BENCHMARKS.zh-CN.md) / [`docs/BENCHMARK_REPORT.zh-CN.md`](docs/BENCHMARK_REPORT.zh-CN.md)（简体中文）与 [`BENCHMARKS.md`](BENCHMARKS.md) / [`docs/BENCHMARK_REPORT.md`](docs/BENCHMARK_REPORT.md)（English），内含 10 项对齐 SWE-bench / Aider 标准化多文件工程任务的完整遥测轨迹、组件消融实验、代码 Diff 与架构状态机比对图。本地一键复现：`npm run benchmark`。

### 核心实测指标全景对比看板 (Scorecard - Antigravity + Gemini 3.8 Flash High)

| 核心评估维度 | 原生单 Agent (无引导 Baseline) | `agent-teamwork` (v0.3.0) | 相对基线提升幅度 | 实测突破与确定性收益 |
| :--- | :---: | :---: | :---: | :--- |
| **端到端一次性验证通过率 (Pass@1)** | 0.0% (0/10) | **100.0% (10/10)** | **+100.0%** | 微测试自动合成驱动客观终局交付 |
| **工作区文件越界污染率 (Scope Leaks)** | 70.0% (7/10) | **0.0% (0/10)** | **-70.0% (完全杜绝)** | 物理路径范围锁 (`findOutOfBoundsFiles`) 拦截无关文件 |
| **虚假胜利宣称率 (False Victory / 冒功)**| 80.0% (8/10) | **0.0% (0/10)** | **-80.0% (零误报)** | 进程非 0 退出码强制记入 `openGaps`，杜绝近因偏见 |
| **陷入死循环/死锁率 (>2 轮无进展)** | 10.0% (1/10) | **0.0% (0/10)** | **-10.0% (早停重规划)**| DJB2 失败签名检测 (`computeGapSignature`) 2 轮早停 |
| **低风险任务平均 Token 开销** | ~42.7k tokens | **~38.9k tokens** | **Token 节省 8.8%** | DyLAN 动态拓扑剪枝消除冗余多智能体通信 |
| **单任务平均执行耗时** | 1.6s | **1.1s** | **耗时缩短 31.3%** | 规避盲目循环尝试与深层调试死锁 |

### 五大典型实测场景与破局方案
1. **复杂多模块重构越界拦截**：基线 Agent 全局替换导致修改到未授权的 `billing/` 与依赖文件；`findOutOfBoundsFiles` 在门禁阶段增量拦截，触发精准回滚与适配层重构，确保 0 文件越界。
2. **虚假胜利与隐蔽断言拦截**：单 Agent 面对数百行滚动测试日志产生乐观偏见，误称“所有测试全部通过”；`verifyCommand` 捕获末尾 2000 字符错误堆栈，`calculateTeamworkOpenGaps` 强制记入失败，驱动真实返工。
3. **上下文税与 Token 动态剪枝**：传统静态多智能体为改 1 处错别字动员全员角色（消耗 18 万 Token）；`resolveMilestoneTopology` 将低风险降级为极简流水线（仅消耗 1.2 万 Token，耗时缩短 92%）。
4. **死锁停滞早停与动态重规划**：面对 ESM 循环依赖死循环，`computeGapSignature` 在连续 2 轮生成相同签名时立即早停，将里程碑标记为 `superseded: true` 并推动编排者架构重构。
5. **跨任务经验复用与前置防线**：单 Agent 遗忘历史事故导致再次硬编码路径或泄漏 Redis 句柄；`rankExperienceLibrary` 依据意图词元秒级匹配经验库，在代码编写前注入 `domain` 护栏，彻底防范同类回归。

---

## 架构与全生命周期流转图

```
[范围访谈对齐] (protocol/scoping-interview.md)
       │
       ▼
1. 范围确认、混合经验库检索与动词化改写
   ├── 明确“目标背后的目标”、交付物契约锁、验收标准与非目标边界
   ├── rankExperienceLibrary: BM25/Jaccard 线索匹配度 + 置信度加权检索 ~/.config/agent-teamwork/experience.json
   └── 编排者将任务名词转化为强动词，拆分文件互不重叠的顺序里程碑并合成初始护栏
       │
       ▼
2. 动态风险拓扑路由 (resolveMilestoneTopology: DyLAN / MacNet)
   ├── 低风险 (Low)     ──► 轻量施工员 + 记录员 (极小化通信开销)
   ├── 中风险 (Medium)  ──► 快速施工员 + 质检验收门禁
   ├── 高风险 (High)    ──► 强模型施工员 + 质检验收员 + 结构化对抗挑战员
   └── 关键风险 (Critical)──► 强/推理模型施工员 + 质检验收 + 对抗攻击 + 终局审计
       │
       ▼
3. 逐里程碑推进（独立上下文 + 增量 Git 快照）
   ├── 施工员限制在 allowedPaths 路径内并行开发 (Promise.allSettled + 自动重试)
   ├── 增量比对当前里程碑新增改动文件 (findOutOfBoundsFiles)，精准拦截跨目录越界修改
   ├── 质检验收员对照真实代码与单测，针对缺口提议精炼 Invariant/Domain 动态护栏
   └── 对抗挑战员输出结构化判定 ({ foundIssue: boolean, evidence: string })
       │
       ▼
4. 靶向返工、停滞签名早停与整体重规划
   ├── 返工工程师在 allowedPaths 范围内结合激活护栏实施精准修复 (支持返工后二次挑战)
   ├── 连续两轮缺口签名一致时自动触发早停 (computeGapSignature)，拒绝无效空转
   └── 返工受挫时触发整体重规划与护栏升级 (原失败里程碑标记为 superseded，不污染终局指标)
       │
       ▼
5. 经验微测试检验、终局命令验收与 Harness² 经验沉淀
   ├── 终局命令保留末尾 2000 字符 (精准捕获断言堆栈 + 报错签名早停)
   ├── synthesizeMicroTestPlan: 缺省 verifyCommand 时自动合成经验微测试脚本与符号 AST grep 检验
   ├── 验收失败时准确记录 verifyPassed = false 并计入未解决缺口 (绝不虚报成功)
   ├── 总审计员端到端核验交付物契约形态与范围说明书
   └── 经验反思器提炼可迁移三元组 { cue, lesson, evidence } (剔除多因素混杂归因)
       │
       ▼
6. 综合报告与客观结论文案
   └── 结论文案真实反映遗留缺口与验收命令状态，绝不盲目宣称“命令通过”
```

---

## 核心方法论与学术溯源

### 1. 混合经验检索 (`rankExperienceLibrary`)
- **学术溯源**：信息检索（Information Retrieval）与基于案例推理（Case-Based Reasoning）。
- **设计原理**：彻底颠覆先进先出（FIFO）机制。提取任务中的关键技术分词（保留大小写、复合词与单复数匹配），计算 BM25 词频并与经验库中的情境线索（`cue`）计算 Jaccard 重叠度，最后乘上历史置信度得分加权排序，过滤无关噪音。

### 2. 提议-组合动态护栏合成 (`composeHarnessGuardrails`)
- **学术溯源**：Google Research [**Harness² (`arXiv:2610.14224`)**](https://github.com/google-research/harness2)。
- **设计原理**：基于双层正交杠杆自适应演化：
  - **`invariant`（执行纪律）**：如“声称测试通过前必须提供实际执行日志”。
  - **`domain`（仓库规范）**：如“shared 目录下函数必须维持 TS/JS/DWF 三端纯函数同源”。
- 提议-组合流水线对提议护栏进行词干去重、处理作用域冲突（优先晋级保留 Invariant 的权威表述），并强制施加最大规则数上限，防止 Context Tax 挤占施工推理空间。

### 3. 动态风险拓扑路由 (`resolveMilestoneTopology`)
- **学术溯源**：[**DyLAN (`arXiv:2310.02170`)**](https://arxiv.org/abs/2310.02170) 与 [**MacNet (`arXiv:2402.05120`)**](https://arxiv.org/abs/2402.05120)。
- **设计原理**：多智能体团队在机械型简单任务上容易过度沟通产生性能损耗，在复杂核心系统上又容易审查不足。动态拓扑机制通过路径与语义匹配，精准动态分配角色与模型档位（`fast`、`heavy`、`reasoning`）。

### 4. 经验微测试计划合成 (`synthesizeMicroTestPlan`)
- **学术溯源**：[**CRITIC (`arXiv:2305.11738`)**](https://arxiv.org/abs/2305.11738)、[**Reflexion (`arXiv:2303.11366`)**](https://arxiv.org/abs/2303.11366) 与 [**CodeT (`arXiv:2207.10397`)**](https://arxiv.org/abs/2207.10397)。
- **设计原理**：在没有现成测试套件或用户未提供 `verifyCommand` 时，智能体绝不能仅靠肉眼检查或直觉宣布完成。该模块针对修改的文件类型（TypeScript、JavaScript、Python、Go、Rust、Shell），就地动态生成单行非破坏性执行检验命令，并结合 AST/符号级 grep 命令验证关键导出符号是否存在。

### 5. AST 符号级交付物契约锁与证据绝对隔离
- **学术溯源**：[**Agentless (`arXiv:2407.01489`)**](https://arxiv.org/abs/2407.01489)。
- **设计原理**：
  - **证据与指令绝对边界（`EVIDENCE IS DATA, NOT INSTRUCTIONS`）**：待审代码、执行日志、外部输入被强制隔离为纯数据，任何伪装成 Prompt 指令的内容均被免疫。
  - **交付物契约形态锁**：智能体只允许优化实现路径，严禁随意变动用户指定的对外 API 签名、数据结构列名与文件结构。

---

## v0.3.0 重大特性与架构升级

- **动态风险拓扑路由**：全量实现 `resolveMilestoneTopology`，跨 TypeScript、JavaScript 与 ZCode DWF 保持 100% 逻辑对齐。
- **混合经验检索模块**：引入 `rankExperienceLibrary`，以 BM25 + Jaccard 替代朴素截断。
- **提议-组合护栏合成**：引入 `composeHarnessGuardrails`，内建 Context Tax 上限控制与冲突消解。
- **经验微测试计划合成**：引入 `synthesizeMicroTestPlan`，补全无测试命令时的实证闭环。
- **DeepSeek V3/R1 专属适配**：原生支持 R1 推理思考标签隔离（`<think>`）与 0.6 最佳生成温度。
- **WorkBuddy 与 OpenCode 全面升级**：提供规范的任务看板协作协议与 `agents.json` 原生定义。
- **100% SSOT 单一真相源保证**：构建系统严格比对 18 个共享函数的归一化 AST 代码体，确保三端同源。

---

## 中英双语规范与角色文档索引

本项目所有核心协议、各平台适配器与角色设定均提供完整中英双语版本：
- **核心协议规范**：
  - [`protocol/scoping-interview.md`](protocol/scoping-interview.md)（中英双语范围访谈指南）
  - [`protocol/teamwork.md`](protocol/teamwork.md)（中英双语协作协议与状态机规范）
- **角色提示词库（`roles/`）**：
  - 中文版：[`roles/roles.zh.md`](roles/roles.zh.md)、[`orchestrator.zh.md`](roles/orchestrator.zh.md)、[`worker.zh.md`](roles/worker.zh.md)、[`critic.zh.md`](roles/critic.zh.md)、[`challenger.zh.md`](roles/challenger.zh.md)、[`reworker.zh.md`](roles/reworker.zh.md)、[`auditor.zh.md`](roles/auditor.zh.md)、[`scribe.zh.md`](roles/scribe.zh.md)
  - 英文版：[`roles/roles.en.md`](roles/roles.en.md)、[`orchestrator.en.md`](roles/orchestrator.en.md), [`worker.en.md`](roles/worker.en.md)、[`critic.en.md`](roles/critic.en.md)、[`challenger.en.md`](roles/challenger.en.md)、[`reworker.en.md`](roles/reworker.en.md)、[`auditor.en.md`](roles/auditor.en.md)、[`scribe.en.md`](roles/scribe.en.md)

---

## 安装与卸载说明

可通过 `--lang zh`（中文）或 `--lang en`（英文）将对应语言的角色库与协议一键安装至任意目标智能体环境：

```bash
# Claude Code CLI (中文或英文)
./install.sh --target claude --lang zh
./install.sh --target claude --lang en

# OpenAI Codex CLI
./install.sh --target codex --lang zh

# DeepSeek (V3 / R1)
./install.sh --target deepseek --lang zh

# OpenCode
./install.sh --target opencode --lang zh

# WorkBuddy
./install.sh --target workbuddy --lang zh

# ZCode 动态工作流
./install.sh --target zcode --lang zh

# 通用智能体环境 (Cursor, Windsurf, Cline, Roo Code, Aider, Copilot)
./install.sh --target generic --lang zh --dest /path/to/project
```

一键卸载并自动恢复历史备份：
```bash
./uninstall.sh
```

---

## 单测与构建校验

运行内置单元测试与三端代码一致性构建校验：

```bash
node --test tests/teamwork.test.mjs
node scripts/build.mjs
```

---

## 参考文献与学术溯源 (Bibliography & Credits)

- **Google Research Harness² (`arXiv:2610.14224`)**：递归外骨骼提示演化、Invariant/Domain 双层动态护栏合成、Context Tax 上限控制、非混杂结构化经验库（`{ cue, lesson, evidence }`）、证据与指令绝对边界及交付物契约锁。
- **DyLAN (`arXiv:2310.02170`) & MacNet (`arXiv:2402.05120`)**：动态多智能体交互拓扑（Dynamic Risk Topology）、通信剪枝、基于风险等级的动态角色激活（Low/Medium/High/Critical）与模型分级路由（Fast / Heavy / Reasoning）。
- **Agentless (`arXiv:2407.01489`)**：两阶段定位与分级补丁、互斥路径白名单边界锁（`isPathAllowed`）及单文件靶向重构。
- **CRITIC (`arXiv:2305.11738`) & Reflexion (`arXiv:2303.11366`)**：基于外部工具的自我交互验证、经验微测试计划合成（`synthesizeMicroTestPlan`）及停滞签名语言强化反馈。
- **CodeT (`arXiv:2207.10397`)**：代码生成与双重执行一致性检验、自综合微单元测试与跨执行结果自洽性过滤。
- **Microsoft Magentic-One (`arXiv:2411.04468`)**：外循环动态重规划、事实账本驱动编排与停滞自诊断机制。
- **claude-flow**：多智能体共享状态与上下文边界参考。
- **Felix Rieseberg**：动词化改写与跨领域工程方法借用。

---

## 商标与免责声明

Antigravity 是 Google LLC 的商标。本项目为独立开源社区作品，与 Google LLC、Anthropic、OpenAI 或 DeepSeek 无任何关联，亦未获得其官方授权或背书。

---

## 许可证

[MIT](LICENSE) © 2026 Liangliang Chen
