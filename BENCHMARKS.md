# agent-teamwork Live Benchmark & Evaluation Portal

[![Version: 0.3.0](https://img.shields.io/badge/version-0.3.0-green.svg)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 100% Pass](https://img.shields.io/badge/tests-40%2F40%20passing-brightgreen.svg)](tests/)
[![SSOT: Parity](https://img.shields.io/badge/SSOT-100%25%20identical-blueviolet.svg)](scripts/build.mjs)

[English](BENCHMARKS.md) | [简体中文](BENCHMARKS.zh-CN.md)

> 📖 **Full report**: methodology, per-task telemetry, failure-mode analysis, and actionable findings live in [`docs/BENCHMARK_REPORT.md`](docs/BENCHMARK_REPORT.md) / [`docs/BENCHMARK_REPORT.zh-CN.md`](docs/BENCHMARK_REPORT.zh-CN.md). Raw run artifacts: [`benchmarks/results/`](benchmarks/results/).

All figures on this page come from one live A/B exam run on 2026-10-24 — real HTTP calls, real subprocess exit codes, real `usage` token billing.

- **Runtime**: OpenCode Zen gateway / ZCode Engine harness, macOS arm64 (Darwin 27.0.0), Node.js v22.23.1
- **Endpoint**: `https://opencode.ai/zen/go/v1/chat/completions` — **Model**: `mimo-v2.6-flash`
- **Suite**: 10 canonical SWE-bench / Aider aligned tasks (`SWE-JS-001`…`010`), git sandboxes under `os.tmpdir()`, 6 turns per track, `max_tokens` 16384, temperature 0.2
- **Reproduction**: `npm run benchmark:live` (config in [README § Testing](README.md#testing--build-verification-two-level-architecture))

---

## 1. Live Scorecard: Solo vs + agent-teamwork

Same model, same endpoint, same budgets. The only variable is the collaboration scaffolding.

| Metric | Solo (Track A) | + agent-teamwork (Track B) | Delta |
| :--- | :---: | :---: | :---: |
| **Pass@1 (verifier exit code 0)** | **70.0% (7/10)** | **40.0% (4/10)** | −30 pts |
| **API calls** | 33 | 25 | −8 |
| **Avg tokens per task** | 10,520 | 9,746 | **−7.4%** |
| **Avg wall time per task** | 98.4 s | 157.4 s | +59.9% |
| **Out-of-bounds writes** | 0 | 0 | — |
| **False victory claims** | 1 | **0** | **−1** |
| **Tokens on the 3 shared-failure tasks** | 55,500 | 32,353 | **−41.7%** |
| **Early-stop aborts (cost containment)** | n/a | 6 | — |

```
Pass@1 (live, exit-code verified)
Solo (mimo-v2.6-flash)          [██████████████████████████░░░░░░░░]  70.0% (7/10)
+ agent-teamwork                [████████████████░░░░░░░░░░░░░░░░░]  40.0% (4/10)

Guardrail axes (lower is better)
False victory claims     Solo 1  →  Teamwork 0
Out-of-bounds writes     Solo 0  →  Teamwork 0
Tokens on shared failures Solo 55.5k → Teamwork 32.4k  (−41.7%)
```

The honest headline: on this reasoning model, the harness **lowered** Pass@1 while winning every guardrail axis. The cause is specific and diagnosed — `computeGapSignature` reads the model's pre-payload "thinking" turns (reasoning consumed the completion budget, no file emitted, verifier output unchanged) as stagnation, and aborts at turn 3 of 6. Solo used turns 4–5 to converge on exactly those tasks. Full analysis and the fix list: [docs/BENCHMARK_REPORT.md §4–§6](docs/BENCHMARK_REPORT.md#4-what-the-losing-margin-is-made-of).

---

## 2. Per-Task Results

| Task | Category | Solo | Teamwork | Solo turns/tok | Team turns/tok |
| :--- | :--- | :---: | :---: | :--- | :--- |
| SWE-JS-001 Prototype pollution guard | Security | ✔ | ✔ | 1 / 5.8k | 1 / 3.8k |
| SWE-JS-002 Async queue backpressure | Concurrency | ✔ | ✔ | 4 / 5.4k | 3 / 8.0k |
| SWE-JS-003 Router async error propagation | Routing | ✖ (exit 13) | ✖ | 6 / 10.2k | 3 / 6.6k |
| SWE-JS-004 Circular $ref resolution | Schema | ✔ | ✖ | 1 / 2.5k | 3 / 4.6k |
| SWE-JS-005 SemVer pre-release filtering | SemVer | ✖ | ✖ | 6 / 31.7k | 3 / 20.4k |
| SWE-JS-006 Cross-platform path separators | Filesystem | ✔ | ✖ | 2 / 9.6k | 3 / 12.8k |
| SWE-JS-007 LRU concurrent eviction | Data structures | ✔ | ✖ | 1 / 8.3k | 3 / 6.6k |
| SWE-JS-008 AbortSignal two-way teardown | Events | ✔ | ✔ | 1 / 2.3k | 1 / 2.5k |
| SWE-JS-009 qs nested decoder + DoS cap | Parser security | ✔ | ✔ | 5 / 15.8k | 2 / 26.8k |
| SWE-JS-010 Config deep-freeze immutability | Config | ✖ | ✖ | 6 / 13.7k | 3 / 5.3k |

Notes: SWE-JS-003 Solo ended on exit code 13 (unsettled top-level await in the model's rewrite). SWE-JS-006 Solo produced the run's single false victory (claimed done on turn 1 while failing; passed on turn 2). Three tracks that died on the 180 s HTTP timeout were re-run at 420 s and merged via `benchmarks/merge-live-reports.mjs`; the splice log is in `live-ab-final.json → meta.supplements`.

---

## 3. Two-Level Evaluation Architecture

| Level | Command | What it proves | Network |
| :--- | :--- | :--- | :---: |
| **1 — Offline gates** | `npm test` | 18 shared pure functions AST-identical across TS/JS/DWF (SSOT), open-source compliance scan, 40 unit tests incl. 18 live-eval harness tests with injected transports | none |
| **2 — Live A/B exam** | `npm run benchmark:live` | Real Pass@1, real token billing, real latency, real boundary behavior on the 10 canonical tasks | real API |

Both levels share the same task ground truth (`benchmarks/tasks.mjs`) and the same verdict channel: the verifier subprocess's `process.exitCode`.

## 4. Run It Yourself

```bash
export OPENCODE_API_KEY="oc_sk_..."        # or models.local.json, see README
npm run benchmark:live -- --check          # auth precheck + tiny probe
npm run benchmark:live -- --out run.json   # full 10-task A/B exam
npm run benchmark:live -- --task SWE-JS-001
```
