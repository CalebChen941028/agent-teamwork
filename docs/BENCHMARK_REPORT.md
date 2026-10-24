# agent-teamwork Live Evaluation Report — mimo-v2.6-flash A/B Exam

[![Version: 0.3.0](https://img.shields.io/badge/version-0.3.0-green.svg)](../CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Tests: 100% Pass](https://img.shields.io/badge/tests-40%2F40%20passing-brightgreen.svg)](../tests/)
[![SSOT: Parity](https://img.shields.io/badge/SSOT-100%25%20identical-blueviolet.svg)](../scripts/build.mjs)

[English](BENCHMARK_REPORT.md) | [简体中文](BENCHMARK_REPORT.zh-CN.md) | [Portal: BENCHMARKS.md](../BENCHMARKS.md)

Every number in this report comes from one live run on 2026-10-24. The harness called the model over HTTP, executed the returned code in git sandboxes, and scored each track by the true exit code of a verifier subprocess. Nothing below is projected, averaged from earlier simulations, or hand-entered.

- **Runtime**: OpenCode Zen gateway / ZCode Engine harness, macOS arm64 (Darwin 27.0.0), Node.js v22.23.1
- **Endpoint**: `https://opencode.ai/zen/go/v1/chat/completions` (OpenAI-compatible, header `x-opencode-session` required)
- **Model**: `mimo-v2.6-flash` (reasoning model; `reasoning_content` precedes `content`)
- **Request budget**: temperature 0.2, `max_tokens` 16384, 6 turns per track, HTTP timeout 180 s (420 s for the three supplemented tracks, see §2.3)
- **Raw artifacts**: [`benchmarks/results/live-ab-final.json`](../benchmarks/results/live-ab-final.json) (canonical, merged), [`live-ab-full.json`](../benchmarks/results/live-ab-full.json) (primary run), per-track supplements and the full console log in the same directory

---

## 1. Executive Scorecard

Track A (Solo) sends the defect description and test catalog to the bare model in a naive loop: full raw test output fed back, no path lock, no early stop. Track B (With agent-teamwork) wraps the same model in the collaboration engine: scoping-interview contract, `resolveMilestoneTopology` routing directives, `findOutOfBoundsFiles` physical path lock, `formatFailureOutput` tail-only failure feedback, `computeGapSignature` stagnation early-stop, and `calculateTeamworkOpenGaps` strict exit-code accounting. The model, endpoint, sampling parameters, and turn budget are identical in both tracks; the scaffolding is the only variable.

| Metric | Solo (Track A) | + agent-teamwork (Track B) | Delta |
| :--- | :---: | :---: | :---: |
| **Pass@1 (verifier exit code 0)** | **70.0% (7/10)** | **40.0% (4/10)** | −30 pts |
| **API calls consumed** | 33 | 25 | −8 calls |
| **Total tokens (prompt + completion)** | 105,195 (59,867 + 45,328) | 97,461 (36,799 + 60,662) | −7.4% avg/task |
| **Avg tokens per task** | 10,520 | 9,746 | −7.4% |
| **Avg wall time per task** | 98.4 s | 157.4 s | +59.9% |
| **Avg API latency per call** | 29.8 s | 48.4 s | +62.7% |
| **Out-of-bounds file writes** | 0 | 0 | — |
| **Writes blocked by path lock** | n/a | 0 | — |
| **False victory claims** | 1 | **0** | −1 |
| **Stalled tasks (≥2 identical failure signatures)** | 5 | 7 | +2 |
| **Forced replans / early-stop aborts** | n/a (no early stop) | 7 replans, 6 aborts | — |

The headline result is uncomfortable and real: on this model, the full harness **reduced** end-to-end Pass@1 from 70% to 40%. At the same time, every guardrail dimension behaved as designed — zero scope violations in both arms, zero false victory claims under the engine (versus one under Solo), and 41.7% fewer tokens burned on the three tasks both tracks failed. §4 traces where the Pass@1 loss came from and what it exposes about the early-stop signature.

---

## 2. Methodology

### 2.1 Harness mechanics

Each of the 10 canonical tasks (`benchmarks/tasks.mjs`, SWE-bench / Aider aligned, `SWE-JS-001`…`010`) runs in its own freshly `git init`-ed sandbox under `os.tmpdir()`, seeded with a deterministic incomplete starter stub. The model replies through a strict file-tag protocol; the harness parses `<file path="…">` blocks, writes them into the sandbox, then runs `run-tests.mjs` — a generated subprocess that imports the sandbox module and executes the task's `groundTruthTests`. `process.exitCode` is the only verdict channel; prose claims never influence scoring.

Track B adds, per turn: out-of-bounds proposals are blocked before touching disk and counted (`findOutOfBoundsFiles`); on failure the model receives only the preserved 2,000-character tail of the verifier output (`formatFailureOutput`); two consecutive identical DJB2 failure signatures force one replan, a third aborts the initiative (`computeGapSignature`); final accounting requires exit code 0 AND zero landed out-of-bounds writes (`calculateTeamworkOpenGaps`).

### 2.2 Fairness controls

Same model id, endpoint, credentials, temperature, `max_tokens`, and 6-turn hard ceiling in both tracks. Track A's feedback is intentionally the *full* raw test output (a naive baseline); Track B's is the tail-only feed — that difference is the treatment under measurement, not a confound.

### 2.3 Infrastructure failures and the supplement policy

Three tracks (SWE-JS-005 teamwork, SWE-JS-006 solo, SWE-JS-009 teamwork) died on the 180-second HTTP timeout before completing a single turn — both retry attempts aborted at 180 s. These are infrastructure artifacts, not model attempts: a deep-reasoning call from this model can legitimately exceed 180 s (SWE-JS-009's decisive call took 273.8 s). The three tracks were re-run with `--timeout-ms 420000` and spliced into the canonical dataset by [`benchmarks/merge-live-reports.mjs`](../benchmarks/merge-live-reports.mjs), which refuses to replace any track that did not die with a `track-error:` abort reason. The splice log lives in `meta.supplements` of `live-ab-final.json`. All completed tracks ran inside the 180-second budget and are untouched.

### 2.4 Channel Selection & Unified Single Authentic Baseline

This live examination exclusively adopts `mimo-v2.6-flash` on the OpenCode Zen production gateway as the single, authoritative end-to-end benchmark baseline. This channel provides production-grade stability, transparent reasoning/completion token billing, and robust HTTP session handling, guaranteeing that all reported numbers derive directly from live online executions without demo mocks or synthetic projections.

---

## 3. Per-Task Telemetry

All values from `live-ab-final.json`.

| Task | Solo: verdict | turns / tokens / time | Teamwork: verdict | turns / tokens / time | Teamwork abort |
| :--- | :---: | :--- | :---: | :--- | :--- |
| SWE-JS-001 Prototype pollution guard | PASS | 1 / 5.8k / 82.1s | PASS | 1 / 3.8k / 72.2s | — |
| SWE-JS-002 Async queue backpressure | PASS | 4 / 5.4k / 52.6s | PASS | 3 / 8.0k / 93.5s | — |
| SWE-JS-003 Router async error propagation | FAIL | 6 / 10.2k / 45.7s | FAIL | 3 / 6.6k / 247.8s | stagnation-early-stop |
| SWE-JS-004 Circular $ref resolution | PASS | 1 / 2.5k / 33.5s | FAIL | 3 / 4.6k / 25.0s | stagnation-early-stop |
| SWE-JS-005 SemVer pre-release filtering | FAIL | 6 / 31.7k / 190.5s | FAIL | 3 / 20.4k / 267.8s | stagnation-early-stop |
| SWE-JS-006 Cross-platform path separators | PASS | 2 / 9.6k / 138.9s | FAIL | 3 / 12.8k / 326.0s | stagnation-early-stop |
| SWE-JS-007 LRU concurrent eviction | PASS | 1 / 8.3k / 143.7s | FAIL | 3 / 6.6k / 62.0s | stagnation-early-stop |
| SWE-JS-008 AbortSignal two-way teardown | PASS | 1 / 2.3k / 39.0s | PASS | 1 / 2.5k / 23.8s | — |
| SWE-JS-009 qs nested decoder + DoS cap | PASS | 5 / 15.8k / 211.6s | PASS | 2 / 26.8k / 414.8s | — |
| SWE-JS-010 Config deep-freeze immutability | FAIL | 6 / 13.7k / 46.8s | FAIL | 3 / 5.3k / 41.2s | stagnation-early-stop |

Patterns worth naming:

1. **Both arms passed 001, 002, 008, 009; both failed 003, 005, 010.** The contested set is exactly three tasks — 004, 006, 007 — where Solo passed and Teamwork aborted early. That set carries the entire Pass@1 delta.
2. **SWE-JS-003 Solo ended with exit code 13** (unsettled top-level await): the model's sixth-turn rewrite used a top-level `await` on a promise that never settled. A real, rare failure mode, captured because the harness reports true process exit codes.
3. **SWE-JS-006 Solo produced the run's only false victory**: turn 1 claimed completion while the verifier exited 1; the claim was recorded, the loop continued, and turn 2 actually passed. Track B's accounting layer recorded zero such claims.

---

## 4. What the Losing Margin Is Made Of

### 4.1 The reasoning-budget squeeze

`mimo-v2.6-flash` emits `reasoning_content` before `content`, and both draw from the same 16,384-token completion budget. Across the run there is a clean bimodal split in reply length. Payload turns — the ones that carried a complete file and eventually passed tests — returned 3,000–12,000 characters of content. Analysis-only turns returned 200–900 characters with no file block at all: reasoning had consumed the budget and the visible content was a stub.

Track B's system prompt is much larger than Track A's (scoping contract, topology directives, execution discipline, file protocol). On the three contested tasks, the Solo-prompted model produced its full implementation on turn 1 or 2, while the same model under the Teamwork prompt produced three consecutive analysis-only turns and never reached a payload. The correlation in this run: bigger harness context → longer reasoning → thinner content → no write lands.

### 4.2 The early-stop signature conflates "thinking" with "stuck"

`computeGapSignature` hashes the preserved failure tail. When no file is written, the verifier output barely changes between turns, so the signature repeats — and the engine reads repetition as "same fix retried, doomed". On this model, that reading was wrong six times out of six aborts: the model was still deliberating across turns, not retrying a failed fix. The engine forced a replan after the second identical signature and aborted after the third, at turn 3 of a 6-turn budget — precisely the window in which Solo went on to converge on SWE-JS-006 (pass on turn 2) and still had turns in hand on 004 and 007.

The stagnation detector is calibrated for the failure mode it was designed against: a model that *writes* a fix, sees it fail, and writes the same fix again. For a reasoning model whose pre-payload turns look identical from the verifier's seat, the signature needs to distinguish "no write this turn" from "write landed and failed the same way".

### 4.3 Where the harness did pay off

- **Cost containment on shared failures.** On the three tasks both tracks failed (003, 005, 010), Solo burned 55,500 tokens against Teamwork's 32,353 — a 41.7% cut — because the abort at turn 3 stopped the bleed. SWE-JS-010 is the sharpest case: 13.7k → 5.3k tokens, −61%.
- **Prompt-side token economics.** Despite a much larger system prompt, Track B finished with 36,799 prompt tokens against Solo's 59,867. The tail-only failure feed (`formatFailureOutput`) kept the conversation from accumulating full test output, while Solo's full-feedback loop grew its context every turn.
- **Zero false victories under accounting.** Solo's single false victory (SWE-JS-006, turn 1) is exactly the class of error the gap arithmetic exists to catch: a done-claim co-existing with a failing verifier is recorded as a metric, never as a verdict.
- **The SWE-JS-009 flagship win.** Solo ground through 5 turns and 15.8k tokens. Track B converged in 2 turns — its second call spent 273.8 s and 24.4k completion tokens in reasoning, then produced a correct, complete decoder on the first write. When the model does reach a payload under the contract, the adversarial-challenger and micro-test directives correlate with first-write correctness.

### 4.4 Latency

Track B averaged 157.4 s per task against Solo's 98.4 s (+59.9%), and 48.4 s average API latency per call against 29.8 s. Two factors: the larger prompts lengthen reasoning, and Track B's winning deep-reasoning calls (009: 273.8 s; 005 supplement: 258.8 s) sit in its totals. The 180 s default HTTP timeout is too tight for this model's upper tail — §6 proposes the fix that the supplement run already validated.

---

## 5. Scope Conditions (Where These Results Apply)

- One model, one endpoint, one day, ten tasks, temperature 0.2. The contested margin (three tasks) is small; a different model — or one that emits payloads every turn — would stress different mechanisms.
- Both arms stayed inside `allowedPaths` this run, so the path lock intercepted nothing. That is a fact about this model's discipline on these tasks, not evidence about the lock; it simply had no work to do. The lock's behavior is covered deterministically in the offline unit suite (40/40), where adversarial writes are injected on purpose.
- The A/B isolates the scaffolding, not the roles. Track B runs the full engine prompts and gates around a single worker model; it does not spawn the orchestrator/critic/reworker role fan-out that heavier deployments use.
- Solo's 70% Pass@1 with a naive loop sets a genuine bar. A harness has to beat it on this model class, or justify itself on the guardrail axes: false victories, cost containment, boundary enforcement.

---

## 6. Actionable Findings

1. **Split the stagnation signature by write-activity.** "No file landed this turn" and "same file landed, same failure" are different states. The first deserves patience (or a nudge to emit), the second deserves a replan. This single change plausibly recovers the three contested tasks, since the model was 1–2 turns from payload in each.
2. **Give the engine a turn budget no smaller than the baseline's effective budget.** The early-stop exists to save cost, and on this run it did (−41.7% on shared failures) — but aborting at turn 3 of 6 while the baseline converges at turns 4–5 trades a pass for a saving. An abort threshold indexed to observed payload cadence beats a fixed constant.
3. **Raise the default HTTP timeout for reasoning models.** The 180 s default killed three tracks; the 420 s supplement budget completed all three. The CLI now exposes `--timeout-ms`; 420,000 is the safer default for deep-reasoning channels.
4. **Trim the harness prompt under reasoning-budget pressure.** The contract, directives, and protocol cost prompt tokens and, more importantly, reasoning tokens. A condensed variant aimed at reasoning models would relieve exactly the squeeze documented in §4.1.

---

## 7. Reproduction

```bash
npm run benchmark:live -- --check                 # auth precheck + tiny probe
npm run benchmark:live -- --out my-report.json    # full 10-task A/B exam
npm run benchmark:live -- --task SWE-JS-001       # single task
npm run benchmark:live -- --mode teamwork --task SWE-JS-009 --timeout-ms 420000
node benchmarks/merge-live-reports.mjs primary.json supplement.json -o merged.json
```

Level-1 offline gates: `npm test` runs `scripts/build.mjs` (18 shared pure functions AST-identical across `shared/verify-gate.ts`, `shared/verify-gate.js`, and `adapters/zcode/teamwork.dwf.ts`; clean-room compliance scan) plus 40 unit tests, 18 of which exercise the live-eval harness itself with injected transports and scripted clients — zero network by construction. Level-2 is the live exam above; the two levels share the same 10-task ground truth and the same verdict channel (`process.exitCode`).

Raw evidence for this report: [`benchmarks/results/live-ab-final.json`](../benchmarks/results/live-ab-final.json), [`live-ab-full.json`](../benchmarks/results/live-ab-full.json), [`live-ab-full.console.log`](../benchmarks/results/live-ab-full.console.log), and the three `supplement-*.json` files.
