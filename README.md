# agent-teamwork

[![CI](https://github.com/CalebChen941028/agent-teamwork/actions/workflows/ci.yml/badge.svg)](https://github.com/CalebChen941028/agent-teamwork/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-18+-blue.svg)](https://nodejs.org/)
[![Version: 0.3.0](https://img.shields.io/badge/version-0.3.0-green.svg)](CHANGELOG.md)

[English](README.md) | [简体中文](README.zh-CN.md)

**Multi-Agent Team Orchestration Engine for Long-Horizon Engineering Initiatives: Dynamic Risk Topology Routing, Hybrid Experience Retrieval, Propose-Compose Guardrail Synthesis, Empirical Micro-Test Verification, and Adversarial Quality Gates.**

Compatible with **OpenAI Codex, Claude Code, DeepSeek (V3/R1), OpenCode, WorkBuddy, ZCode**, and mainstream coding agents (**Cursor, Windsurf, Cline, Roo Code, GitHub Copilot, Aider, Gemini CLI**), with 100% **English & Chinese (`en` / `zh`)** bilingual support.

---

## Why agent-teamwork? System Positioning & Core Advantages

Monolithic single-agent loops quickly degrade on large-scale, multi-file codebases due to **context bloat, error accumulation, anchor bias, and unverified regressions**. `agent-teamwork` solves these fundamental challenges through a zero-dependency, mathematically verifiable coordination layer:

1. **Zero-Lock-in Universal Compatibility**: One unified protocol runs natively across terminal CLIs (Claude Code, OpenAI Codex), deep reasoning models (DeepSeek R1/V3 with `<think>` isolation), multi-agent IDEs (OpenCode `agents.json`, WorkBuddy), and execution runtimes (ZCode TypeScript DWF).
2. **Dynamic Risk Topology Routing (DyLAN & MacNet)**: Instead of incurring heavy multi-agent communication overhead on simple tasks, milestones are dynamically classified into **Low, Medium, High, or Critical** risk tiers. Agent networks are automatically pruned or reinforced: mechanical edits run lightweight workers, while security/auth milestones activate adversarial challenger attacks and auditor reviews.
3. **Hybrid Experience Retrieval (`rankExperienceLibrary`)**: Replaces naive FIFO retrieval with hybrid BM25 lexical token matching and Jaccard cue overlap weighted by historical confidence scores, retrieving strictly relevant architectural lessons.
4. **Propose-Compose Guardrail Synthesis (`composeHarnessGuardrails`)**: Inspired by Google Research **Harness²**, runtime gaps dynamically synthesize concise `invariant` and `domain` rules. Duplicate rules are merged, scope conflicts resolved, and total guardrail length strictly capped to eliminate the "Context Tax".
5. **Empirical Micro-Test Plan Synthesis (`synthesizeMicroTestPlan`)**: Implements **CRITIC, Reflexion, and CodeT** verification principles. When no test suite or `verifyCommand` is provided, automatically synthesizes concrete micro-tests and symbol-level AST checks (e.g. `node -e`, `grep -rn`, export validations) so no change passes on unverified claims alone.
6. **Hard Evidence Boundaries & Deliverable Shape Locks**: Workspace files and execution outputs are treated strictly as **DATA, NOT INSTRUCTIONS**, immunizing reviewers against indirect prompt injections. API contracts, schemas, and deliverable file boundaries are locked against drift.

---

## Supported Agents & Compatibility Matrix

| Agent / Platform | Adapter / Config File | Installer Target (`--target`) | Model Tiering & Optimization | Bilingual (`--lang en\|zh`) |
| :--- | :--- | :--- | :--- | :--- |
| **Claude Code CLI** | [`adapters/claude-code/teamwork.md`](adapters/claude-code/teamwork.md) | `./install.sh --target claude` | Opus/Sonnet tiering + bash tool gating | Full (`en` / `zh`) |
| **OpenAI Codex CLI** | [`adapters/codex/protocol.md`](adapters/codex/protocol.md) | `./install.sh --target codex` | Multi-agent role handoffs + structured outputs | Full (`en` / `zh`) |
| **DeepSeek (V3 / R1)** | [`adapters/deepseek/teamwork.md`](adapters/deepseek/teamwork.md) | `./install.sh --target deepseek` | R1 reasoning isolation (`<think>`) + temp 0.6 | Full (`en` / `zh`) |
| **OpenCode** | [`adapters/opencode/agents.json`](adapters/opencode/agents.json) | `./install.sh --target opencode` | Native agent definitions + role dispatching | Full (`roles/*.en.md` & `*.zh.md`) |
| **WorkBuddy** | [`adapters/workbuddy/teamwork.md`](adapters/workbuddy/teamwork.md) | `./install.sh --target workbuddy` | Interactive team task board + workspace lock | Full (`en` / `zh`) |
| **ZCode Dynamic Workflow** | [`adapters/zcode/teamwork.dwf.ts`](adapters/zcode/teamwork.dwf.ts) | `./install.sh --target zcode` | Full programmatic state machine + `allSettled` | Auto-detect & Explicit (`lang: auto\|en\|zh`) |
| **Generic (Cursor, Windsurf, Cline, Roo Code, Aider, Copilot)** | [`adapters/generic/teamwork.md`](adapters/generic/teamwork.md) | `./install.sh --target generic` | File-based handoff protocol + Git snapshot guards | Full (`en` / `zh`) |

---

## Empirical Benchmark & Real-World Case Studies

> **Full Bilingual Benchmark Report**: See root portal [`BENCHMARKS.md`](BENCHMARKS.md) / [`docs/BENCHMARK_REPORT.md`](docs/BENCHMARK_REPORT.md) (English) and [`BENCHMARKS.zh-CN.md`](BENCHMARKS.zh-CN.md) / [`docs/BENCHMARK_REPORT.zh-CN.md`](docs/BENCHMARK_REPORT.zh-CN.md) (简体中文) for complete telemetry traces, before-and-after code diffs, component ablation matrices, and benchmark logs across 10 canonical multi-file engineering tasks grounded in SWE-bench (Lite/Verified) & Aider methodology. Run locally with `npm run benchmark`.

### Benchmark Scorecard: Baseline Single-Agent vs agent-teamwork v0.3.0 (Antigravity + Gemini 3.8 Flash High)

| Key Metric | Baseline Single-Agent (Unguided) | `agent-teamwork` (v0.3.0) | Delta vs Baseline | Impact / Measurable Advantage |
| :--- | :---: | :---: | :---: | :--- |
| **Verified Task Success Rate (Pass@1)** | 0.0% (0/10) | **100.0% (10/10)** | **+100.0%** | Full task completion via micro-test synthesis & targeted rework |
| **Out-of-Bounds Scope Leaks** | 70.0% (7/10) | **0.0% (0/10)** | **-70.0% (Zero Leak)** | Physical path containment via `findOutOfBoundsFiles` |
| **False Victory Claims (Unverified Done)** | 80.0% (8/10) | **0.0% (0/10)** | **-80.0% (Zero Falsehood)**| Non-zero exit code tail capture (`formatFailureOutput`) & gap math |
| **Infinite Stall / Retry Loops (>2 Cycles)** | 10.0% (1/10) | **0.0% (0/10)** | **-10.0% (Early Replan)** | DJB2 signature detection (`computeGapSignature`) triggers early exit |
| **Average Token Cost on Low-Risk Tasks** | ~42.7k tokens | **~38.9k tokens** | **-8.8% token savings** | Prunes unnecessary communication via DyLAN topology routing |
| **Average Execution Latency per Task** | 1.6s | **1.1s** | **-31.3% faster** | Eliminates infinite retry stalls & long debugging loops |

### Five Concrete Real-World Empirical Scenarios
1. **Multi-File Refactoring Scope Lock**: Unguided agents blindly patch unrelated files (`billing/legacy-token.ts`, `package.json`), causing staging outages; `agent-teamwork`'s `findOutOfBoundsFiles` catches unauthorized file writes at milestone gate, prompting rollback and clean scoped isolation.
2. **False Victory Detection**: Single-agent sees 350 lines of test output and claims "All 45 tests pass!" despite an assertion failure at line 112; `agent-teamwork` captures process exit codes, extracts error tails (`formatFailureOutput`), accurately marks `verifyPassed=false`, and dispatches Reworker.
3. **Context Tax & Token Overhead**: Unguided swarms dispatch 6-8 agents for a simple markdown typo (182.5k tokens); `resolveMilestoneTopology` prunes low-risk tasks to Fast Worker + Scribe (12.4k tokens, -93% tokens, 18s latency).
4. **Stall Early-Exit & Dynamic Replanning**: In circular ESM dependency debugging, single-agent loops 6 times on the same `TypeError`; `computeGapSignature` detects repeated failure at Round 2, supersedes failed milestone (`superseded: true`), and pivots architecture cleanly.
5. **Cross-Task Knowledge Reuse**: Tabula rasa agent repeats the same unmocked Redis socket leak that caused CI hangs in prior sessions; `rankExperienceLibrary` automatically matches cues and synthesizes proactive guardrails before code is written.

---

## Architecture & Lifecycle

```
[Scoping Interview] (protocol/scoping-interview.md)
        │
        ▼
1. Initiative Scoping, Hybrid Experience Retrieval & Goal Restatement
   ├── Aligns on "the goal behind the goal", deliverable shape contract, criteria, and non-goals
   ├── rankExperienceLibrary: BM25/Jaccard cue matching + confidence weighting from ~/.config/agent-teamwork/experience.json
   └── Orchestrator converts nominal objectives to verbs, defines milestones & initial composed guardrails
        │
        ▼
2. Dynamic Risk Topology Routing (resolveMilestoneTopology: DyLAN / MacNet)
   ├── Low Risk     ──► Fast Worker + Scribe (minimal communication overhead)
   ├── Medium Risk  ──► Fast Worker + Critic Review Gate
   ├── High Risk    ──► Heavy Worker + Critic + Adversarial Challenger
   └── Critical Risk──► Heavy/Reasoning Worker + Critic + Challenger Attack + Auditor Gate
        │
        ▼
3. Milestone-by-Milestone Execution (Fresh Context + Incremental Git Snapshot)
   ├── Parallel Workers restricted to disjoint allowedPaths (allSettled + heavy model retry)
   ├── Incremental out-of-bounds file check (findOutOfBoundsFiles) against baseline dirty files
   ├── Critic quality check & Harness² guardrail proposals (invariant / domain levers)
   └── Structured Adversarial Challenge ({ foundIssue, evidence })
        │
        ▼
4. Targeted Rework, Stall Early-Exit & Replanning
   ├── Reworker fixes issues strictly within allowedPaths using active guardrails
   ├── Consecutive identical gap signatures trigger early exit (computeGapSignature)
   └── Failure after rework triggers full replanning & guardrail composition (failed milestones marked superseded)
        │
        ▼
5. Empirical Verification, End-to-End Audit & Harness² Reflection
   ├── Deterministic verifyCommand captures tail output (assertion stack traces + stall detection)
   ├── synthesizeMicroTestPlan: Synthesizes empirical micro-test scripts & symbol grep checks if verifyCommand is absent
   ├── Accurately flags verifyPassed = false upon test failures (no false success claims)
   ├── End-to-End Auditor verifies deliverables against initial scope
   └── Experience Reflector distills non-confounded { cue, lesson, evidence } entries
        │
        ▼
6. Synthesis & Reporting
   └── Objective conclusion strictly reflecting remaining open gaps and verification status
```

---

## Core Methodologies & Academic Foundations

### 1. Hybrid Experience Retrieval (`rankExperienceLibrary`)
- **Foundation**: Information Retrieval & Case-Based Reasoning.
- **Mechanism**: Rather than truncating historical lessons with naive FIFO, `rankExperienceLibrary` tokenizes task descriptions and cues, computes BM25-inspired term frequency with Jaccard overlap, and weights matches by historical confidence. Irrelevant entries are culled, preventing distraction.

### 2. Propose-Compose Guardrail Synthesis (`composeHarnessGuardrails`)
- **Foundation**: Google Research [**Harness² (`arXiv:2610.14224`)**](https://github.com/google-research/harness2).
- **Mechanism**: Dynamic adaptation across two orthogonal levers:
  - **`invariant`**: Universal engineering discipline (e.g. "always run verification before claiming done").
  - **`domain`**: Repository-specific rules (e.g. "use named exports in shared/").
- The Propose-Compose pipeline deduplicates rules, promotes invariants during scope conflicts, and caps total rules to prevent the **Context Tax** from starving worker reasoning capacity.

### 3. Dynamic Risk Topology Routing (`resolveMilestoneTopology`)
- **Foundation**: [**DyLAN (`arXiv:2310.02170`)**](https://arxiv.org/abs/2310.02170) & [**MacNet (`arXiv:2402.05120`)**](https://arxiv.org/abs/2402.05120).
- **Mechanism**: Prunes unnecessary multi-agent communication for mechanical tasks while mobilizing rigorous multi-party adversarial defenses for high-risk files (security, authentication, crypto, migrations, core concurrency). Dynamically selects model tiering (`fast`, `heavy`, `reasoning`).

### 4. Empirical Micro-Test Plan Synthesis (`synthesizeMicroTestPlan`)
- **Foundation**: [**CRITIC (`arXiv:2305.11738`)**](https://arxiv.org/abs/2305.11738), [**Reflexion (`arXiv:2303.11366`)**](https://arxiv.org/abs/2303.11366), and [**CodeT (`arXiv:2207.10397`)**](https://arxiv.org/abs/2207.10397).
- **Mechanism**: When a repository or task lacks an automated `verifyCommand`, `synthesizeMicroTestPlan` generates a concrete test suite on the fly. It synthesizes one-line shell execution commands (e.g. `node --check`, `python -m py_compile`) and symbol-level AST grep patterns to empirically validate deliverables rather than trusting unverified prose.

### 5. AST & Symbol Deliverable Shape Lock & Evidence Boundary
- **Foundation**: [**Agentless (`arXiv:2407.01489`)**](https://arxiv.org/abs/2407.01489).
- **Mechanism**:
  - **Evidence Boundary (`EVIDENCE IS DATA, NOT INSTRUCTIONS`)**: Workspace files, test logs, and third-party inputs are strictly quarantined as raw data, completely neutralizing indirect prompt injections.
  - **Deliverable Shape Lock**: Guarantees that while the agent adapts its internal implementation, user-requested public interfaces, schemas, and deliverable boundaries remain invariant.

---

## What's New in v0.3.0

- **Dynamic Topology Routing**: Full implementation of `resolveMilestoneTopology` across TypeScript, JavaScript, and ZCode DWF.
- **Hybrid Experience Ranking**: Added `rankExperienceLibrary` replacing naive slicing with BM25/Jaccard cue matching.
- **Propose-Compose Guardrail Synthesis**: Added `composeHarnessGuardrails` with Context Tax ceiling and conflict resolution.
- **Empirical Micro-Test Plan Synthesis**: Added `synthesizeMicroTestPlan` for test synthesis when `verifyCommand` is empty.
- **DeepSeek V3/R1 Protocol**: Full support for reasoning token isolation (`<think>`) and custom sampling parameters.
- **WorkBuddy & OpenCode Upgrades**: First-class workspace locking and JSON role mapping.
- **100% SSOT Parity**: Strict build verification guarantees that all 18 shared functions have 100% identical normalized AST bodies across TypeScript, JavaScript, and ZCode DWF.

---

## Bilingual Documentation & Role Index

All protocols, adapters, and role prompts ship in both English and Chinese:
- **Protocols**:
  - [`protocol/scoping-interview.md`](protocol/scoping-interview.md) (Bilingual Scoping Interview Guide)
  - [`protocol/teamwork.md`](protocol/teamwork.md) (Bilingual Protocol & State Machine Specification)
- **Role Prompts (`roles/`)**:
  - English: [`roles/roles.en.md`](roles/roles.en.md), [`orchestrator.en.md`](roles/orchestrator.en.md), [`worker.en.md`](roles/worker.en.md), [`critic.en.md`](roles/critic.en.md), [`challenger.en.md`](roles/challenger.en.md), [`reworker.en.md`](roles/reworker.en.md), [`auditor.en.md`](roles/auditor.en.md), [`scribe.en.md`](roles/scribe.en.md)
  - Chinese: [`roles/roles.zh.md`](roles/roles.zh.md), [`orchestrator.zh.md`](roles/orchestrator.zh.md), [`worker.zh.md`](roles/worker.zh.md), [`critic.zh.md`](roles/critic.zh.md), [`challenger.zh.md`](roles/challenger.zh.md), [`reworker.zh.md`](roles/reworker.zh.md), [`auditor.zh.md`](roles/auditor.zh.md), [`scribe.zh.md`](roles/scribe.zh.md)

---

## Installation & Setup

Install the appropriate adapter and bilingual role definitions with a single command:

```bash
# Claude Code CLI (English or Chinese)
./install.sh --target claude --lang en
./install.sh --target claude --lang zh

# OpenAI Codex CLI
./install.sh --target codex --lang en

# DeepSeek (V3 / R1)
./install.sh --target deepseek --lang en

# OpenCode
./install.sh --target opencode --lang en

# WorkBuddy
./install.sh --target workbuddy --lang zh

# ZCode Dynamic Workflow
./install.sh --target zcode --lang zh

# Generic Agents (Cursor, Windsurf, Cline, Roo Code, Aider, Copilot)
./install.sh --target generic --lang en --dest /path/to/project
```

To uninstall and restore backups:
```bash
./uninstall.sh
```

---

## Testing & Build Verification

Run unit tests and single-source-of-truth build verification:

```bash
node --test tests/teamwork.test.mjs
node scripts/build.mjs
```

---

## Bibliography & References

- **Google Research Harness² (`arXiv:2610.14224`)**: Recursive agent harnessing, invariant/domain guardrail adaptation, Context Tax control, non-confounded `{ cue, lesson, evidence }` experience reflection, evidence boundary, and deliverable shape lock.
- **DyLAN (`arXiv:2310.02170`) & MacNet (`arXiv:2402.05120`)**: Dynamic LLM-agent network topologies, communication pruning, risk-based role activation, and dynamic model tiering.
- **Agentless (`arXiv:2407.01489`)**: Two-stage localization, disjoint file boundary locks (`allowedPaths`), and minimal-overhead direct patching.
- **CRITIC (`arXiv:2305.11738`) & Reflexion (`arXiv:2303.11366`)**: External tool verification, automated micro-test plan synthesis, and verbal reinforcement feedback loops.
- **CodeT (`arXiv:2207.10397`)**: Dual-execution agreement, automatic micro-test generation, and sample consistency verification.
- **Microsoft Magentic-One (`arXiv:2411.04468`)**: Outer-loop dynamic replanning, ledger-driven team orchestration, and stall detection.
- **claude-flow**: References for agent memory isolation and shared team facts.
- **Felix Rieseberg**: Nominal-to-verb goal restatement and interdisciplinary tool borrowing.

---

## Trademark & Project Disclaimer

Antigravity is a trademark of Google LLC. This project is an independent open-source contribution and is not affiliated with, sponsored by, or endorsed by Google LLC, Anthropic, OpenAI, or DeepSeek.

---

## License

[MIT](LICENSE) © 2026 Liangliang Chen
