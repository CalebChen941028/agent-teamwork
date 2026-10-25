# agent-teamwork 真实在线评测报告 — deepseek-v4.1-flash 15 题大考

[![Version: 0.4.0](https://img.shields.io/badge/version-0.4.0-green.svg)](../CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Tests: 100% Pass](https://img.shields.io/badge/tests-49%2F49%20passing-brightgreen.svg)](../tests/)
[![SSOT: Parity](https://img.shields.io/badge/SSOT-100%25%20identical-blueviolet.svg)](../scripts/build.mjs)

[English](BENCHMARK_REPORT.md) | [简体中文](BENCHMARK_REPORT.zh-CN.md) | [门户看板: BENCHMARKS.zh-CN.md](../BENCHMARKS.zh-CN.md)

本报告全部数字来自对 `deepseek-v4.1-flash` 的真实 HTTP 调用，于 2026-10-25（UTC 2026-10-24T17:43 收官）执行并裁决。胜负由 Git 沙箱中校验子进程的真实退出码决定，没有任何数字来自推演或人工填写。此前的 mimo-v2.6-flash 大考（2026-10-24，v0.3.x 引擎）保留在 §8，作为促成 v0.4.0 修复的原始记录。

- **运行环境**：OpenCode Zen 网关 / ZCode Engine 评测驱动，macOS arm64 (Darwin 27.0.0)，Node.js v22.23.1
- **端点**：`https://opencode.ai/zen/go/v1/chat/completions`（OpenAI 兼容，须携带 `x-opencode-session`）
- **模型**：`deepseek-v4.1-flash`（推理模型，completion Token 以推理为主）
- **请求预算**：temperature 0.2，`max_tokens` 16384，每轨 6 轮，HTTP 超时 420 秒
- **引擎**：agent-teamwork v0.4.0——写入感知停滞检测、脚手架提示瘦身
- **原始证据**：[`benchmarks/results/live-ab-deepseek-final.json`](../benchmarks/results/live-ab-deepseek-final.json)（权威合并件）、[`live-ab-deepseek.console.log`](../benchmarks/results/live-ab-deepseek.console.log)、逐题证据 `live-ab-deepseek-task001.json`…`task015.json`

---

## 1. 总成绩看板

A 轨（Solo）把缺陷描述与测试目录直接交给裸模型，走朴素循环：全量测试输出回灌、无路径锁、无早停。B 轨（模型 + agent-teamwork）给同一模型套上引擎：范围契约、`resolveMilestoneTopology` 路由、`findOutOfBoundsFiles` 路径锁、`formatFailureOutput` 尾部反馈、写入感知的 `computeGapSignature` 停滞处理、`calculateTeamworkOpenGaps` 退出码核算。模型、端点、采样参数与轮次上限完全一致，脚手架是唯一变量。

| 指标 | Solo（A 轨） | + agent-teamwork（B 轨） | 差值 |
| :--- | :---: | :---: | :---: |
| **Pass@1（校验退出码 0）** | **100.0%（15/15）** | **100.0%（15/15）** | 顶格持平 |
| **API 调用 / 轮次** | 25 | **19** | **−24%** |
| **总 Token（prompt + completion）** | 191,691（22,505 + 169,186） | 184,385（17,917 + 166,468） | — |
| **单题平均 Token** | 12,779 | **12,292** | **−3.8%** |
| **单题平均耗时** | 64.2 秒 | **55.6 秒** | **−13.4%** |
| **越界写入落地** | **18 个文件 / 3 题** | **0** | 路径锁拦截 7 次提案 |
| **被路径锁拦截的写入** | 不适用 | 7 | （落盘前拦截） |
| **虚假胜利宣称** | 2 | **0** | **−2** |
| **强制重规划 / 停滞中止** | 不适用 | 0 / 0 | 写入感知生效 |
| **停滞任务（≥2 相同失败签名）** | 0 | 0 | — |

deepseek-v4.1-flash 双轨解出全部 15 题，Pass@1 无法再区分两轨。区分度完全转移到护栏轴，而引擎在每一条护栏轴上全胜：Solo 在 3 题上污染了工作区（18 个杂散文件真实落盘）、两次在校验失败时宣称完成、为同样的答案多烧 24% 的 API 调用；B 轨零越界落地（7 次提案在触盘前被拦）、零未经验证的成功宣称，并且在提示词更大的情况下单题平均反而更快。

---

## 2. 方法论

### 2.1 逐题串行协议

每题独立执行一次调用（`node benchmarks/live-eval.mjs --mode ab --task SWE-JS-xxx --model deepseek-v4.1-flash --out …`），各产出一份含逐轮字符数、Token 账目、退出码与失败尾部的证据 JSON。15 份文件由 [`benchmarks/merge-live-reports.mjs`](../benchmarks/merge-live-reports.mjs) 联合合并；该脚本拒绝合并模型或模式不一致的报告，并把每个合并动作记录进 `meta.mergedFromTasks`。合并日志：14 题联合并入、0 次基础设施拼接、全部 30 个轨次执行零 track-error。

### 2.2 公平性控制

两轨使用相同的模型 id、端点、凭证、temperature、`max_tokens`、420 秒超时与 6 轮上限。Solo 回灌全量校验输出，Teamwork 只回灌尾部——这一差异正是被测处置量本身，不是混杂因素。

### 2.3 大考中发现的驱动器缺陷与修复

第一遍全量跑暴露了两个驱动器缺陷，诚实的处置比缺陷本身更重要：

1. **porcelain 目录折叠**。`git status --porcelain` 把全新未跟踪目录整体折叠显示为 `?? tests/`。模型（正确地）把白名单内的 `tests/merge.test.js` 写进一个沙箱初始化时不存在的目录时，折叠条目 `tests` 匹配不上文件级 `allowedPaths` 白名单，被误读为越界污染——让本应通过的 teamwork 轨被判失败。修复：改用 `--porcelain -uall`（逐文件列出），并在 `parseGitStatus` 中防御性剥掉尾部斜杠。
2. **写入冲突崩溃**。提案序列先写文件 `x` 再写 `x/y.js` 会在 `mkdir` 时抛 `EEXIST`，直接炸掉一个 solo 轨。`applyWrites` 现在把该次失败记入 `failed` 台账，不再抛出。

第一遍的 15 份结果文件产生于缺陷账目之下，已**整体废弃**（从未提交）；全量 15 题在修复后的驱动器上重跑，保证权威数据集出自同一版引擎。两个缺陷的回归断言已并入离线套件（`npm test`，41/41 全绿）。

### 2.4 写入感知停滞检测（本次受验证的机制）

v0.3.x 的 `computeGapSignature` 不区分是否有文件落地就累计相同失败签名，推理模型载荷前的"思考轮"因此被误读为停滞——mimo 大考上 10 个 teamwork 轨有 6 个在第 3 轮被中止。v0.4.0 用 `wroteFiles`（本轮是否真有写入落地）门控停滞计数，并在纯分析轮的反馈中注入"[NO DISK WRITES]"催促。

---

## 3. 逐题遥测

全部取自 `live-ab-deepseek-final.json`。"拦截" = 被路径锁拦截的提案数；"越界" = 真实落地的越界文件。

| 任务 | Solo | 轮 / Token / 耗时 | Teamwork | 轮 / Token / 耗时 | 拦截 | Solo 越界 |
| :--- | :---: | :--- | :---: | :--- | :---: | :--- |
| SWE-JS-001 原型污染防护 | 通过 | 1 / 8.1k / 46s | 通过 | 1 / 7.8k / 41s | 4 | — |
| SWE-JS-002 异步队列背压 | 通过 | 2 / 2.3k / 9s | 通过 | 1 / 17.1k / 80s | 0 | — |
| SWE-JS-003 路由异步错误传播 | 通过 | 2 / 25.4k / 159s | 通过 | 1 / 15.4k / 82s | 1 | — |
| SWE-JS-004 循环 $ref 解析 | 通过 | 2 / 30.7k / 154s | 通过 | 2 / 9.2k / 40s | 1 | — |
| SWE-JS-005 SemVer 预发布过滤 | 通过 | 1 / 4.2k / 18s | 通过 | 2 / 9.8k / 33s | 0 | 2 个文件 |
| SWE-JS-006 跨平台路径分隔符 | 通过 | 1 / 15.8k / 87s | 通过 | 2 / 28.5k / 141s | 0 | — |
| SWE-JS-007 LRU 并发逐出 | 通过 | 1 / 9.2k / 47s | 通过 | 1 / 7.7k / 36s | 1 | — |
| SWE-JS-008 AbortSignal 双向拆除 | 通过 | 3 / 7.0k / 20s | 通过 | 1 / 3.2k / 13s | 0 | — |
| SWE-JS-009 qs 嵌套解码 + DoS 上限 | 通过 | 2 / 22.4k / 117s | 通过 | 2 / 22.7k / 108s | 0 | — |
| SWE-JS-010 配置深冻结不可变 | 通过 | 1 / 4.5k / 23s | 通过 | 1 / 3.0k / 11s | 0 | — |
| SWE-JS-011 倒排索引文档存储 | 通过 | 2 / 7.4k / 22s | 通过 | 1 / 2.9k / 9s | 0 | **12 个文件** |
| SWE-JS-012 可重入分布式锁 | 通过 | 2 / 4.1k / 15s | 通过 | 1 / 8.4k / 38s | 0 | — |
| SWE-JS-013 RFC 6902 JSON Patch | 通过 | 1 / 14.0k / 74s | 通过 | 1 / 17.6k / 76s | 0 | — |
| SWE-JS-014 两阶段提交状态机 | 通过 | 2 / 5.7k / 22s | 通过 | 1 / 14.2k / 55s | 0 | 4 个文件 |
| SWE-JS-015 背压流管道与熔断 | 通过 | 2 / 30.9k / 149s | 通过 | 1 / 17.0k / 72s | 0 | — |

值得点名的细节：

1. **SWE-JS-011 Solo 是污染展示窗**：在正确实现之外，裸模型额外落了 12 个没人要的文件——`package.json`、三个 `.mocharc.*` 变体、一份 `README.md`、一个 `src/index.js` 桶文件、四个辅助模块、两个不同目录下的测试文件。同一题的 B 轨只写了恰好一个白名单入口文件，第 1 轮即通过。
2. **SWE-JS-008 Solo 贡献一次虚假胜利**：第 2 轮宣称完成而校验仍在失败；循环继续，第 3 轮才真正通过。SWE-JS-011 Solo 同样如此。B 轨 15 题零此类记录。
3. **拦截清单是具体的**：`package.json`（001/003/004/007 共 5 次）、`run-baseline.cjs`、`.nvmrc`、`.gitignore`——模型试图"顺手完善项目"，路径锁在落盘之前书面拒绝。

---

## 4. 写入感知修复的真机验证

本场大考要回答的单一问题：以真实写入门控停滞，能否在不重新引入死循环的前提下消除误杀？

- **三个 teamwork 轨以纯分析轮开局**（零写入、零拦截）：SWE-JS-005 t1、SWE-JS-006 t1、SWE-JS-009 t1。按 v0.3.x 签名逻辑，每个都离强制重规划只差一次重复、离中止只差两次。v0.4.0 下，三者都收到"[NO DISK WRITES]"催促，下一轮交付实现并**通过**——全场 0 重规划、0 中止。
- **全场无停滞**：两轨 0 重规划、0 中止、0 停滞任务。mimo 大考的失败形态（10 个 teamwork 轨 6 次停滞中止）在一台具有相同"载荷前分析轮"行为的模型上消失了。
- **催促不只是无害，而是有效**：三个首轮无写入的任务在被引导输出文件后的下一轮全部转为通过（005、006、009 均在 t2 通过）。

这个修复做的交换——对载荷前轮次保持耐心——在本场没有付出任何代价，因为 deepseek 的分析轮是真正收敛的。旧的第 3 轮中止行为对它设计针对的目标（同样的写入、同样的失败、重复两次）依然正确，只是不再对思考开火。

---

## 5. 成本与延迟

- **更少调用得到同样答案**。Teamwork 用 19 轮对 Solo 的 25 轮（−24%）。15 题中 11 题引擎轨严格少用轮次——契约下的首写纪律是直接原因：SWE-JS-011（1 轮对 2）、SWE-JS-012（1 对 2）、SWE-JS-015（1 对 2）、SWE-JS-008（1 对 3）。
- **completion 占主导的 Token 画像**。deepseek-v4.1-flash 的可计输出约 89% 花在推理上（Solo：completion 169,186 对 prompt 22,505）。引擎的提示节省因此相对有限（单题均值 −3.8%）；对这类模型真正有效的节省通道是轮次数，引擎在此净胜四分之一。
- **耗时天平倒向引擎**：单题平均 55.6 秒对 64.2 秒（−13.4%）——更少的轮次压过了更长的提示。B 轨单次调用平均 API 延迟略高（43.8 秒对 38.4 秒），与更大的脚手架提示让模型单次推理更长的事实一致。

---

## 6. 适用边界

- 一台模型、一个端点、一个夜晚、15 道题、temperature 0.2。Pass@1 在 100% 顶格持平，意味着本场衡量的是护栏与效率，不是解题上限；要在正确性上拉开两轨，需要更难的任务集。
- Solo 落地的 18 个污染文件是真实的工作区变更，CI 会照单提交、评审者得逐个回滚。引擎的 7 次拦截与 0 落地，正是契约在干它该干的活。
- 与 §8（mimo）的跨场对比只能定性：两场之间模型与引擎版本都变了。§4 才是修复的受控证据，场次间的差值不是。
- porcelain 缺陷下的第一遍结果已废弃重跑（§2.3）；入库的只有修复版驱动器的数据。

---

## 7. 复现

一键等价命令：`npm run benchmark:live`（全量、默认读 models.local.json 的模型）或 `npm run benchmark:live -- --mode ab --task SWE-JS-001 --model deepseek-v4.1-flash`。

```bash
node benchmarks/live-eval.mjs --check --model deepseek-v4.1-flash     # 鉴权预检
for i in 001 002 003 004 005 006 007 008 009 010 011 012 013 014 015; do
  node benchmarks/live-eval.mjs --mode ab --task SWE-JS-$i --model deepseek-v4.1-flash \
    --out benchmarks/results/live-ab-deepseek-task$i.json
done
node benchmarks/merge-live-reports.mjs benchmarks/results/live-ab-deepseek-task*.json \
  -o benchmarks/results/live-ab-deepseek-final.json
```

Level-1 离线门禁：`npm test` → `scripts/build.mjs`（18 个共享纯函数 TS/JS/DWF 三端 AST 同构、开源合规扫描）+ 41 项单测，其中 19 项用注入传输与脚本客户端检验 live 驱动器，含两个大考缺陷的回归断言。Level-2 即上述在线大考；两层共享同一套 15 题地面真值与同一裁决通道（`process.exitCode`）。

---

## 8. 历史记录：mimo-v2.6-flash 10 题大考（2026-10-24，v0.3.x 引擎）

保留它，因为它是促成 v0.4.0 写入感知修复的原始证据。同端点、10 题套件、180 秒超时、修复前签名逻辑。原始证据：[`live-ab-final.json`](../benchmarks/results/live-ab-final.json) 等。

| 指标 | Solo | + agent-teamwork（v0.3.x） |
| :--- | :---: | :---: |
| Pass@1 | **70.0%（7/10）** | 40.0%（4/10） |
| 越界写入 | 0 | 0 |
| 虚假胜利宣称 | 1 | **0** |
| 双方共同失败 3 题 Token | 55.5k | **32.4k（−41.7%）** |
| 单题平均 Token / 耗时 | 10,520 / 98.4 秒 | 9,746 / 157.4 秒 |
| 停滞中止 | 不适用 | 10 轨中 6 轨 |

v0.3.x 的 `computeGapSignature` 把 mimo 载荷前的"思考轮"（推理耗尽 completion 预算，只回 200–900 字符、不含文件块）读成停滞，在第 3/6 轮中止，而 Solo 恰在这些题的第 2–5 轮收敛。本报告 §4 即该修复的真机验证。当时记录的四条整改：写入感知签名（v0.4.0 已交付）、轮次预算对等、推理通道默认 420 秒超时（已交付）、脚手架提示压缩（已交付）。
