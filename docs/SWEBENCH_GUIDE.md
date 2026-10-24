# agent-teamwork Official SWE-bench Verified Integration & Operations Guide

[![Version: 0.4.0](https://img.shields.io/badge/version-0.4.0-green.svg)](../CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![SWE-bench: Verified](https://img.shields.io/badge/SWE--bench-Verified%20(500%20Tasks)-purple.svg)](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified)

[English](SWEBENCH_GUIDE.md) | [简体中文](SWEBENCH_GUIDE.zh-CN.md)

---

## 1. Why Integrate SWE-bench Verified?

During our recent 15-task empirical benchmark with `deepseek-v4.1-flash`, the frontier reasoning model achieved a 100% Pass@1 ceiling across single/double-module algorithmic problems. While `agent-teamwork` demonstrated overwhelming superiority in **boundary containment (18 vs 0 leaked files)** and **strict truthfulness (2 vs 0 false victory claims)**, creating a decisive 30%–50% gap in **correctness (Pass@1)** requires evaluating against full-repository, in-the-wild industrial benchmarks:

1. **Blind / Holdout Test Evaluation**:
   - The model only receives the GitHub issue title and description during execution; **test code is strictly hidden**.
   - Solo agents rely on intuition and frequently miss edge cases, causing Pass@1 to plunge into the 30%–50% range.
   - `agent-teamwork` activates its **Challenger Agent** and **`synthesizeMicroTestPlan`**, generating adversarial test probes locally before marking tasks done.
2. **Whole-Repository Multi-File Navigation**:
   - Tasks originate from 12 prominent open-source Python repositories (`django/django`, `sympy/sympy`, `psf/requests`, `pytest-dev/pytest`, etc.) spanning hundreds of thousands of lines.
   - The physical path lock intercepts accidental modifications to core architecture or untracked directory pollution.
3. **Massive Pre-Existing Test Regression Guards (`PASS_TO_PASS`)**:
   - When fixing a bug, the model must maintain a 100% pass rate across thousands of pre-existing unit tests.

---

## 2. Architecture & Toolchain

The SWE-bench adapter lives under [`benchmarks/swebench/`](../benchmarks/swebench/) with a zero-intrusion modular design:

```
benchmarks/swebench/
├── loader.py             # HuggingFace 500-instance dataset ingestion & local caching (~2.1 MB)
├── runner.mjs            # agent-teamwork protocol runner (generates standard predictions.jsonl)
├── eval.py               # Official Docker evaluation bridge (invokes swebench.harness)
└── cache/                # Local parquet dataset cache (git-ignored)
```

---

## 3. Operational Quickstart

### Prerequisites
- **Python**: `>= 3.10` (with `pandas` and `pyarrow`)
- **Docker**: Installed and running (for official containerized verification)
- **Node.js**: `>= 18.0.0`

---

### Step 1: Inspect & Export Tasks (Dataset Loader)

No Hugging Face token required. `loader.py` downloads and caches the official parquet file directly:

```bash
# View 500-task distribution across repositories and difficulty tiers
python3 benchmarks/swebench/loader.py --info

# Export 8 representative tasks from psf/requests (holdout gold tests stripped for blind evaluation)
python3 benchmarks/swebench/loader.py --repo psf/requests --export /tmp/swe_requests.json

# Export a single targeted instance (e.g., requests-1142)
python3 benchmarks/swebench/loader.py --instance psf__requests-1142 --export /tmp/single_task.json
```

---

### Step 2: Run agent-teamwork Evaluation (Runner)

Run the agent team against exported instances to generate standard `predictions.jsonl`:

```bash
# Track B: agent-teamwork guided execution (path lock, DyLAN risk routing, and adversarial challenge)
node benchmarks/swebench/runner.mjs \
  --instances /tmp/swe_requests.json \
  --mode teamwork \
  --model deepseek-v4.1-flash \
  --out-predictions benchmarks/swebench/predictions-teamwork.jsonl

# Track A: Solo baseline execution
node benchmarks/swebench/runner.mjs \
  --instances /tmp/swe_requests.json \
  --mode baseline \
  --model deepseek-v4.1-flash \
  --out-predictions benchmarks/swebench/predictions-solo.jsonl
```

Each output line satisfies the official SWE-bench schema:
```json
{"instance_id": "psf__requests-1142", "model_name_or_path": "agent-teamwork-v0.4.0", "model_patch": "diff --git a/requests/models.py b/requests/models.py..."}
```

---

### Step 3: Run Official Docker Evaluation (Evaluator)

```bash
# 1. Install official SWE-bench harness package (one-time setup)
pip install swebench

# 2. Offline fast validation (checks patch format and non-empty diffs)
python3 benchmarks/swebench/eval.py --predictions benchmarks/swebench/predictions-teamwork.jsonl --local-check-only

# 3. Official Docker container adjudication (pulls official environment images and runs secret test patch)
python3 benchmarks/swebench/eval.py \
  --predictions benchmarks/swebench/predictions-teamwork.jsonl \
  --dataset princeton-nlp/SWE-bench_Verified \
  --max-workers 4 \
  --run-id agent-teamwork-verified-run
```

---

## 4. Recommended Staged Roadmap

| Tier | Recommended Scope | Objective & Expected Outcome |
| :--- | :--- | :--- |
| **Tier 1: Mini Repo Probe** | `psf/requests` (8 tasks) | Validate end-to-end lifecycle from issue text to Docker test resolution; observe whether Solo fails blind tests on empty body GET requests. |
| **Tier 2: Concurrent Testing** | `pytest-dev/pytest` (19 tasks) | Test deep exception handling and multi-file cascade refactorings; exercise Challenger's boundary coverage. |
| **Tier 3: Full 500-Task Exam** | Full `SWE-bench_Verified` | Generate an official, submission-ready leaderboard entry to benchmark directly against Devin, Claude Code, and Cursor. |
