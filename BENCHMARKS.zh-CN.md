# agent-teamwork 真实在线基准评测门户

[![Version: 0.5.0](https://img.shields.io/badge/version-0.5.0-green.svg)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 100% Pass](https://img.shields.io/badge/tests-49%2F49%20passing-brightgreen.svg)](tests/)
[![SSOT: Parity](https://img.shields.io/badge/SSOT-100%25%20identical-blueviolet.svg)](scripts/build.mjs)

[English](BENCHMARKS.md) | [简体中文](BENCHMARKS.zh-CN.md)

> 🏆 **最新大考：SWE-bench Verified 官方 Docker 盲测实测（`pytest` 19 题 + `requests` 8 题 = 累计 27 题）**：
> 在 `deepseek-v4.1-flash` 真实模型上，通过官方容器沙箱裁决：
> - **Tier 2（`pytest-dev/pytest` 全量 19 题）**：**73.7%（14/19）对比 63.2%（12/19）**（**+10.5 pts 领先**，净胜 2 题，0 对 1 致命补丁格式断裂，平均补丁缩小 33.9%）。
> - **Tier 1（`psf/requests` 全量 8 题）**：**62.5%（5/8）对比 50.0%（4/8）**（**+12.5 pts 领先**，0 对 1 致命补丁损坏，Token 开销降低 42.8%）。
> - **累计 27 题总计**：**70.4%（19/27）对比 59.3%（16/27）**（**+11.1 pts 领先**，0 对 2 致命补丁损坏）。详见完整指南与报告：[`docs/SWEBENCH_GUIDE.zh-CN.md`](docs/SWEBENCH_GUIDE.zh-CN.md)。
>
> 🚀 **15 题大考（`deepseek-v4.1-flash`）**：
> Pass@1 100% 顶格持平，越界落地 18 对 0，调用数 −24%，写入感知 0 误杀中止。详见 [`docs/BENCHMARK_REPORT.zh-CN.md`](docs/BENCHMARK_REPORT.zh-CN.md)。
>
> 📖 **历史 10 题基准（`mimo-v2.6-flash`）**：
> 保留在下文 §3，作为促成 v0.4.0 写入感知修复的真实归因记录。

---

## 1. SWE-bench Verified 官方实测看板（Docker 真实裁决 · 累计 27 题）

2026-10-25 基于 `deepseek-v4.1-flash` 对 SWE-bench Verified 中 `pytest-dev/pytest`（全量 19 题）与 `psf/requests`（全量 8 题）执行盲测评估。测试代码在执行期间全程严格隐藏，评测结果通过官方 Docker 容器（`swebench.harness.run_evaluation`）执行隐藏用例严格判定：

### 1.1 阶段二：`pytest-dev/pytest`（19 题）

| 指标 | Solo 裸模型基线（Track A） | + agent-teamwork（Track B） | 差值 |
| :--- | :---: | :---: | :---: |
| **补丁产出率** | 16/19（84.2%） | 16/19（84.2%） | — |
| **官方 Resolved（Pass@1 真实裁决）** | **12/19（63.2%）** | **14/19（73.7%）** | **+10.5 pts（净胜 2 题）** |
| **Unresolved（有补丁但盲测未过）** | 3（`10356`, `7324`, `7490`） | 2（`5787`, `7324`） | −1 |
| **空补丁（回合耗尽未写入）** | 3（`5840`, `6197`, `7236`） | 3（`10356`, `5840`, `6197`） | — |
| **致命补丁损坏（`git apply` 失败）** | **1（`pytest-dev__pytest-7205`）** | **0** | **−1 error** |
| **API 调用次数 / 总 Token** | 58 次 / 170.8 万 | 69 次 / 194.2 万 | +19.0% / +13.7% |
| **平均补丁大小** | 2,182 字符 | **1,442 字符** | **−33.9% 手术式精准度** |

### 1.2 阶段一：`psf/requests`（8 题）

| 指标 | Solo 裸模型基线（Track A） | + agent-teamwork（Track B） | 差值 |
| :--- | :---: | :---: | :---: |
| **补丁产出率** | 8/8（100%） | 8/8（100%） | — |
| **官方 Resolved（Pass@1 真实裁决）** | **4/8（50.0%）** | **5/8（62.5%）** | **+12.5 pts（多解出 1 题）** |
| **Unresolved（盲测未通过）** | 3（2317, 2931, 5414） | 3（2317, 2931, 5414） | —（模型推理能力边界） |
| **致命补丁损坏（`git apply` 失败）** | **1（`psf__requests-6028`）** | **0** | **−1 error** |
| **API 调用次数 / 回合消耗** | 21 次 | **17 次** | **−19.0%** |
| **总 Token 消耗** | 41.8 万 | **23.9 万** | **−42.8%（Solo 膨胀 +75%）** |

```
官方 SWE-bench Resolved（两场合计 27 题：pytest-19 + requests-8，Docker 盲测裁决）
+ agent-teamwork                [██████████████████████░░░░░░░░░░]  70.4% (19/27)
Solo (deepseek-v4.1-flash)      [███████████████████░░░░░░░░░░░░░]  59.3% (16/27)

核心启示：在 requests-6028 与 pytest-7205 上，Solo 分别生成了 30,348 字符与 3,421 字符的大改重写，均在 git apply 阶段因冲突或第 100 行格式断裂直接报废（error）；
Teamwork 均仅用 2 回合生成 535 字符与 606 字符的手术式补丁精准修复并全绿通过。
```

官方权威记分卡与证据：[`benchmarks/swebench/results/`](benchmarks/swebench/results/)。完整复现流程：[`docs/SWEBENCH_GUIDE.zh-CN.md`](docs/SWEBENCH_GUIDE.zh-CN.md)。

---

## 2. 15 题大考看板（`deepseek-v4.1-flash`）

| 指标 | Solo（A 轨） | + agent-teamwork（B 轨） | 差值 |
| :--- | :---: | :---: | :---: |
| **Pass@1（校验退出码 0）** | 100.0%（15/15） | 100.0%（15/15） | 顶格持平 |
| **API 调用次数** | 25 | **19** | **−24%** |
| **越界写入落地** | **18 个文件 / 3 题** | **0** | 路径锁拦截 7 次提案 |
| **虚假胜利宣称** | 2 | **0** | **−2** |
| **停滞中止 / 重规划** | 不适用 | **0 / 0** | 写入感知生效 |

完整报告：[`docs/BENCHMARK_REPORT.zh-CN.md`](docs/BENCHMARK_REPORT.zh-CN.md)。原始数据：[`benchmarks/results/live-ab-deepseek-final.json`](benchmarks/results/live-ab-deepseek-final.json)。

---

## 3. 历史 10 题基准看板（`mimo-v2.6-flash`）

本节全部数字来自 2026-10-24 针对 `mimo-v2.6-flash` 在 `https://opencode.ai/zen/go/v1/chat/completions` 端点上的真实 A/B 活体大考（复现命令：`npm run benchmark:live`）。同一模型、同一端点、同一预算。唯一变量是协作脚手架。

| 指标 | Solo（A 轨） | + agent-teamwork（B 轨） | 差值 |
| :--- | :---: | :---: | :---: |
| **Pass@1（校验退出码 0）** | **70.0%（7/10）** | **40.0%（4/10）** | −30 个百分点 |
| **API 调用次数** | 33 | 25 | −8 |
| **单题平均 Token** | 10,520 | 9,746 | **−7.4%** |
| **单题平均耗时** | 98.4 秒 | 157.4 秒 | +59.9% |
| **越界写入** | 0 | 0 | — |
| **虚假胜利宣称** | 1 | **0** | **−1** |
| **双方共同失败 3 题的 Token** | 55,500 | 32,353 | **−41.7%** |
| **早停中止（止损）** | 不适用 | 6 次 | — |

```
Pass@1（真实退出码裁决）
Solo (mimo-v2.6-flash)          [██████████████████████████░░░░░░░░]  70.0% (7/10)
+ agent-teamwork                [████████████████░░░░░░░░░░░░░░░░░]  40.0% (4/10)

护栏维度（越低越好）
虚假胜利宣称      Solo 1 次 → Teamwork 0 次
越界文件写入      Solo 0 → Teamwork 0
共同失败题 Token  Solo 55.5k → Teamwork 32.4k（−41.7%）
```

诚实的头名结论：在这台推理模型上，脚手架拉低了 Pass@1，同时赢下全部护栏维度。原因具体且已诊断——`computeGapSignature` 把模型载荷前的"思考轮"（推理耗尽 completion 预算、未输出文件、校验输出不变）判为停滞，在第 3/6 轮中止；而 Solo 恰恰用第 4–5 轮在这些题上收敛。完整分析与修复清单见 [docs/BENCHMARK_REPORT.zh-CN.md §4–§6](docs/BENCHMARK_REPORT.zh-CN.md#4-输掉的差距由什么构成)。

---

### 3.1 逐题结果

| 任务 | 类别 | Solo | Teamwork | Solo 轮/Token | Team 轮/Token |
| :--- | :--- | :---: | :---: | :--- | :--- |
| SWE-JS-001 原型污染防护 | 安全 | ✔ | ✔ | 1 / 5.8k | 1 / 3.8k |
| SWE-JS-002 异步队列背压 | 并发 | ✔ | ✔ | 4 / 5.4k | 3 / 8.0k |
| SWE-JS-003 路由异步错误传播 | 路由 | ✖（退出码 13） | ✖ | 6 / 10.2k | 3 / 6.6k |
| SWE-JS-004 循环 $ref 解析 | 模式校验 | ✔ | ✖ | 1 / 2.5k | 3 / 4.6k |
| SWE-JS-005 SemVer 预发布过滤 | 版本解析 | ✖ | ✖ | 6 / 31.7k | 3 / 20.4k |
| SWE-JS-006 跨平台路径分隔符 | 文件系统 | ✔ | ✖ | 2 / 9.6k | 3 / 12.8k |
| SWE-JS-007 LRU 并发逐出 | 数据结构 | ✔ | ✖ | 1 / 8.3k | 3 / 6.6k |
| SWE-JS-008 AbortSignal 双向拆除 | 事件 | ✔ | ✔ | 1 / 2.3k | 1 / 2.5k |
| SWE-JS-009 qs 嵌套解码 + DoS 上限 | 解析器安全 | ✔ | ✔ | 5 / 15.8k | 2 / 26.8k |
| SWE-JS-010 配置深冻结不可变 | 配置 | ✖ | ✖ | 6 / 13.7k | 3 / 5.3k |

备注：SWE-JS-003 Solo 终局退出码 13（模型重写里出现未决的顶层 await）。SWE-JS-006 Solo 贡献全场唯一一次虚假胜利（第 1 轮宣称完成实则失败，第 2 轮通过）。三个死于 180 秒 HTTP 超时的轨次以 420 秒重跑并经 `benchmarks/merge-live-reports.mjs` 合并，拼接日志在 `live-ab-final.json → meta.supplements`。

### 3.2 标准任务全景清单（`SWE-JS-001` 至 `SWE-JS-015`）

标准基准套件涵盖 15 道标准软件工程任务：
- `SWE-JS-001` 原型污染防护（安全防御）
- `SWE-JS-002` 异步队列背压（并发控制）
- `SWE-JS-003` 路由异步错误传播（路由健壮性）
- `SWE-JS-004` 循环 $ref 解析（模式校验）
- `SWE-JS-005` SemVer 预发布过滤（版本解析）
- `SWE-JS-006` 跨平台路径分隔符（文件系统）
- `SWE-JS-007` LRU 并发逐出（数据结构）
- `SWE-JS-008` AbortSignal 双向拆除（事件机制）
- `SWE-JS-009` qs 嵌套解码 + DoS 上限（解析器安全）
- `SWE-JS-010` 配置深冻结不可变（配置隔离）
- `SWE-JS-011` 倒排索引文档存储（复合状态机与索引完整性）
- `SWE-JS-012` 可重入分布式锁与租约回收（分布式并发与死锁防御）
- `SWE-JS-013` RFC 6902 JSON Patch 事务求值（RFC 协议一致性与回滚防御）
- `SWE-JS-014` 两阶段提交状态机（分布式 2PC 事务恢复）
- `SWE-JS-015` 背压异步流管道与熔断拆除（响应式流与背压控制）

---

## 4. 三层评测门禁架构

| 层级 | 命令 | 证明什么 | 网络依赖 |
| :--- | :--- | :--- | :---: |
| **1 —— 离线门禁** | `npm test` | 18 个共享纯函数 TS/JS/DWF 三端 AST 同构（SSOT）、开源合规扫描、49 项单测 | 无 |
| **2 —— 在线合成大考** | `npm run benchmark:live` | 15 项真实软件工程基准任务上的 Pass@1、真实 Token 账单与越界拦截 | 真实 API |
| **3 —— 官方 SWE-bench 实测** | `python3 benchmarks/swebench/eval.py` | 官方 SWE-bench Verified 工业级沙箱容器隐藏盲测裁决 | Docker + 真实 API |

---

## 5. 一键复现指南

```bash
# 1. 离线门禁与 SSOT 同构检验
npm test

# 2. 仓内在线合成任务大考 (15 题)
export OPENCODE_API_KEY="oc_sk_..."        # 或 models.local.json，见 README
npm run benchmark:live -- --check          # 鉴权预检 + 微型探针
npm run benchmark:live -- --out run.json   # 全量 15 题 A/B 大考

# 3. 官方 SWE-bench Verified 容器评测 (以 psf/requests 8 题为例)
node benchmarks/swebench/runner.mjs --instances benchmarks/swebench/tasks-requests-8.json --mode ab
python3 benchmarks/swebench/eval.py --predictions benchmarks/swebench/predictions-teamwork.jsonl
```
