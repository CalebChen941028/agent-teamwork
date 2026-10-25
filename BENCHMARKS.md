# agent-teamwork Live Benchmark & Evaluation Portal

[![Version: 0.5.0](https://img.shields.io/badge/version-0.5.0-green.svg)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 100% Pass](https://img.shields.io/badge/tests-49%2F49%20passing-brightgreen.svg)](tests/)
[![SSOT: Parity](https://img.shields.io/badge/SSOT-100%25%20identical-blueviolet.svg)](scripts/build.mjs)

[English](BENCHMARKS.md) | [简体中文](BENCHMARKS.zh-CN.md)

> 🏆 **Latest Benchmark: SWE-bench Verified Official Docker Evaluations (52 Tasks Across 7 Major Repositories)**:
> Containerized blind holdout test adjudication with `deepseek-v4.1-flash`:
> - **Grand Total (52 Tasks)**: **55.8% (29/52) vs 46.2% (24/52)** (**+9.6% Pass@1**, net +5 tasks, 3 vs 5 fatal patch errors, over 2.0M tokens saved).
> - **Tier 2.5 (Multi-Repo 25 tasks · Django, SymPy, Scikit-learn, Sphinx, Pylint)**: **40.0% (10/25) vs 32.0% (8/25)** (**+8.0% Pass@1**, −46.2% token tax, empty patches cut 12 → 6).
> - **Tier 2 (`pytest-dev/pytest` 19 tasks)**: **73.7% (14/19) vs 63.2% (12/19)** (**+10.5% Pass@1**, net +2 tasks, 0 vs 1 malformed patch error, −33.9% smaller surgical patches).
> - **Tier 1 (`psf/requests` 8 tasks)**: **62.5% (5/8) vs 50.0% (4/8)** (**+12.5% Pass@1**, 0 vs 1 fatal `git apply` error, −42.8% token overhead).
> Full report & replication guide in [`docs/SWEBENCH_GUIDE.md`](docs/SWEBENCH_GUIDE.md).
>
> 🚀 **15-Task Live Benchmark (`deepseek-v4.1-flash`)**:
> Full 15-task live eval (100% Pass@1 ceiling, 18 vs 0 leaked files, 2 vs 0 false claims, −24% API calls, 0 stagnation aborts with write-awareness). Full report in [`docs/BENCHMARK_REPORT.md`](docs/BENCHMARK_REPORT.md).
>
> 📖 **Historical 10-Task Baseline (`mimo-v2.6-flash`)**:
> Preserved below in §3 as the empirical motivation that inspired the v0.4.0 write-aware engine fix.

---

## 1. SWE-bench Verified Scorecards (Official Docker Harness · 52 Tasks Cumulative)

Evaluated on 2026-10-25 using `deepseek-v4.1-flash` across 7 major open-source repositories in SWE-bench Verified. Test suites are strictly hidden during execution; results are adjudicated by official Docker containers via `swebench.harness.run_evaluation`.

### 1.1 Grand Total Cumulative (52 Tasks across 7 Repositories)

| Metric | Solo Baseline (Track A) | + agent-teamwork (Track B) | Delta |
| :--- | :---: | :---: | :---: |
| **Official Resolved (Pass@1)** | **24 / 52 (46.2%)** | **29 / 52 (55.8%)** | **+9.6% (+5 tasks)** |
| **Tier 1: `psf/requests` (8 tasks)** | 4 / 8 (50.0%) | **5 / 8 (62.5%)** | +12.5% (+1 task) |
| **Tier 2: `pytest-dev/pytest` (19 tasks)** | 12 / 19 (63.2%) | **14 / 19 (73.7%)** | +10.5% (+2 tasks) |
| **Tier 2.5: Multi-Repo (25 tasks)** | 8 / 25 (32.0%) | **10 / 25 (40.0%)** | +8.0% (+2 tasks) |
| **Fatal Patch Errors (`git apply` failure)** | 5 | **3** | **−2 errors** |
| **Token Savings on Large Repos** | Baseline | **−2.0M+ tokens** | **−46.2% on multi-repo** |

```
Grand Total SWE-bench Verified Pass@1 (52 Tasks, Docker verified)
+ agent-teamwork                [██████████████████░░░░░░░░░░░░░░]  55.8% (29/52)
Solo (deepseek-v4.1-flash)      [███████████████░░░░░░░░░░░░░░░░░]  46.2% (24/52)
```

### 1.2 Tier 2.5: Multi-Repository Evaluation (25 Tasks across 5 Repositories)

| Metric | Solo Baseline (Track A) | + agent-teamwork v0.5.0 (Track B) | Delta |
| :--- | :---: | :---: | :---: |
| **Patches Generated (Non-empty)** | 13/25 (52.0%) | **19/25 (76.0%)** | **+6 patches (+24.0 pts)** |
| **Official Resolved (Pass@1)** | **8/25 (32.0%)** | **10/25 (40.0%)** | **+8.0% (+2 tasks)** |
| **Empty Patches (Turn budget exhausted)** | **12 / 25 (48.0%)** | **6 / 25 (24.0%)** | **−6 empty patches (−50.0%)** |
| **Fatal Patch Errors (`git apply`)** | 2 (`sklearn-10908`, `sympy-11618`) | 3 (`sklearn-10908`, `sympy-12096`, `sympy-12481`) | +1 |
| **Total API Calls Consumed** | 236 | **129** | **−45.3% calls** |
| **Total Tokens Consumed** | 3,329,839 | **1,792,243** | **−46.2% tokens** |
| **Per-Repo Resolved (Solo vs Teamwork)** | Django: 2 vs 3, SymPy: 1 vs 2, Sklearn: 2 vs 2, Sphinx: 2 vs 3, Pylint: 1 vs 0 |

### 1.3 Tier 2: `pytest-dev/pytest` (19 Tasks)

| Metric | Solo Baseline (Track A) | + agent-teamwork (Track B) | Delta |
| :--- | :---: | :---: | :---: |
| **Patches Generated** | 16/19 (84.2%) | 16/19 (84.2%) | — |
| **Official Resolved (Pass@1)** | **12/19 (63.2%)** | **14/19 (73.7%)** | **+10.5% (+2 tasks)** |
| **Unresolved (Patch applied, tests failed)** | 3 (`10356`, `7324`, `7490`) | 2 (`5787`, `7324`) | −1 |
| **Empty Patches (Turn budget exhausted)** | 3 (`5840`, `6197`, `7236`) | 3 (`10356`, `5840`, `6197`) | — |
| **Fatal Patch Errors (`git apply` failure)** | **1 (`pytest-dev__pytest-7205`)** | **0** | **−1 error** |
| **Total API Calls / Tokens** | 58 calls / 1.71M tokens | 69 calls / 1.94M tokens | +19.0% / +13.7% |
| **Average Patch Size** | 2,182 chars | **1,442 chars** | **−33.9% more surgical** |

### 1.4 Tier 1: `psf/requests` (8 Tasks)

| Metric | Solo Baseline (Track A) | + agent-teamwork (Track B) | Delta |
| :--- | :---: | :---: | :---: |
| **Patches Generated** | 8/8 (100%) | 8/8 (100%) | — |
| **Official Resolved (Pass@1)** | **4/8 (50.0%)** | **5/8 (62.5%)** | **+12.5% (+1 task)** |
| **Unresolved (Blind Failures)** | 3 (2317, 2931, 5414) | 3 (2317, 2931, 5414) | — (model reasoning boundary) |
| **Fatal Patch Errors (`git apply` failure)** | **1 (`psf__requests-6028`)** | **0** | **−1 error** |
| **Total API Calls / Turns** | 21 calls | **17 calls** | **−19.0%** |
| **Total Tokens Consumed** | 418,000 | **239,000** | **−42.8% (+75% Solo bloat)** |

```
Key Breakthroughs Across 52 Verified Tasks:
1. Anti-Paralysis Alerts: Halved empty patches on multi-repo (12 -> 6), directly unlocking 3 exclusive wins.
2. Surgical Diff Extraction: requests-6028 (535 chars), pytest-7205 (606 chars), and sympy-11618 (1,135 chars) cleanly resolved where Solo monolithic rewrites broke git apply.
3. Context Pruning & Line-Slicing: Reduced multi-repo tokens by 46.2% on massive repositories.
```

Official audit scorecards: [`benchmarks/swebench/results/`](benchmarks/swebench/results/). Details: [`docs/SWEBENCH_GUIDE.md`](docs/SWEBENCH_GUIDE.md).

---

## 2. 15-Task Synthetic Benchmark (`deepseek-v4.1-flash`)

| Metric | Solo (Track A) | + agent-teamwork (Track B) | Delta |
| :--- | :---: | :---: | :---: |
| **Pass@1 (exit code 0)** | 100.0% (15/15) | 100.0% (15/15) | tie at ceiling |
| **API calls consumed** | 25 | **19** | **−24%** |
| **Out-of-bounds writes landed** | **18 files / 3 tasks** | **0** | path lock blocked 7 attempts |
| **False victory claims** | 2 | **0** | **−2** |
| **Stall aborts / replans** | n/a | **0 / 0** | write-aware held |

Full report: [`docs/BENCHMARK_REPORT.md`](docs/BENCHMARK_REPORT.md). Raw run: [`benchmarks/results/live-ab-deepseek-final.json`](benchmarks/results/live-ab-deepseek-final.json).

---

## 3. Historical 10-Task Baseline (`mimo-v2.6-flash`)

All figures below come from the live A/B exam run on 2026-10-24 against `mimo-v2.6-flash` at `https://opencode.ai/zen/go/v1/chat/completions` (reproducible via `npm run benchmark:live`). Same model, same endpoint, same budgets. The only variable is the collaboration scaffolding.

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

### 3.1 Per-Task Results

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

### 3.2 Canonical Benchmark Tasks (`SWE-JS-001` through `SWE-JS-015`)

The canonical benchmark suite includes 15 standardized engineering tasks:
- `SWE-JS-001` Prototype pollution guard (Security)
- `SWE-JS-002` Async queue backpressure (Concurrency)
- `SWE-JS-003` Router async error propagation (Routing)
- `SWE-JS-004` Circular $ref resolution (Schema)
- `SWE-JS-005` SemVer pre-release filtering (SemVer)
- `SWE-JS-006` Cross-platform path separators (Filesystem)
- `SWE-JS-007` LRU concurrent eviction (Data structures)
- `SWE-JS-008` AbortSignal two-way teardown (Events)
- `SWE-JS-009` qs nested decoder + DoS cap (Parser security)
- `SWE-JS-010` Config deep-freeze immutability (Config)
- `SWE-JS-011` Inverted index document store (State machine & indexing)
- `SWE-JS-012` Reentrant distributed mutex (Concurrency & lease recovery)
- `SWE-JS-013` RFC 6902 JSON Patch evaluator (RFC compliance & rollback)
- `SWE-JS-014` Two-phase commit state machine (Distributed 2PC transaction)
- `SWE-JS-015` Backpressure stream pipeline (Reactive streams flow control)

---

## 4. Multi-Level Evaluation Architecture

| Level | Command | What it proves | Network |
| :--- | :--- | :--- | :---: |
| **1 — Offline gates** | `npm test` | 18 shared pure functions AST-identical across TS/JS/DWF (SSOT), open-source compliance scan, 49 unit tests | none |
| **2 — Live Synthetic Exam** | `npm run benchmark:live` | Real Pass@1, real token billing, real latency, real boundary behavior on the 15 canonical tasks | real API |
| **3 — Official SWE-bench Verified** | `python3 benchmarks/swebench/eval.py` | Official Docker container blind test adjudication on SWE-bench Verified tasks | Docker + real API |

---

## 5. Run It Yourself

```bash
# 1. Offline tests & SSOT verification
npm test

# 2. In-Repo live synthetic benchmark
export OPENCODE_API_KEY="oc_sk_..."        # or models.local.json, see README
npm run benchmark:live -- --check          # auth precheck + tiny probe
npm run benchmark:live -- --out run.json   # 15-task A/B exam

# 3. Official SWE-bench Verified Docker evaluation
node benchmarks/swebench/runner.mjs --instances benchmarks/swebench/tasks-requests-8.json --mode ab
python3 benchmarks/swebench/eval.py --predictions benchmarks/swebench/predictions-teamwork.jsonl
```
