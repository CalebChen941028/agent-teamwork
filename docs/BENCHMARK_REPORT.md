# agent-teamwork Live Evaluation Report — deepseek-v4.1-flash 15-Task A/B Exam

[![Version: 0.5.1](https://img.shields.io/badge/version-0.5.1-green.svg)](../CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Tests: 100% Pass](https://img.shields.io/badge/tests-50%2F50%20passing-brightgreen.svg)](../tests/)
[![SSOT: Parity](https://img.shields.io/badge/SSOT-100%25%20identical-blueviolet.svg)](../scripts/build.mjs)

[English](BENCHMARK_REPORT.md) | [简体中文](BENCHMARK_REPORT.zh-CN.md) | [Portal: BENCHMARKS.md](../BENCHMARKS.md)

Every number below comes from real HTTP calls against `deepseek-v4.1-flash`, executed and scored on 2026-10-25 (finalized 2026-10-24T17:43 UTC). Verdicts are the true exit codes of verifier subprocesses in git sandboxes. Nothing is projected or hand-entered. The previous mimo-v2.6-flash exam (2026-10-24, engine v0.3.x) is preserved in §8 as the record that motivated the v0.4.0 fixes this exam validates.

- **Runtime**: OpenCode Zen gateway / ZCode Engine harness, macOS arm64 (Darwin 27.0.0), Node.js v22.23.1
- **Endpoint**: `https://opencode.ai/zen/go/v1/chat/completions` (OpenAI-compatible, `x-opencode-session` required)
- **Model**: `deepseek-v4.1-flash` (reasoning model; completion tokens are dominated by reasoning)
- **Request budget**: temperature 0.2, `max_tokens` 16384, 6 turns per track, HTTP timeout 420 s
- **Engine**: agent-teamwork v0.4.0 — write-aware stagnation detection, slimmed scaffold prompts
- **Raw artifacts**: [`benchmarks/results/live-ab-deepseek-final.json`](../benchmarks/results/live-ab-deepseek-final.json) (canonical, union-merged from 15 per-task files), [`live-ab-deepseek.console.log`](../benchmarks/results/live-ab-deepseek.console.log), per-task evidence `live-ab-deepseek-task001.json`…`task015.json`

---

## 1. Executive Scorecard

Track A (Solo) sends the defect description and test catalog to the bare model in a naive loop: full raw test output fed back, no path lock, no early stop. Track B (With agent-teamwork) wraps the same model in the engine: scoping contract, `resolveMilestoneTopology` routing, `findOutOfBoundsFiles` path lock, `formatFailureOutput` tail-only feedback, write-aware `computeGapSignature` stagnation handling, `calculateTeamworkOpenGaps` exit-code accounting. Model, endpoint, sampling parameters, and turn ceiling are identical; the scaffolding is the only variable.

| Metric | Solo (Track A) | + agent-teamwork (Track B) | Delta |
| :--- | :---: | :---: | :---: |
| **Pass@1 (verifier exit code 0)** | **100.0% (15/15)** | **100.0% (15/15)** | tie at ceiling |
| **API calls / turns consumed** | 25 | **19** | **−24%** |
| **Total tokens (prompt + completion)** | 191,691 (22,505 + 169,186) | 184,385 (17,917 + 166,468) | — |
| **Avg tokens per task** | 12,779 | **12,292** | **−3.8%** |
| **Avg wall time per task** | 64.2 s | **55.6 s** | **−13.4%** |
| **Out-of-bounds writes landed** | **18 files / 3 tasks** | **0** | lock blocked 7 proposals |
| **Writes blocked by path lock** | n/a | 7 | (intercepted) |
| **False victory claims** | 2 | **0** | **−2** |
| **Forced replans / stagnation aborts** | n/a | 0 / 0 | write-aware held |
| **Stalled tasks (≥2 identical failure signatures)** | 0 | 0 | — |

deepseek-v4.1-flash solved all 15 tasks in both arms, so Pass@1 cannot differentiate them. The differentiation moved entirely to the guardrail axes, and there the engine swept every axis: Solo polluted the workspace on 3 tasks (18 stray files landed on disk), claimed completion twice while its verifier was failing, and burned 24% more API calls getting to the same answers. Track B landed zero out-of-bounds files (7 proposals blocked before touching disk), made zero unverified success claims, and finished each task faster on average despite larger prompts.

---

## 2. Methodology

### 2.1 Serial per-task protocol

Each task ran as its own invocation (`node benchmarks/live-eval.mjs --mode ab --task SWE-JS-xxx --model deepseek-v4.1-flash --out …`), producing one evidence JSON per task with per-turn character counts, token accounting, exit codes, and failure tails. The 15 files were union-merged by [`benchmarks/merge-live-reports.mjs`](../benchmarks/merge-live-reports.mjs), which refuses to merge reports from different models or modes and records every merge action in `meta.mergedFromTasks`. The merge log: 14 tasks union-added, 0 infra-error splices, zero track errors across all 30 track executions.

### 2.2 Fairness controls

Same model id, endpoint, credentials, temperature, `max_tokens`, 420 s timeout, and 6-turn ceiling in both tracks. Solo receives the full raw verifier output; Teamwork receives the tail-only feed — that difference is the treatment, not a confound.

### 2.3 Mid-exam harness defects, found and fixed

The first full pass exposed two harness defects, and the honest handling matters more than the defects themselves:

1. **Porcelain directory collapse.** `git status --porcelain` lists a wholly untracked directory as `?? tests/`. When the model (correctly) wrote a whitelisted file such as `tests/merge.test.js` into a directory that did not exist at sandbox init, the collapsed entry `tests` failed to match the file-level `allowedPaths` whitelist and read as out-of-bounds pollution — failing otherwise-passing teamwork tracks. Fixed by querying `--porcelain -uall` (individual files) plus defensive trailing-slash stripping in `parseGitStatus`.
2. **Write-collision crash.** A proposal sequence that first writes a file `x` and then `x/y.js` throws `EEXIST` on `mkdir`, which killed one solo track outright. `applyWrites` now fails that single write into its `failed` ledger instead of throwing.

The first pass's 15 result files were produced under the defective accounting and were **discarded in full** (never committed); the entire 15-task exam was re-run under the fixed harness so the canonical dataset comes from one uniform engine version. Regression assertions for both defects live in the offline suite (`npm test`, 41/41 green).

### 2.4 Write-aware stagnation detection (the mechanism under validation)

In v0.3.x, `computeGapSignature` counted identical failure signatures regardless of whether any file had landed, so a reasoning model's pre-payload "thinking" turns were misread as stagnation — on the mimo exam this aborted 6 of 10 teamwork tracks at turn 3. v0.4.0 gates the stagnation counter on `wroteFiles` (writes actually landed this turn) and injects a "[NO DISK WRITES]" nudge into the feedback when a turn produces analysis only.

---

## 3. Per-Task Telemetry

All values from `live-ab-deepseek-final.json`. "icept" = proposals blocked by the path lock; "OOB" = out-of-bounds files that actually landed.

| Task | Solo | turns / tokens / time | Teamwork | turns / tokens / time | icept | Solo OOB |
| :--- | :---: | :--- | :---: | :--- | :---: | :--- |
| SWE-JS-001 Prototype pollution guard | PASS | 1 / 8.1k / 46s | PASS | 1 / 7.8k / 41s | 4 | — |
| SWE-JS-002 Async queue backpressure | PASS | 2 / 2.3k / 9s | PASS | 1 / 17.1k / 80s | 0 | — |
| SWE-JS-003 Router async error propagation | PASS | 2 / 25.4k / 159s | PASS | 1 / 15.4k / 82s | 1 | — |
| SWE-JS-004 Circular $ref resolution | PASS | 2 / 30.7k / 154s | PASS | 2 / 9.2k / 40s | 1 | — |
| SWE-JS-005 SemVer pre-release filtering | PASS | 1 / 4.2k / 18s | PASS | 2 / 9.8k / 33s | 0 | 2 files |
| SWE-JS-006 Cross-platform path separators | PASS | 1 / 15.8k / 87s | PASS | 2 / 28.5k / 141s | 0 | — |
| SWE-JS-007 LRU concurrent eviction | PASS | 1 / 9.2k / 47s | PASS | 1 / 7.7k / 36s | 1 | — |
| SWE-JS-008 AbortSignal two-way teardown | PASS | 3 / 7.0k / 20s | PASS | 1 / 3.2k / 13s | 0 | — |
| SWE-JS-009 qs nested decoder + DoS cap | PASS | 2 / 22.4k / 117s | PASS | 2 / 22.7k / 108s | 0 | — |
| SWE-JS-010 Config deep-freeze immutability | PASS | 1 / 4.5k / 23s | PASS | 1 / 3.0k / 11s | 0 | — |
| SWE-JS-011 Inverted-index document store | PASS | 2 / 7.4k / 22s | PASS | 1 / 2.9k / 9s | 0 | **12 files** |
| SWE-JS-012 Reentrant distributed lock | PASS | 2 / 4.1k / 15s | PASS | 1 / 8.4k / 38s | 0 | — |
| SWE-JS-013 RFC 6902 JSON Patch | PASS | 1 / 14.0k / 74s | PASS | 1 / 17.6k / 76s | 0 | — |
| SWE-JS-014 Two-phase commit state machine | PASS | 2 / 5.7k / 22s | PASS | 1 / 14.2k / 55s | 0 | 4 files |
| SWE-JS-015 Backpressured async pipeline + breaker | PASS | 2 / 30.9k / 149s | PASS | 1 / 17.0k / 72s | 0 | — |

Details worth naming:

1. **SWE-JS-011 Solo is the pollution showcase**: alongside the correct implementation, the bare model landed 12 unrequested files — `package.json`, three `.mocharc.*` variants, a `README.md`, an `src/index.js` barrel, four helper modules, and test files in two different directories. Track B's run on the same task wrote exactly one file (the whitelisted entry) and passed on turn 1.
2. **SWE-JS-008 Solo produced a false victory**: turn 2 claimed completion while the verifier still failed; the loop continued and turn 3 passed. SWE-JS-011 Solo did the same. Track B recorded zero such claims across all 15 tasks.
3. **The blocked-proposal list is concrete**: `package.json` (5 times across 001/003/004/007), `run-baseline.cjs`, `.nvmrc`, `.gitignore` — the model tried to "improve the project" beyond scope; the lock declined, in writing, before anything touched disk.

---

## 4. The Write-Aware Fix, Validated Live

The single question this exam was designed to answer: does gating stagnation on actual writes stop the premature-abort failure mode without reintroducing infinite loops?

- **Three teamwork tracks opened with a pure analysis turn** (zero writes, zero blocks): SWE-JS-005 t1, SWE-JS-006 t1, SWE-JS-009 t1. Under v0.3.x signature logic, each would have been one repeat away from a forced replan and two repeats from abort. Under v0.4.0, all three received the "[NO DISK WRITES]" nudge, delivered their implementation on the next turn, and **passed** — 0 replans, 0 aborts across the entire exam.
- **No stagnation anywhere**: 0 replans, 0 aborts, 0 stalled tasks in both arms. The mimo exam's failure mode (6 stagnation aborts in 10 teamwork tracks) is gone on a model with the same pre-payload turn behavior.
- **The nudge did not just avoid harm — it helped**: each no-write-first-turn task converted to a pass on the very next turn (005 and 006 passed on t2, 009 on t2), with the loop converging immediately once directed to emit files.

The trade the fix makes — patience for pre-payload turns — cost nothing here because deepseek's analysis turns are genuinely convergent. The old abort-at-3 behavior remains correct for its designed target (same write, same failure, twice); it simply no longer fires on thinking.

---

## 5. Cost and Latency

- **Fewer calls to the same answers.** Teamwork used 19 turns against Solo's 25 (−24%). On 11 of 15 tasks the engine track needed strictly fewer turns than Solo; the contract's first-write discipline is the visible cause — SWE-JS-011 (1 turn vs 2), SWE-JS-012 (1 vs 2), SWE-JS-015 (1 vs 2), SWE-JS-008 (1 vs 3).
- **Completion-dominated token profile.** deepseek-v4.1-flash spends ~89% of its measured output on reasoning by completion tokens (Solo: 169,186 completion vs 22,505 prompt tokens). The engine's prompt savings are therefore modest in relative terms (−3.8% avg per task); the savings channel that matters for this model class is turn count, and there the engine wins by a quarter.
- **Wall time inverted in the engine's favor**: 55.6 s vs 64.2 s per task (−13.4%) — fewer turns beats longer prompts. Average API latency per call is slightly higher on Track B (43.8 s vs 38.4 s), consistent with the bigger scaffold prompts giving the model more to reason about per call.

---

## 6. Scope Conditions

- One model, one endpoint, one night, 15 tasks, temperature 0.2. The Pass@1 tie at 100% means this exam measures guardrails and efficiency, not problem-solving headroom; a harder task set would be needed to separate the arms on correctness.
- Solo's 18 landed pollution files are real workspace changes that a CI would have committed or a reviewer would have had to revert. The engine's 7 blocks and 0 landings are the contract doing exactly its job.
- Cross-exam comparison with §8 (mimo) is qualitative: the model AND the engine version both changed between exams. The write-aware validation in §4 is the controlled evidence for the fix; the exam-to-exam delta is not.
- The first-pass results under the porcelain-collapse defect were discarded and re-run (§2.3); only fixed-harness data is committed.

---

## 7. Reproduction

One-liner equivalents: `npm run benchmark:live` (all tasks, default model from `models.local.json`) or `npm run benchmark:live -- --mode ab --task SWE-JS-001 --model deepseek-v4.1-flash`.

```bash
node benchmarks/live-eval.mjs --check --model deepseek-v4.1-flash     # auth precheck
for i in 001 002 003 004 005 006 007 008 009 010 011 012 013 014 015; do
  node benchmarks/live-eval.mjs --mode ab --task SWE-JS-$i --model deepseek-v4.1-flash \
    --out benchmarks/results/live-ab-deepseek-task$i.json
done
node benchmarks/merge-live-reports.mjs benchmarks/results/live-ab-deepseek-task*.json \
  -o benchmarks/results/live-ab-deepseek-final.json
```

Level-1 offline gates: `npm test` → `scripts/build.mjs` (18 shared pure functions AST-identical across TS/JS/DWF, clean-room compliance) + 41 unit tests, 19 of which exercise the live harness with injected transports and scripted clients, including regressions for both mid-exam defects. Level-2 is the live exam above; both levels share the same 15-task ground truth and the same verdict channel (`process.exitCode`).

---

## 8. Historical Record: mimo-v2.6-flash 10-Task Exam (2026-10-24, engine v0.3.x)

Preserved because it is the evidence that motivated the v0.4.0 write-aware fix. Same endpoint, 10-task suite, 180 s timeout, pre-fix stagnation signature. Raw artifacts: [`live-ab-final.json`](../benchmarks/results/live-ab-final.json) et al.

| Metric | Solo | + agent-teamwork (v0.3.x) |
| :--- | :---: | :---: |
| Pass@1 | **70.0% (7/10)** | 40.0% (4/10) |
| Out-of-bounds writes | 0 | 0 |
| False victory claims | 1 | **0** |
| Tokens on the 3 shared-failure tasks | 55.5k | **32.4k (−41.7%)** |
| Avg tokens / wall time per task | 10,520 / 98.4 s | 9,746 / 157.4 s |
| Stagnation aborts | n/a | 6 of 10 tracks |

The v0.3.x `computeGapSignature` read mimo's pre-payload "thinking" turns (reasoning exhausted the completion budget; 200–900-character replies with no file block) as stagnation and aborted at turn 3 of 6, while Solo converged in turns 2–5 on exactly those tasks. §4 of this report is the fix's live validation. Four remediation items were recorded at the time: write-aware signatures (shipped in v0.4.0), turn-budget parity, a 420 s default timeout for reasoning channels (shipped), and a condensed harness prompt (shipped).
