# agent-teamwork 真实在线评测报告 — mimo-v2.6-flash A/B 活体大考

[![Version: 0.3.0](https://img.shields.io/badge/version-0.3.0-green.svg)](../CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Tests: 100% Pass](https://img.shields.io/badge/tests-40%2F40%20passing-brightgreen.svg)](../tests/)
[![SSOT: Parity](https://img.shields.io/badge/SSOT-100%25%20identical-blueviolet.svg)](../scripts/build.mjs)

[English](BENCHMARK_REPORT.md) | [简体中文](BENCHMARK_REPORT.zh-CN.md) | [门户看板: BENCHMARKS.zh-CN.md](../BENCHMARKS.zh-CN.md)

本报告全部数字来自 2026-10-24 的一次真实在线运行。评测驱动器通过 HTTP 现场调用模型，把返回的代码写入 Git 沙箱真实执行，以校验子进程的真实退出码裁决每一轨的胜负。没有任何数字来自推演、旧模拟数据或人工填写。

- **运行环境**：OpenCode Zen 网关 / ZCode Engine 评测驱动，macOS arm64 (Darwin 27.0.0)，Node.js v22.23.1
- **端点**：`https://opencode.ai/zen/go/v1/chat/completions`（OpenAI 兼容，须携带 `x-opencode-session` 请求头）
- **模型**：`mimo-v2.6-flash`（推理模型，`reasoning_content` 先于 `content` 输出）
- **请求预算**：temperature 0.2，`max_tokens` 16384，每轨 6 轮上限，HTTP 超时 180 秒（三个补充轨为 420 秒，见 §2.3）
- **原始证据**：[`benchmarks/results/live-ab-final.json`](../benchmarks/results/live-ab-final.json)（合并后权威数据）、[`live-ab-full.json`](../benchmarks/results/live-ab-full.json)（主跑）、同目录下的逐轨补充文件与完整控制台日志

---

## 1. 总成绩看板

A 轨（Solo 对照）把缺陷描述与测试目录直接交给裸模型，走朴素循环：全量原始测试输出回灌、无路径锁、无早停。B 轨（模型 + agent-teamwork）给同一模型套上协作引擎：范围访谈契约、`resolveMilestoneTopology` 风险拓扑路由指令、`findOutOfBoundsFiles` 物理路径锁、`formatFailureOutput` 失败尾部反馈、`computeGapSignature` 停滞早停、`calculateTeamworkOpenGaps` 严格退出码核算。两轨的模型、端点、采样参数与轮次预算完全一致，脚手架是唯一变量。

| 指标 | Solo（A 轨） | + agent-teamwork（B 轨） | 差值 |
| :--- | :---: | :---: | :---: |
| **Pass@1（校验退出码 0）** | **70.0%（7/10）** | **40.0%（4/10）** | −30 个百分点 |
| **API 调用次数** | 33 | 25 | −8 次 |
| **总 Token（prompt + completion）** | 105,195（59,867 + 45,328） | 97,461（36,799 + 60,662） | 单题均值 −7.4% |
| **单题平均 Token** | 10,520 | 9,746 | −7.4% |
| **单题平均耗时** | 98.4 秒 | 157.4 秒 | +59.9% |
| **单次调用平均 API 延迟** | 29.8 秒 | 48.4 秒 | +62.7% |
| **越界文件写入** | 0 | 0 | — |
| **被路径锁拦截的写入** | 不适用 | 0 | — |
| **虚假胜利宣称** | 1 | **0** | −1 |
| **停滞任务（≥2 个相同失败签名）** | 5 | 7 | +2 |
| **强制重规划 / 早停中止** | 不适用（无早停） | 7 次重规划，6 次中止 | — |

头名结论并不好看，但它是真的：在这台模型上，完整脚手架把端到端 Pass@1 从 70% 拉低到 40%。与此同时，护栏维度的表现全部兑现——两轨零越界、引擎之下零虚假胜利（Solo 有一次）、双方都失败的三道题上 Token 消耗节省 41.7%。§4 追查 Pass@1 损失来自哪里，以及它暴露了早停签名的什么问题。

---

## 2. 方法论

### 2.1 驱动机制

10 项标准任务（`benchmarks/tasks.mjs`，对齐 SWE-bench / Aider 方法论，`SWE-JS-001`…`010`）各自在 `os.tmpdir()` 下新建 `git init` 沙箱执行，沙箱预置确定性的未完成起始桩。模型按严格文件标签协议作答，驱动器解析 `<file path="…">` 块写入沙箱，随后运行 `run-tests.mjs`——一个生成的子进程，导入沙箱模块并执行该任务的 `groundTruthTests`。`process.exitCode` 是唯一裁决通道，文字宣称从不影响评分。

B 轨逐轮附加：越界提案在落盘前被拦截并计数（`findOutOfBoundsFiles`）；失败时模型只收到保留的校验输出末尾 2000 字符（`formatFailureOutput`）；连续两个相同的 DJB2 失败签名触发一次强制重规划，第三个触发中止（`computeGapSignature`）；终局核算要求退出码为 0 且零越界写入落地（`calculateTeamworkOpenGaps`）。

### 2.2 公平性控制

两轨使用相同的模型 id、端点、凭证、temperature、`max_tokens` 与 6 轮硬上限。A 轨刻意回灌全量原始测试输出（朴素基线），B 轨只回灌尾部——这一差异正是被测处置量本身，不是混杂因素。

### 2.3 基础设施故障与补充重跑政策

三个轨次（SWE-JS-005 teamwork、SWE-JS-006 solo、SWE-JS-009 teamwork）死在 180 秒 HTTP 超时上，一轮都没跑完——两次重试均被中止。这些是基础设施事件，不是模型表现：这台模型的深度推理调用合法地可能超过 180 秒（SWE-JS-009 的决胜调用耗时 273.8 秒）。三个轨次以 `--timeout-ms 420000` 重跑，由 [`benchmarks/merge-live-reports.mjs`](../benchmarks/merge-live-reports.mjs) 拼接进权威数据集；该脚本拒绝替换任何不是以 `track-error:` 中止的轨次。拼接日志保存在 `live-ab-final.json` 的 `meta.supplements` 中。已完成轨次全部在 180 秒预算内跑完，未做任何改动。

### 2.4 通道选型说明

本次大考原计划用智谱开放平台上的 GLM-5.3。直连 API 探测发现其推理阶段在该平台无上界，且随 `max_tokens` 同步膨胀（4,096 时推理花掉 4,095、content 恒为空；16,384 时同样；关闭思考被错误码 1210 拒绝）。该通道在采集任何任务数据之前即被放弃，改用 OpenCode Zen 网关上的 mimo-v2.6-flash。本报告不含任何 GLM-5.3 数字。

---

## 3. 逐题遥测

全部取自 `live-ab-final.json`。

| 任务 | Solo 裁决 | 轮数 / Token / 耗时 | Teamwork 裁决 | 轮数 / Token / 耗时 | Teamwork 中止原因 |
| :--- | :---: | :--- | :---: | :--- | :--- |
| SWE-JS-001 原型污染防护 | 通过 | 1 / 5.8k / 82.1s | 通过 | 1 / 3.8k / 72.2s | — |
| SWE-JS-002 异步队列背压 | 通过 | 4 / 5.4k / 52.6s | 通过 | 3 / 8.0k / 93.5s | — |
| SWE-JS-003 路由异步错误传播 | 失败 | 6 / 10.2k / 45.7s | 失败 | 3 / 6.6k / 247.8s | stagnation-early-stop |
| SWE-JS-004 循环 $ref 解析 | 通过 | 1 / 2.5k / 33.5s | 失败 | 3 / 4.6k / 25.0s | stagnation-early-stop |
| SWE-JS-005 SemVer 预发布过滤 | 失败 | 6 / 31.7k / 190.5s | 失败 | 3 / 20.4k / 267.8s | stagnation-early-stop |
| SWE-JS-006 跨平台路径分隔符 | 通过 | 2 / 9.6k / 138.9s | 失败 | 3 / 12.8k / 326.0s | stagnation-early-stop |
| SWE-JS-007 LRU 并发逐出 | 通过 | 1 / 8.3k / 143.7s | 失败 | 3 / 6.6k / 62.0s | stagnation-early-stop |
| SWE-JS-008 AbortSignal 双向拆除 | 通过 | 1 / 2.3k / 39.0s | 通过 | 1 / 2.5k / 23.8s | — |
| SWE-JS-009 qs 嵌套解码 + DoS 上限 | 通过 | 5 / 15.8k / 211.6s | 通过 | 2 / 26.8k / 414.8s | — |
| SWE-JS-010 配置深冻结不可变 | 失败 | 6 / 13.7k / 46.8s | 失败 | 3 / 5.3k / 41.2s | stagnation-early-stop |

值得点名的现象：

1. **两轨共同通过 001、002、008、009，共同失败 003、005、010。** 争议集恰好三题——004、006、007——Solo 通过而 Teamwork 早停中止。整个 Pass@1 差距全由这三题贡献。
2. **SWE-JS-003 Solo 终局退出码 13**（未决的顶层 await）：模型第六轮重写用了顶层 `await`，等待的 Promise 永不落地。真实且少见的失败形态，之所以能记录下来，是因为驱动器上报真实进程退出码。
3. **SWE-JS-006 Solo 贡献全场唯一一次虚假胜利**：第 1 轮宣称完成，校验退出码却是 1；宣称被记录，循环继续，第 2 轮真正通过。B 轨核算层零此类记录。

---

## 4. 输掉的差距由什么构成

### 4.1 推理预算挤占

`mimo-v2.6-flash` 先输出 `reasoning_content` 再输出 `content`，两者共用 16,384 的 completion 预算。整场运行的回复长度呈干净的双峰分布：携带完整文件、最终通过测试的载荷轮返回 3,000–12,000 字符正文；纯分析轮只返回 200–900 字符、不含任何文件块——推理耗尽预算，可见正文只剩一句"正在分析测试"式的短桩。

B 轨的系统提示远大于 A 轨（范围契约、拓扑指令、执行纪律、文件协议）。三道争议题上，A 轨提示下的模型第 1、2 轮就交出完整实现；同一模型在 B 轨提示下连续三轮只给分析短文，始终没走到载荷。本场运行的相关性是：脚手架上下文越大 → 推理越长 → 正文越薄 → 没有写入落地。

### 4.2 早停签名把"思考"误判为"卡死"

`computeGapSignature` 对保留的失败尾部做哈希。没有文件写入时，校验输出在轮间几乎不变，签名于是重复——引擎把重复读作"同一修法重试，注定失败"。在这台模型上，六次中止全部读错了：模型在跨轮推演，不是在重试失败的修法。引擎在第二个相同签名后强制重规划，第三个后中止，停在 6 轮预算的第 3 轮——恰好是 Solo 在 SWE-JS-006 上第 2 轮通过、在 004 和 007 上手握余轮的时间窗。

停滞检测器按它设计针对的失败形态校准：模型写了一个修法、看到失败、再写同一个修法。对一台载荷前各轮在校验器眼里长得一样的推理模型，签名必须区分"本轮没有写入"与"写入了且以同样方式失败"。

### 4.3 脚手架真正兑现的地方

- **共同失败题上的止损。** 双方都失败的三题（003、005、010），Solo 烧掉 55,500 Token，Teamwork 32,353——省 41.7%，因为第 3 轮中止掐断了失血。SWE-JS-010 最典型：13.7k → 5.3k，−61%。
- **prompt 侧的 Token 经济。** 系统提示大得多，B 轨总 prompt 却只有 36,799，Solo 是 59,867。尾部反馈（`formatFailureOutput`）阻止了全量测试输出在对话里累积，Solo 的全量回灌循环逐轮膨胀上下文。
- **核算之下零虚假胜利。** Solo 那次虚假胜利（SWE-JS-006 第 1 轮）正是缺口算术要抓的错误类型：宣称完成与校验失败并存时，它被记为指标，绝不被记为裁决。
- **SWE-JS-009 的招牌胜局。** Solo 磨了 5 轮、15.8k Token；B 轨 2 轮收敛——第二次调用花 273.8 秒、24.4k completion Token 深度推理，随后一次写入即交出正确完整的解码器。模型在契约下真正走到载荷时，对抗质疑与微测试指令与首写正确率正相关。

### 4.4 延迟

B 轨单题平均 157.4 秒，Solo 98.4 秒（+59.9%）；单次调用平均 API 延迟 48.4 秒对 29.8 秒。两个因素：更长的提示拉长推理；B 轨制胜的深度推理调用（009：273.8 秒；005 补充轨：258.8 秒）也计入其中。180 秒默认 HTTP 超时对这台模型的上尾太紧——§6 给出的修法已被补充运行验证。

---

## 5. 适用边界（结果在哪些条件下成立）

- 一台模型、一个端点、一天、十道题、temperature 0.2。争议差距只有三题；换一台模型——尤其每轮都交载荷的模型——压测的会是另外的机制。
- 两轨本场都守在 `allowedPaths` 之内，路径锁没有东西可拦。这是这台模型在这批任务上的纪律性事实，不是对锁的证伪；锁的行为在离线单测套件（40/40）里有确定性覆盖——那里会主动注入越界写入。
- 本次 A/B 隔离的是脚手架，不是角色分工。B 轨在单个工人模型外运行引擎的完整提示与闸门，并未展开 orchestrator/critic/reworker 的角色扇出。
- Solo 用朴素循环拿到 70% Pass@1，这是真实的门槛。脚手架要在这一模型族上超过它，或者在护栏轴（虚假胜利、止损、边界执行）上给自己立住理由。

---

## 6. 可落地的发现

1. **按写入活动拆分停滞签名。**"本轮没有文件落地"与"同一文件落地、同样失败"是两种状态。前者值得等待（或催促输出），后者才值得重规划。仅此一改，三道争议题大概率能收回——每题模型离载荷都只差一两轮。
2. **引擎的轮次预算不应小于基线的有效预算。** 早停为省钱而生，本场也确实省了（共同失败题 −41.7%）——但在第 3/6 轮中止、而基线在第 4–5 轮收敛，等于用一次通过换一笔节省。以观测到的载荷节奏为索引的中止阈值，优于固定常数。
3. **给推理模型上调默认 HTTP 超时。** 180 秒默认值杀掉三个轨次；420 秒补充预算让三个全部跑完。CLI 已提供 `--timeout-ms`；深度推理通道以 420,000 为默认更稳妥。
4. **在推理预算压力下精简脚手架提示。** 契约、指令与协议花的是 prompt Token，更重要的是花推理 Token。面向推理模型的压缩变体，缓解的正是 §4.1 记录的挤占。

---

## 7. 复现

```bash
npm run benchmark:live -- --check                 # 鉴权预检 + 微型探针
npm run benchmark:live -- --out my-report.json    # 全量 10 题 A/B 大考
npm run benchmark:live -- --task SWE-JS-001       # 单题快速验证
npm run benchmark:live -- --mode teamwork --task SWE-JS-009 --timeout-ms 420000
node benchmarks/merge-live-reports.mjs primary.json supplement.json -o merged.json
```

Level-1 离线门禁：`npm test` 先跑 `scripts/build.mjs`（18 个共享纯函数在 `shared/verify-gate.ts`、`shared/verify-gate.js` 与 `adapters/zcode/teamwork.dwf.ts` 三端 AST 代码体同构；开源合规扫描），再跑 40 项单元测试，其中 18 项专门用注入传输与脚本客户端检验 live-eval 驱动器本身——构造上零网络。Level-2 即上述在线大考；两层共享同一套 10 题地面真值与同一裁决通道（`process.exitCode`）。

本报告的原始证据：[`benchmarks/results/live-ab-final.json`](../benchmarks/results/live-ab-final.json)、[`live-ab-full.json`](../benchmarks/results/live-ab-full.json)、[`live-ab-full.console.log`](../benchmarks/results/live-ab-full.console.log) 与三份 `supplement-*.json`。
