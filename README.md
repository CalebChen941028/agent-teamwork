# agent-teamwork

[![CI](https://github.com/CalebChen941028/agent-teamwork/actions/workflows/ci.yml/badge.svg)](https://github.com/CalebChen941028/agent-teamwork/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-18+-blue.svg)](https://nodejs.org/)

**Multi-Agent Team Orchestration for Long-Horizon Engineering Initiatives: Scoping Interviews, Milestone Parallelism, Adversarial Quality Gates, Stall-Triggered Replanning, and Final Audit.**

`agent-teamwork` orchestrates collaborative multi-agent teams on expansive, multi-step engineering tasks (new features, large-scale refactors, cross-module upgrades, deep research pipelines) through rigorous scoping, bounded file modification, structured adversarial checks, and deterministic audit gates.

---

## Architecture & Lifecycle

```
[Scoping Interview]
        │
        ▼
1. Initiative Scoping & Goal Restatement
   ├── Aligns on "the goal behind the goal", acceptance criteria, and non-goals
   └── Orchestrator converts nominal objectives to verbs and defines milestones
        │
        ▼
2. Milestone-by-Milestone Execution (Fresh Context Per Milestone)
   ├── Parallel Workers restricted to disjoint allowedPaths (allSettled + retry)
   ├── Critic quality check
   └── Structured Adversarial Challenge ({ foundIssue, evidence })
        │
        ▼
3. Targeted Rework & Replanning
   ├── Reworker fixes issues strictly within allowedPaths
   └── Failure after 3 rounds triggers full plan re-planning (failed milestones marked superseded)
        │
        ▼
4. Final Acceptance Command & End-to-End Audit
   ├── Deterministic verifyCommand captures tail output (assertion stack traces)
   ├── Accurately flags verifyPassed = false upon test failures
   └── End-to-End Auditor verifies deliverables against initial scope
        │
        ▼
5. Synthesis & Reporting
   └── Objective conclusion strictly reflecting remaining open gaps
```

---

## Key Bug Fixes in v0.2.0

- **C1 (Honest Final Verification & Conclusion)**: Fixes a severe bug where conclusion text blindly outputted "终局验收命令通过" whenever `verifyCommand` was provided, even if the command failed! Now records `verifyPassed`, increments `openGaps`, adds high-severity audit findings, and reports command failure accurately.
- **C2 (Superseded Milestone Gap Exclusion)**: Failed milestones that trigger replanning are now marked `superseded: true`, preventing superseded historical failures from polluting final gap metrics once resolved by replanned milestones.
- **C3 (Error Output Tail Preservation)**: Combines stdout and stderr, capturing the last 2000 characters to keep assertion stack traces intact.
- **C4 (Structured Adversarial Verdicts)**: Requires challenger to output `{ foundIssue: boolean, evidence: string }`, preventing statements like "找不到实证" from falsely triggering critic reviews.
- **C5 (Fresh Context Per Milestone)**: Instantiates fresh critic, challenger, and reworker agents per milestone to prevent anchor bias and context bloat.
- **C6 (Strict AllowedPaths Enforcement)**: Explicitly passes the target item's `allowedPaths` into the rework prompt.
- **C7 (Enum Validation & Fault-Tolerant Parallelism)**: Strict validation of `integrityMode` and `teamProfile`, paired with `Promise.allSettled` and automated retry.
- **C8 (Deduplicated Uncovered Items)**: Strips redundant entries from `notCovered`.

---

## Scoping Interview Guide

Teamwork mandates completing a scoping interview before launching execution. See [`protocol/scoping-interview.md`](protocol/scoping-interview.md) for the bilingual scoping template.

---

## Installation

### ZCode Dynamic Workflow
```bash
./install.sh --target zcode --lang zh
```

### Claude Code CLI / Generic Agents
```bash
./install.sh --target claude
./install.sh --target generic --dest /path/to/project
```

---

## Testing

Run unit tests directly:

```bash
node --test tests/teamwork.test.mjs
```

---

## Credits & Acknowledgments

- **Magentic-One**: Inspired the facts ledger, outer-loop dynamic replanning, and stall diagnostics.
- **claude-flow**: References for agent memory isolation and shared team facts.
- **Felix Rieseberg**: Nominal-to-verb goal restatement and interdisciplinary tool borrowing.

---

## Trademark & Project Disclaimer

Antigravity is a trademark of Google LLC. This project is an independent open-source contribution and is not affiliated with, sponsored by, or endorsed by Google LLC or Anthropic.

---

## License

[MIT](LICENSE) © 2026 Liangliang Chen
