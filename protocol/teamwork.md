# Teamwork Protocol Specification

## 1. Overview

`agent-teamwork` orchestrates multi-agent teams across long-horizon engineering tasks:
- **Phase 1: Scoping Interview & Alignment**: Confirms objective, "goal behind the goal", non-goals, and acceptance criteria.
- **Phase 2: Milestone Decomposition**: Converts nominal goals to verbs, splits work into chronological milestones with non-overlapping `allowedPaths`.
- **Phase 3: Parallel Milestone Execution & Per-Milestone Fresh Context**: Dispatches parallel worker items with clean contexts.
- **Phase 4: Adversarial Quality Gate & Structured Challenge**: Critic checks milestone completion; Challenger produces structured `{ foundIssue: boolean, evidence: string }` to prevent empty suspicion reworks.
- **Phase 5: Targeted Rework & Replanning**: Up to 3 rework rounds (enforcing `allowedPaths`). If still failing, triggers full plan re-planning and marks superseded failed milestones so they do not falsely pollute final gap metrics.
- **Phase 6: Final Acceptance Command & End-to-End Audit**: Deterministic verification command with tail output preservation; honest conclusion reflecting command success or failure.
- **Phase 7: Synthesis & Reporting**: Comprehensive deliverable report.

---

## 2. State Machine

```
[User Confirmed Scope]
         │
         ▼
Phase 1: Orchestration & Milestone Planning
         │
         ▼
Milestone Loop (Queue):
   ├── Per-Milestone Fresh Context Setup
   ├── Parallel Worker Execution (allSettled + retry)
   ├── Critic Acceptance Check
   ├── Adversarial Challenge (Structured { foundIssue, evidence })
   └── Rework Loop (Up to 3 rounds, restricted by allowedPaths)
         ├── Passed ──► Add to Facts Ledger ──► Next Milestone
         └── Failed after 3 rounds?
                 ├── Replans Available? ──► Re-plan Remaining Queue ──► Mark Failed Milestone as Superseded
                 └── Replans Exhausted? ──► Record Open Gap ──► Next Milestone
         │
         ▼
Phase 6: Final Verification Command (Tail Capture)
   ├── Exit 0? ──► verifyPassed = true
   └── Exit != 0? ──► verifyPassed = false ──► Add to Open Gaps & Findings
         │
         ▼
Phase 7: Final Audit & Report Generation
   └── Conclusion reflects: openGaps, verifyPassed status, and audit verdict
```
