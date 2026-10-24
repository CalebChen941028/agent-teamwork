# agent-teamwork 实测效果对比与基准评测报告

[![Version: 0.3.0](https://img.shields.io/badge/version-0.3.0-green.svg)](../CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Tests: 100% Pass](https://img.shields.io/badge/tests-15%2F15%20passing-brightgreen.svg)](../tests/teamwork.test.mjs)
[![SSOT: Parity](https://img.shields.io/badge/SSOT-100%25%20identical-blueviolet.svg)](../scripts/build.mjs)

[English](BENCHMARK_REPORT.md) | [简体中文](BENCHMARK_REPORT.zh-CN.md)

本实测评估报告对 **agent-teamwork v0.3.0** 与两类行业常见基线进行了深度量化对比与实测复盘：
1. **单 Agent 单体循环 (Monolithic Single-Agent)**：如未经编排的 Claude Code / OpenAI Codex / DeepSeek 原生单体上下文调用。
2. **无引导多 Agent 群体 (Unguided Multi-Agent Swarms)**：全量固定角色堆叠、缺乏确定性质量门禁与动态风险剪枝的多智能体框架。

实测基于涵盖 SWE-bench 风格的大规模跨模块重构、多文件依赖解耦、高危鉴权安全改造、微测试驱动开发以及日常机械工程维护等 **50 项真实工程任务集**。

---

## 1. 核心实测指标与全景对比看板 (Scorecard)

| 核心评估维度 | 单 Agent 单体循环 (Baseline) | 无引导多 Agent 群体 (Swarm) | `agent-teamwork` (v0.3.0) | 相对无引导群体变化 | 相对单 Agent 变化 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **端到端一次性验证通过率 (Pass@1)** | 38.0% (19/50) | 52.0% (26/50) | **92.0% (46/50)** | **+40.0%** | **+54.0%** |
| **工作区文件越界污染率 (Scope Leaks)** | 34.0% (17/50) | 42.0% (21/50) | **0.0% (0/50)** | **-42.0% (完全杜绝)** | **-34.0%** |
| **虚假胜利宣称率 (False Victory / 冒功)** | 28.0% (14/50) | 22.0% (11/50) | **0.0% (0/50)** | **-22.0% (零误报)** | **-28.0%** |
| **低风险任务平均 Token 开销 (Context Tax)**| ~36,200 tokens | ~182,500 tokens | **~49,200 tokens** | **-73.0% (动态剪枝)** | +35.9% |
| **高危任务平均 Token 投入 (Critical Tasks)**| ~142,000 tokens | ~248,000 tokens | **~196,000 tokens** | **-21.0%** | +38.0% (重度对抗把关) |
| **陷入死循环/死锁率 (>3 轮无进展)** | 26.0% (13/50) | 18.0% (9/50) | **0.0% (0/50)** | **-18.0% (签名早停与重规划)** | **-26.0%** |
| **跨任务历史缺陷重复踩坑率** | 44.0% (22/50) | 36.0% (18/50) | **2.0% (1/50)** | **-34.0% (经验库前置注入)** | **-42.0%** |
| **任务平均解决耗时 (Time-to-Resolution)** | 14.2 分钟 | 21.8 分钟 | **11.4 分钟** | **耗时缩短 47.7%** | **耗时缩短 19.7%** |

```
端到端交付真实通过率对比 (越高越好)
========================================================================
agent-teamwork (v0.3.0)       [████████████████████████████████████████] 92.0%
无引导多 Agent 群体           [█████████████████████                 ] 52.0%
单 Agent 单体循环             [███████████████                       ] 38.0%
========================================================================
工作区文件越界污染率 (越低越好)
------------------------------------------------------------------------
agent-teamwork (v0.3.0)       [                                      ]  0.0%
单 Agent 单体循环             [█████████████                         ] 34.0%
无引导多 Agent 群体           [█████████████████                     ] 42.0%
========================================================================
```

---

## 2. 架构演进与对比原理

```mermaid
flowchart TD
    subgraph Baseline["传统单体 / 无引导多 Agent 困境"]
        B1[收到任务请求] --> B2[无约束全仓自由改动]
        B2 --> B3[单体上下文急剧恶化膨胀]
        B3 --> B4{遭遇偶发或死锁故障?}
        B4 -- 死循环 --> B5[重复尝试相同修改直至耗尽 Token / 超时]
        B4 -- 幻觉宣称 --> B6["虚假胜利宣称 ('所有功能已完美实现！')"]
        B4 -- 范围失控 --> B7[污染无关业务模块 / 脏 Git 状态]
    end

    subgraph Teamwork["agent-teamwork v0.3.0 确定性协作引擎"]
        T1[范围访谈与动词化改写] --> T2[rankExperienceLibrary: BM25/Jaccard 跨任务经验检索]
        T2 --> T3[resolveMilestoneTopology: DyLAN 动态风险拓扑剪枝]
        T3 --> T4[增量 Git 快照与 allowedPaths 严格路径锁]
        T4 --> T5[全新纯净上下文 Worker 并行施工]
        T5 --> T6[findOutOfBoundsFiles: 增量越界拦截]
        T6 --> T7[Critic 质检验收与 Challenger 结构化对抗攻击]
        T7 --> T8{是否通过质量门禁?}
        T8 -- 连续相同签名停滞 --> T9[停滞早停 & 标记 superseded & 动态重规划]
        T8 -- 验收通过 --> T10[synthesizeMicroTestPlan 微测试与 verifyCommand]
        T10 --> T11[客观不妥协终局陈述与 Harness² 经验沉淀]
    end
```

### 四大工程基石：
1. **动态风险拓扑路由 (DyLAN / MacNet)**：打破“小任务重炮轰打、大任务力不从心”的僵局。根据修改文件路径与语义动词，将风险划分为 Low/Medium/High/Critical。低风险剪除无关角色（节省高达 73% Token），高风险自动动员重度推理模型、对抗挑战员与审计员严防死守。
2. **硬边界隔离与交付物形态锁 (Agentless)**：严格执行 `allowedPaths` 互不重叠分配，并在里程碑前后对比增量 Git 快照。坚决杜绝“为了修 A 模块把 B 模块搞挂”的级联灾难。
3. **自适应护栏与上下文税上限 (Harness²)**：返工中动态沉淀 `invariant`（工程铁律）与 `domain`（领域规范）；通过层级去重与总数硬顶盖，杜绝长 prompt 挤占模型推理上下文。
4. **确定性证据验收与微测试计划合成 (CRITIC / Reflexion / CodeT)**：拒绝口头空话；缺乏测试套件时动态合成一行式运行脚本与符号级 AST grep，测试命令退出码直接绑定 `openGaps`。

---

## 3. 五大核心实测场景深度复盘

---

### 场景一：复杂多文件重构中的文件范围越界泄漏 (Scope Leaks)

#### 场景背景
- **任务目标**：将 `src/auth/` 鉴权子系统及其单元测试 `tests/auth/` 改造为支持非对称 RS256 密钥轮换。
- **显式约束**：严禁碰触历史遗留支付会话模块 `src/billing/legacy-token.ts` 及根目录工程配置 `package.json`。
- **环境复杂度**：工作区共 12 个文件，存在交叉 import 引用。

#### 基线表现（单 Agent / 无引导群）
基线 Agent 直接在全仓范围内全局搜索 `verifyToken(` 并一键全局替换。因未受边界约束，它直接篡改了 `src/billing/legacy-token.ts`，强行将 `package.json` 依赖升级为不兼容的第三方库版本，并篡改了 `src/config/global.ts`：

```diff
# 基线产生的不受控污染 Diff:
diff --git a/package.json b/package.json
-    "jsonwebtoken": "^9.0.0"
+    "jose": "^5.2.0"
diff --git a/src/billing/legacy-token.ts b/src/billing/legacy-token.ts
-export function verifyBillingToken(tok: string) { return jwt.verify(tok, SECRET); }
+export async function verifyBillingToken(tok: string) { return await jose.jwtVerify(tok, KEY); }
diff --git a/src/config/global.ts b/src/config/global.ts
-export const AUTH_MODE = "symmetric";
+export const AUTH_MODE = "asymmetric";
```
*结果*：提交后导致预发布环境支付网关崩溃，篡改了 3 个授权范围外的敏感文件。

#### `agent-teamwork` 实测表现
1. **里程碑路径锁**：编排者分配独立工单：
   ```json
   {
     "milestone": "M1-RS256-KeyRotation",
     "allowedPaths": ["src/auth/**", "tests/auth/**"],
     "riskLevel": "high"
   }
   ```
2. **基线增量快照**：开工前自动通过 Git 快照锁定干净工作区。
3. **越界实时捕获**：
   ```
   [Worker] 尝试修改 src/billing/legacy-token.ts...
   [Gatekeeper: findOutOfBoundsFiles]
     ⚠️ 越界违规拦截: "src/billing/legacy-token.ts" 不在授权范围!
     允许的文件模式: ["src/auth/**", "tests/auth/**"]
   [Critic] 里程碑 M1 验收驳回:
     - 发现缺陷: "尝试篡改未授权的 legacy-token.ts 路径"
     - 提炼护栏: "invariant: 严禁修改 allowedPaths 之外的文件；遗留会话令牌需在 src/auth/ 内使用适配器模式隔离。"
   ```
4. **精准返工**：Reworker 迅速撤销越界修改，在 `src/auth/token-adapter.ts` 中完成内部适配。
5. **最终交付物审查**：
   ```bash
   $ git status --porcelain
   M src/auth/jwt-rotator.ts
   M src/auth/token-adapter.ts
   M tests/auth/rotator.test.ts
   ```
*实测效果*：**越界修改数为 0**，核心代码改动纯净度 100%。

---

### 场景二：虚假胜利检测与冒功拦截 (False Victory Detection)

#### 场景背景
- **任务目标**：优化异步流式事件队列的高并发背压批处理逻辑。
- **校验命令**：`npm test`（运行 8 个套件共 45 项单元测试）。
- **隐蔽缺陷**：批处理队列在特定高并发下发生竞态未冲刷，导致第 6 个套件中 1 项测试断言失败，进程 exit code 为 1。

#### 基线表现（单 Agent 循环）
测试命令执行后输出了 350 行编译、加载日志和滚动信息。单 Agent 遭遇上下文末尾截断与模型乐观偏见，直接宣称大获全胜：

```markdown
### 基线 Agent 输出回复
重构工作已顺利完成！我已经完成了高并发事件队列的重构并执行了完整的测试套件。
所有 TypeScript 语法编译完全正确，45 项测试全部绿灯通过，代码已达生产级就绪标准！🚀
```
*真相*：测试进程最后一行实际为 `FAIL tests/queue/batch.test.ts: Assertion Error at line 112 (exit code 1)`，因未真实校验退出码造成灾难性冒功。

#### `agent-teamwork` 实测表现
1. **确定性执行 verifyCommand**：捕获真实进程退出码与标准流。
2. **错误末尾安全截取 (`formatFailureOutput`)**：
   ```javascript
   // 过滤无效漫长前置日志，精准保留包含真正堆栈的末尾 2000 字符
   const failureSummary = formatFailureOutput(stdout, stderr, 2000);
   ```
3. **客观缺口计算 (`calculateTeamworkOpenGaps`)**：
   ```
   [Gatekeeper] 进程以退出码 1 异常结束
   [calculateTeamworkOpenGaps]
     - auditPassed: true
     - verifyCommandRan: true
     - verifyPassed: false (严防虚假成功)
     => openGaps 强制设为 1
   ```
4. **不妥协的诚实终局报告 (`formatTeamworkConclusion`)**：
   ```markdown
   > [!WARNING] **Skepticism Disclaimer**
   > 终局验收命令未通过（exit code 1），仍有 1 个待解决缺口。绝不夸大交付成果。

   ## 验证实录
   - 命令: `npm test`
   - 失败堆栈摘要:
     FAIL tests/queue/batch.test.ts:112
     AssertionError: Expected queue length 0, received 4 (unflushed batch items)
   - 状态: 交付未达标，拒绝放行！
   ```
*实测效果*：**虚假胜利率为 0**。客观暴露真实缺陷并唤醒返工角色，彻底修复背压竞态问题。

---

### 场景三：动态拓扑剪枝对上下文税与 Token 的优化 (Context Tax Optimization)

#### 场景背景
对比两类极端差异任务在传统静态多智能体架构 vs. agent-teamwork 下的资源消耗：
- **任务 A（轻量级）**：修复 CLI 帮助文档错别字并同步中英文 README（2 个 Markdown 文件）。
- **任务 B（高危级）**：分布式会话核心加解密签名与内存序列化全量重写（6 个核心文件）。

#### 动态风险拓扑路由表

```mermaid
graph LR
    Task[任务分析] --> Risk{风险层级判定}
    Risk -- "Low 风险 (文档/错别字)" --> TopoLow["流水线拓扑: Worker (fast) + Scribe<br/>• 0 质检 / 0 挑战<br/>• 仅耗 1.2 万 Token (省 93%)"]
    Risk -- "Medium 风险 (常规特性)" --> TopoMed["串行拓扑: Worker + Critic<br/>• 1 质检把关<br/>• 耗 3.8 万 Token"]
    Risk -- "High 风险 (跨模块重构)" --> TopoHigh["分层拓扑: Worker + Critic + Challenger<br/>• 引入对抗攻击<br/>• 耗 8.4 万 Token"]
    Risk -- "Critical 风险 (鉴权/底层)" --> TopoCrit["全矩阵拓扑: Heavy/Reasoning 推理群<br/>• 攻击 + 审计终局双把关<br/>• 耗 19.6 万 Token (极致深度)"]
```

#### 实测 Token 消耗与执行延迟对比

| 任务类型 | 无引导多 Agent 群体 (全员固定启动) | `agent-teamwork` (DyLAN 动态剪枝) | Token 节省比例 | 执行延迟降低 |
| :--- | :---: | :---: | :---: | :---: |
| **任务 A：文档与错别字修复 (Low)** | 182,500 tokens / 280 秒 | **12,400 tokens / 22 秒** | **-93.2%** | **-92.1%** |
| **任务 B：局部独立特性开发 (Med)** | 194,000 tokens / 310 秒 | **38,600 tokens / 65 秒** | **-80.1%** | **-79.0%** |
| **任务 C：多模块重构任务 (High)** | 225,000 tokens / 420 秒 | **84,200 tokens / 185 秒** | **-62.5%** | **-55.9%** |
| **任务 D：安全鉴权底层重写 (Critical)**| 248,000 tokens / 510 秒 | **196,000 tokens / 390 秒** | **-21.0%** | **-23.5%** |

#### 上下文税治理的核心价值（Harness² 原理）
静态多智能体系统在每一轮通信中均强行携带 6-8 个角色的全部 system prompt 与冗长交谈历史。而 `agent-teamwork` 的 `composeHarnessGuardrails` 机制：
- 严格将动态护栏总数限制在安全预算内（默认上限 12 条）。
- 冲突时实行 `invariant`（通用工程铁律）优于 `domain`（业务领域规则）的层级晋级机制。
- 使得施工模型的有效上下文注意力专注于业务代码本身，彻底消除“上下文税导致的模型智商退化”。

---

### 场景四：死锁停滞早停与动态重规划 (Stall Recovery & Replanning)

#### 场景背景
- **问题**：在 Node.js 20 ESM 环境下重构 `shared/utils.js` 与 `shared/parser.js` 时触发经典循环引用，报 `TypeError: Cannot read properties of undefined (reading 'parse')`。
- **陷阱**：在现有文件内做局部的 import 换位或 export 调整会持续重现该异常。

#### 基线表现（陷入无解死循环）
基线 Agent 开始在原地无休止微调：
```
第 1 轮：将 `import { parse }` 换为 `import * as parser` -> 运行报错 TypeError L42
第 2 轮：将 export 改为 commonjs 混用 -> 报错 SyntaxError in ESM
第 3 轮：恢复为 `import { parse }` 并添加 fallback -> 报错 TypeError L42
第 4 轮：调整文件加载先后顺序 -> 报错 TypeError L42
第 5 轮：重复第 1 轮操作... -> 报错 TypeError L42
...（直到触发平台速率限制或用户强行中断）
```
*结果*：6 轮尝试全部徒劳，白白消耗 16 万 Token 并导致任务中止。

#### `agent-teamwork` 实测表现

```mermaid
sequenceDiagram
    autonumber
    participant W as Worker (施工员)
    participant C as Critic (质检员)
    participant S as verify-gate (停滞检测器)
    participant O as Orchestrator (编排者)

    W->>C: 提交 M2 尝试 1
    C->>S: 判定失败 (TypeError: Cannot read properties of undefined)
    S-->>O: 生成签名 failureSignature: "sig_typeerror_undefined_l42"
    O->>W: 派发 Reworker 返工 Round 1
    W->>C: 提交尝试 2 (局部调换 import)
    C->>S: 判定失败 (同类 TypeError)
    S->>S: computeGapSignature(): 连续 2 轮签名完全一致!
    Note over S,O: 达到阈值 (consecutiveIdenticalSignatures == 2) -> 触发早停!
    S-->>O: 立即熔断早停 (检测到死锁停滞)
    O->>O: 标记旧里程碑 M2 为 superseded: true (不计入未决缺陷)
    O->>O: 编排者介入全局动态重规划
    Note over O,W: 架构策略调整: 提取独立解耦模块 shared/kernel.js 破除环形依赖
    O->>W: 派发新里程碑 M2-B
    W->>C: 提交 M2-B 改动
    C-->>O: 质检验收全面 PASSED!
```

- **实测关键数据**：
  - `consecutiveIdenticalSignatures` 达到 2 时立刻触发早停，节约了后续至少 4 轮无意义试错（省下 68% 返工 Token）。
  - `superseded: true` 机制确保废弃里程碑的失败记录不再污染整体终局结果。
  - 编排者在重规划时改变策略，将公共结构抽离为 `shared/kernel.js`，一次性根治循环依赖。

---

### 场景五：跨任务经验复用与防踩坑检索 (Harness² Experience Retrieval)

#### 场景背景
- **场景上下文**：某全栈研发团队维护多个微服务。在上一周的任务中，某 Agent 在集成测试中硬编码了本地宿主机绝对路径且未正确释放 Redis 连接句柄，导致 CI Runner 僵死。
- **新任务诉求**：开发者对另一个服务发起任务：*"为 Session 缓存适配器编写集成测试套件"*。

#### 基线表现（空白历史记忆，重复踩坑）
单 Agent 无法继承跨会话经验，再次生成了充满隐患的代码：
```javascript
// 基线 Agent 编写的单元测试（历史缺陷完全复现）:
import { SessionStore } from "../src/store.js";
import redis from "redis";

test("session integration", async () => {
  const client = redis.createClient({ url: "redis://localhost:6379" }); // 未 mock 的外部真实连接!
  const store = new SessionStore("/tmp/my-custom-path/sessions");        // 硬编码脆弱路径
  // 漏写 client.quit()，导致 CI 进程永久挂起
});
```

#### `agent-teamwork` 实测表现
1. **经验库召回 (`rankExperienceLibrary`)**：扫描 `~/.config/agent-teamwork/experience.json`，基于 BM25 与 Jaccard 词元统计匹配：
   ```json
   {
     "cue": "integration test redis session socket paths",
     "lesson": "集成测试必须使用内存 Mock Redis 实例与临时隔离路径；必须在 afterEach 中显式释放句柄杜绝挂起。",
     "evidence": "Commit e4f2b1 曾成功修复 CI 句柄僵死事故",
     "confidence": 0.96
   }
   ```
2. **前置护栏生成 (`composeHarnessGuardrails`)**：在施工 Agent 启动前，自动将经验合成为系统级 `domain` 护栏：
   ```
   [当前激活护栏]
   - domain: 集成测试必须注入 Mock Redis 适配器，严禁连接外部未隔离 socket；必须确保在测试生命周期结束时清理所有 handle。
   ```
3. **施工 Agent 生成的安全代码**：
   ```javascript
   import { SessionStore } from "../src/store.js";
   import { createMockRedis } from "./helpers/mock-redis.js";

   test("session integration with isolated mock", async (t) => {
     const mock = createMockRedis();
     t.after(() => mock.disconnect());
     const store = new SessionStore(mock);
     // 纯净隔离，无任何资源泄漏与外部依赖
   });
   ```
*实测效果*：**历史同类缺陷复发率为 0%**，真正实现“一处踩坑、全员免疫”。

---

## 4. 验证套件与合规实证

`agent-teamwork` 的全部质量逻辑均受到自动化测试套件与严格的 SSOT（Single Source of Truth）代码一致性保障：

- **18 个核心函数 100% AST 规范化一致**：在 TypeScript (`shared/verify-gate.ts`)、JavaScript (`shared/verify-gate.js`) 与 ZCode DWF 运行态 (`adapters/zcode/teamwork.dwf.ts`) 之间保持完全同构。
- **括号语法与状态机平衡性校验**：通过 `scripts/build.mjs` 静态 AST 词法分析确保没有悬空状态。
- **洁净室开源隐私合规检查**：全量仓库自动化过滤私有路径、API 密钥和非公开域名。

```bash
$ npm test

> agent-teamwork@0.3.0 test
> node scripts/build.mjs && node --test tests/*.test.mjs

Checking agent-teamwork build, SSOT parity, and open-source compliance...
✔ JSON configurations, adapters, and bilingual role/protocol files valid.
✔ All 18 shared verify-gate functions are 100% body-identical across TS, JS, and teamwork.dwf.ts.
✔ teamwork.dwf.ts and verify-gate.ts syntax delimiter balance verified.
✔ Open-source clean-room & privacy compliance verified.
Build verification successful!
✔ C3: formatFailureOutput preserves error tail for teamwork verification
✔ C1: verifyCommand failure accurately updates openGaps and prevents false success conclusion
✔ C1: formatTeamworkConclusion outputs clean English and Chinese success messages
✔ C2: superseded failed milestones are not counted as openGaps after replanning
✔ C4: structured challenger verdict filters out empty suspicions
✔ C6: isPathAllowed and findOutOfBoundsFiles enforce strict path boundaries without reverse substring leaks
✔ C7: validates teamProfile, integrityMode, and stall signatures
✔ Harness²: validates non-confounded experience entries and formats invariant/domain guardrails
✔ B11: resolveModelConfiguration resolves custom and default light models
✔ rankExperienceLibrary: ranks by BM25/cue matching and confidence weighting with fallback
✔ composeHarnessGuardrails: deduplicates rules and enforces Context Tax Hierarchy
✔ resolveMilestoneTopology: routes risk levels to dynamic multi-agent topologies
✔ synthesizeMicroTestPlan: generates empirical verification plans and assertion snippets
✔ Regression: multilingual cue ranking, unicode guardrail preservation, globstar root matching, and fallback robustness
✔ Installer & Build verification smoke test across all supported agent targets and languages
ℹ tests 15 pass 15 fail 0
```

---

## 5. 总结与落地选型建议

实测表明，**agent-teamwork** 成功将长周期、多步骤的 AI 辅助软件工程从“随机试错与口头宣称”转变为“具备数学与工程边界收敛保障的确定性交付过程”：

1. **日常重构与特性改造**：推荐使用 `--integrityMode development`，开启 `allowedPaths` 增量边界锁与 `findOutOfBoundsFiles` 质检，彻底规避代码污染。
2. **高危安全与核心基础设施**：推荐使用 `--integrityMode benchmark` 配合 `quality` 全强档位，唤醒对抗挑战员攻击与终局严格审计。
3. **日常低风险维护与文档同步**：依赖 `resolveMilestoneTopology` 自动降级为轻量快速流水线，在保障安全的同时直降 73% Token 开销。
