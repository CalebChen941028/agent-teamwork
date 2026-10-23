# Claude Code /teamwork Slash Command & Multi-Agent Architecture

## Overview
Configure `/teamwork` in Claude Code for major multi-step initiatives.

## Command Definition (`.claude/commands/teamwork.md`)

```markdown
Run Teamwork multi-agent workflow on initiative: $ARGUMENTS

Stages:
1. Scoping Interview: Align on the "goal behind the goal", non-goals, and criteria.
2. Orchestrator: Restate goal into active verbs; divide into sequential milestones with disjoint allowedPaths.
3. Workers: Execute milestone items in parallel.
4. Critic & Challenger: Perform quality check; challenger uses structured { foundIssue, evidence } format.
5. Reworker: Address gaps within allowedPaths.
6. Replanning: If rework stalls, replan remaining milestones and mark prior failures superseded.
7. Final Verification & Audit: Run final verifyCommand, capture output tail, and perform end-to-end audit.
```
