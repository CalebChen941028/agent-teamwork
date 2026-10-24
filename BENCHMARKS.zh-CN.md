# agent-teamwork 真实在线基准评测门户

[![Version: 0.3.0](https://img.shields.io/badge/version-0.3.0-green.svg)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 100% Pass](https://img.shields.io/badge/tests-40%2F40%20passing-brightgreen.svg)](tests/)
[![SSOT: Parity](https://img.shields.io/badge/SSOT-100%25%20identical-blueviolet.svg)](scripts/build.mjs)

[English](BENCHMARKS.md) | [简体中文](BENCHMARKS.zh-CN.md)

> 📖 **完整报告**：方法论、逐题遥测、失败形态分析与可落地发现见 [`docs/BENCHMARK_REPORT.zh-CN.md`](docs/BENCHMARK_REPORT.zh-CN.md) / [`docs/BENCHMARK_REPORT.md`](docs/BENCHMARK_REPORT.md)。原始运行证据：[`benchmarks/results/`](benchmarks/results/)。

本页全部数字来自 2026-10-24 的一次真实 A/B 活体大考——真实 HTTP 调用、真实子进程退出码、真实 `usage` Token 账单。

- **运行环境**：OpenCode Zen 网关 / ZCode Engine 评测驱动，macOS arm64 (Darwin 27.0.0)，Node.js v22.23.1
- **端点**：`https://opencode.ai/zen/go/v1/chat/completions` —— **模型**：`mimo-v2.6-flash`
- **任务集**：对齐 SWE-bench / Aider 的 10 项标准任务（`SWE-JS-001`…`010`），`os.tmpdir()` 下 Git 沙箱，每轨 6 轮，`max_tokens` 16384，temperature 0.2
- **复现**：`npm run benchmark:live`（配置方法见 [README § 单测与构建校验](README.zh-CN.md#单测与构建校验双层门禁架构)）

---

## 1. 实测成绩看板：Solo vs + agent-teamwork

同一模型、同一端点、同一预算。唯一变量是协作脚手架。

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

## 2. 逐题结果

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

---

## 3. 双层评测架构

| 层级 | 命令 | 证明什么 | 网络 |
| :--- | :--- | :--- | :---: |
| **1 —— 离线门禁** | `npm test` | 18 个共享纯函数 TS/JS/DWF 三端 AST 同构（SSOT）、开源合规扫描、40 项单测（含 18 项注入传输的 live-eval 驱动器测试） | 无 |
| **2 —— 在线 A/B 大考** | `npm run benchmark:live` | 10 项标准任务上的真实 Pass@1、真实 Token 账单、真实延迟、真实边界行为 | 真实 API |

两层共享同一任务地面真值（`benchmarks/tasks.mjs`）与同一裁决通道：校验子进程的 `process.exitCode`。

## 4. 一键复现

```bash
export OPENCODE_API_KEY="oc_sk_..."        # 或 models.local.json，见 README
npm run benchmark:live -- --check          # 鉴权预检 + 微型探针
npm run benchmark:live -- --out run.json   # 全量 10 题 A/B 大考
npm run benchmark:live -- --task SWE-JS-001
```
