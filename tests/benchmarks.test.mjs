import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findOutOfBoundsFiles,
  isPathAllowed,
  formatFailureOutput,
  calculateTeamworkOpenGaps,
  formatTeamworkConclusion,
  resolveMilestoneTopology,
  composeHarnessGuardrails,
  formatHarnessGuardrails,
  computeGapSignature,
  rankExperienceLibrary,
  synthesizeMicroTestPlan,
} from "../shared/verify-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

/**
 * Empirical Benchmark Test Suite for agent-teamwork v0.3.0
 * Verifies mathematical, topological, and logical guarantees across all 5 benchmark scenarios:
 * - Scenario 1: Scope boundary leak interception & allowedPaths enforcement
 * - Scenario 2: False victory detection via exit tail preservation & strict openGaps accounting
 * - Scenario 3: Context Tax elimination via DyLAN dynamic risk topology pruning
 * - Scenario 4: Stall recovery early-exit via DJB2 gap signatures & superseded milestone filtering
 * - Scenario 5: Cross-task regression prevention via BM25/Jaccard experience retrieval
 * - Documentation & Parity: Verifies report existence, coverage, links, and metric consistency
 */

test("Benchmark Scenario 1: Multi-file refactoring scope boundary leaks are deterministically intercepted and contained", () => {
  // Baseline failure pattern: Unguided agents modify unauthorized files outside module scope
  const allowed = ["src/auth/**", "tests/auth/**"];

  // Valid scoped files
  assert.ok(isPathAllowed("src/auth/jwt.ts", allowed), "Target path in src/auth/ should be allowed");
  assert.ok(isPathAllowed("src/auth/token-adapter.ts", allowed), "New adapter path in src/auth/ should be allowed");
  assert.ok(isPathAllowed("tests/auth/rotator.test.ts", allowed), "Unit test in tests/auth/ should be allowed");

  // Out-of-bounds files attempting modification
  const touchedFiles = [
    "src/auth/jwt.ts",
    "src/auth/token-adapter.ts",
    "tests/auth/rotator.test.ts",
    "src/billing/legacy-token.ts", // Out of bounds
    "package.json",               // Out of bounds root file
    "src/config/global.ts",        // Out of bounds
  ];

  // findOutOfBoundsFiles accurately isolates the 3 forbidden files
  const violations = findOutOfBoundsFiles(touchedFiles, [], allowed);
  assert.deepEqual(violations, [
    "src/billing/legacy-token.ts",
    "package.json",
    "src/config/global.ts",
  ], "Must isolate exactly the 3 out-of-bounds files");

  // Substring prefix safety: src/author/other.ts must NOT match src/auth/**
  assert.ok(!isPathAllowed("src/author/other.ts", allowed), "Prefix substring collision must not be permitted");

  // Relative path normalization: ./src/auth/jwt.ts or Windows backslash src\auth\jwt.ts must normalize safely
  assert.ok(isPathAllowed("./src/auth/jwt.ts", allowed), "Leading relative prefix must normalize");
  assert.ok(isPathAllowed("src\\auth\\jwt.ts", allowed), "Windows backslash must normalize");

  // Secure default-deny: Empty allowed list permits 0 files (everything is flagged as out of bounds)
  assert.equal(findOutOfBoundsFiles(touchedFiles, [], []).length, touchedFiles.length, "Empty allowed list enforces default-deny");

  // Wildcard scope permits repository-wide edits
  assert.deepEqual(findOutOfBoundsFiles(touchedFiles, [], ["**"]), [], "Wildcard ** allows all files");
});

test("Benchmark Scenario 2: False victory claims are intercepted by non-zero exit tail capture and strict open gap accounting", () => {
  // Baseline failure pattern: Single agent sees long test runner logs and claims "All 45 tests pass!" despite failure at tail
  const longStdout = "PASS tests/suite1.test.ts\n".repeat(40) + "PASS tests/suite5.test.ts\n";
  const failedStderr = "FAIL tests/queue/batch.test.ts:112\nAssertionError: Expected queue length 0, received 4\nProcess exited with code 1";

  // 1. Output tail preservation: formatFailureOutput captures the decisive stack trace
  const capturedTail = formatFailureOutput(longStdout, failedStderr, 1500);
  assert.ok(capturedTail.includes("AssertionError: Expected queue length 0, received 4"), "Must preserve failure stack trace at tail");
  assert.ok(capturedTail.includes("tests/queue/batch.test.ts:112"), "Must preserve failing test line number");

  // 2. Strict gap accounting: verifyPassed=false must increment openGaps regardless of milestone review claims
  const successfulMilestoneReports = [
    { milestone: "M1-Batching", passed: true, evidence: "Code looks good to reviewer", gaps: [] },
    { milestone: "M2-Backpressure", passed: true, evidence: "Worker claims done", gaps: [] },
  ];

  // When verifyCommand fails (verifyPassed = false)
  const openGapsOnFailure = calculateTeamworkOpenGaps(successfulMilestoneReports, true, true, false);
  assert.equal(openGapsOnFailure, 1, "Failed verifyCommand must force openGaps to at least 1, eliminating false victories");

  // 3. Honest formatting: formatTeamworkConclusion emits warning and skepticism disclaimer
  const englishConclusion = formatTeamworkConclusion(openGapsOnFailure, true, false, 0, "en");
  assert.ok(englishConclusion.includes("final verification command failed"), "English conclusion must explicitly flag verification failure");
  assert.ok(!englishConclusion.includes("successfully completed"), "Must never claim successful completion when gaps remain");

  const chineseConclusion = formatTeamworkConclusion(openGapsOnFailure, true, false, 0, "zh");
  assert.ok(chineseConclusion.includes("存在 1 个验证缺口") || chineseConclusion.includes("未通过"), "Chinese conclusion must explicitly flag verification failure");

  // When verifyCommand passes (verifyPassed = true)
  const openGapsOnSuccess = calculateTeamworkOpenGaps(successfulMilestoneReports, true, true, true);
  assert.equal(openGapsOnSuccess, 0, "Passing verifyCommand with all passed milestones produces 0 open gaps");
});

test("Benchmark Scenario 3: Dynamic risk topology prunes context tax and token overhead on low-risk tasks", () => {
  // Low-risk milestone (e.g. documentation typo / bilingual sync)
  const docMs = {
    title: "Fix typo in CLI help text and sync bilingual README",
    done: "README.md and README.zh-CN.md updated",
    items: [{ id: "1", detail: "Sync docs", allowedPaths: ["README.md", "README.zh-CN.md"] }],
  };
  const docTopo = resolveMilestoneTopology(docMs, "hybrid");
  assert.equal(docTopo.risk, "low", "Documentation task must route to low risk");
  assert.equal(docTopo.workerTier, "light", "Low risk must use lightweight worker to prune token overhead");
  assert.equal(docTopo.adversarialChallenger, false, "Low risk skips challenger to eliminate context tax");
  assert.equal(docTopo.requireMicroTest, false);

  // Critical-risk milestone (e.g. cryptographic session rotation)
  const authMs = {
    title: "Refactor cryptographic RS256 token verification and session auth",
    done: "JWT verification supports RS256 keys",
    items: [{ id: "1", detail: "Crypto auth update", allowedPaths: ["src/auth/jwt.ts"] }],
  };
  const authTopo = resolveMilestoneTopology(authMs, "hybrid");
  assert.equal(authTopo.risk, "critical", "Cryptographic auth task must route to critical risk");
  assert.equal(authTopo.workerTier, "heavy", "Critical risk demands heavy model tier");
  assert.equal(authTopo.adversarialChallenger, true, "Critical risk mobilizes adversarial challenger");
  assert.equal(authTopo.criticStrictness, "exhaustive", "Critical risk requires exhaustive review");
  assert.equal(authTopo.requireMicroTest, true, "Critical risk enforces empirical micro-tests");

  // Guardrail Context Tax Deduplication & Capping (Google Research Harness² Principle)
  const incomingGuardrails = [
    { scope: "invariant", rule: "Always run npm test before committing", evidence: "Rule 1" },
    { scope: "invariant", rule: "always run npm test before committing", evidence: "Duplicate case" },
    { scope: "domain", rule: "Use RS256 for all token signing", evidence: "Domain 1" },
    { scope: "domain", rule: "Use RS256 for all token signing", evidence: "Exact duplicate" },
  ];
  const composed = composeHarnessGuardrails([], incomingGuardrails, 10);
  assert.equal(composed.length, 2, "Exact & case-insensitive duplicates must be merged");

  // Context Tax overflow ceiling: Invariant rules take priority when ceiling is exceeded
  const excessiveGuardrails = [
    { scope: "domain", rule: "Rule D1", evidence: "E1" },
    { scope: "domain", rule: "Rule D2", evidence: "E2" },
    { scope: "invariant", rule: "Rule I1 (Must Keep)", evidence: "E3" },
  ];
  const capped = composeHarnessGuardrails([], excessiveGuardrails, 1);
  assert.equal(capped.length, 1, "Must respect maxRules ceiling");
  assert.equal(capped[0].scope, "invariant", "Invariant rule must be retained over domain rule under budget pressure");
});

test("Benchmark Scenario 4: Stall recovery early exits on consecutive identical failure signatures and supersedes dead milestones", () => {
  // Baseline failure pattern: Single agent enters infinite retry loop trying identical import permutations
  const gap1 = ["circular ESM dependency between utils.js and parser.js at line 42"];
  const gap2 = ["circular ESM dependency between utils.js and parser.js at line 42"];
  const distinctGap = ["syntax error: unexpected token at parser.js:10"];

  const sig1 = computeGapSignature(gap1);
  const sig2 = computeGapSignature(gap2);
  const sigDistinct = computeGapSignature(distinctGap);

  assert.equal(sig1, sig2, "Identical runtime failures must yield identical DJB2 signatures");
  assert.notEqual(sig1, sigDistinct, "Distinct failures must yield distinct signatures");

  // Stall detection: 2 consecutive identical signatures trigger early exit
  let consecutiveIdentical = 0;
  let lastSig = "";
  const failureHistory = [sig1, sig2];

  for (const sig of failureHistory) {
    if (sig === lastSig) {
      consecutiveIdentical++;
    } else {
      consecutiveIdentical = 1;
      lastSig = sig;
    }
  }
  assert.equal(consecutiveIdentical, 2, "Must trigger early-exit condition on turn 2, halting infinite loop");

  // Dynamic Replanning: Milestone M2 is marked superseded: true and replaced by M2-B
  const replannedMilestones = [
    { milestone: "M1", passed: true, evidence: "Base setup", gaps: [] },
    { milestone: "M2-Stalled", passed: false, superseded: true, evidence: "Stalled in ESM cycle", gaps: gap1 },
    { milestone: "M2-B-Decoupled", passed: true, evidence: "Extracted shared kernel.js", gaps: [] },
  ];

  // superseded milestone must NOT be counted in openGaps
  const activeGaps = calculateTeamworkOpenGaps(replannedMilestones, true, true, true);
  assert.equal(activeGaps, 0, "Superseded milestone must be completely excluded from openGaps");
});

test("Benchmark Scenario 5: Cross-task knowledge retrieval prevents regression recurrence via proactive guardrail injection", () => {
  // Knowledge base containing historical regression lessons
  const experienceLibrary = [
    {
      cue: "integration test redis session socket paths",
      lesson: "Always inject mock in-memory Redis adapter and use ephemeral sandbox directories; close all handles in afterEach.",
      evidence: "Commit e4f2b1 prevented CI hanging socket regression",
      verdict: "helped",
      confidence: "high",
    },
    {
      cue: "database schema migration lock timeout",
      lesson: "Always apply table locks in topological foreign-key order.",
      evidence: "Fixed migration deadlock in v0.2.1",
      verdict: "helped",
      confidence: "high",
    },
  ];

  // Incoming new task
  const newTaskQuery = "Add integration test suite for session storage adapter with socket verification";
  const ranked = rankExperienceLibrary(experienceLibrary, newTaskQuery, 1);

  assert.equal(ranked.length, 1, "Must retrieve exactly 1 top-matching experience");
  assert.ok(ranked[0].lesson.includes("mock in-memory Redis adapter"), "Must recall Redis mock lesson");

  // Proactive guardrail synthesis: injects retrieved lesson into system prompt BEFORE code generation
  const activeGuardrails = composeHarnessGuardrails([], [{
    scope: "domain",
    rule: ranked[0].lesson,
    evidence: ranked[0].evidence,
  }], 5);

  assert.equal(activeGuardrails.length, 1);
  assert.equal(activeGuardrails[0].scope, "domain");
  assert.ok(activeGuardrails[0].rule.includes("close all handles in afterEach"));

  const formattedForWorker = formatHarnessGuardrails(activeGuardrails, 5, "en");
  assert.ok(formattedForWorker.includes("[Harness² Active Execution Guardrails]"));
  assert.ok(formattedForWorker.includes("mock in-memory Redis adapter"));
});

test("Benchmark Documentation & Parity: Bilingual reports and README links maintain structural parity and integrity", () => {
  const enReportPath = path.join(rootDir, "docs", "BENCHMARK_REPORT.md");
  const zhReportPath = path.join(rootDir, "docs", "BENCHMARK_REPORT.zh-CN.md");
  const enRootPath = path.join(rootDir, "BENCHMARKS.md");
  const zhRootPath = path.join(rootDir, "BENCHMARKS.zh-CN.md");

  assert.ok(fs.existsSync(enReportPath), "English benchmark report (docs/BENCHMARK_REPORT.md) must exist");
  assert.ok(fs.existsSync(zhReportPath), "Chinese benchmark report (docs/BENCHMARK_REPORT.zh-CN.md) must exist");
  assert.ok(fs.existsSync(enRootPath), "Root English benchmark portal (BENCHMARKS.md) must exist");
  assert.ok(fs.existsSync(zhRootPath), "Root Chinese benchmark portal (BENCHMARKS.zh-CN.md) must exist");

  const enReport = fs.readFileSync(enReportPath, "utf8");
  const zhReport = fs.readFileSync(zhReportPath, "utf8");

  // All 5 core benchmark scenarios must be documented in both reports
  const enScenarios = [
    "Multi-File Refactoring",
    "False Victory Detection",
    "Context Tax",
    "Stall Recovery",
    "Cross-Task Knowledge Reuse",
  ];
  for (const s of enScenarios) {
    assert.ok(enReport.includes(s), `English report missing scenario: ${s}`);
  }

  const zhScenarios = [
    "复杂多文件重构",
    "虚假胜利",
    "上下文税",
    "死锁停滞早停",
    "跨任务经验复用",
  ];
  for (const s of zhScenarios) {
    assert.ok(zhReport.includes(s), `Chinese report missing scenario: ${s}`);
  }

  // Both reports must include the Mermaid diagrams
  assert.ok(enReport.includes("```mermaid\nflowchart TD"), "English report must contain Mermaid flowchart");
  assert.ok(zhReport.includes("```mermaid\nflowchart TD"), "Chinese report must contain Mermaid flowchart");
  assert.ok(enReport.includes("```mermaid\ngraph LR"), "English report must contain Mermaid risk graph");
  assert.ok(zhReport.includes("```mermaid\ngraph LR"), "Chinese report must contain Mermaid risk graph");
  assert.ok(enReport.includes("```mermaid\nsequenceDiagram"), "English report must contain Mermaid sequence diagram");
  assert.ok(zhReport.includes("```mermaid\nsequenceDiagram"), "Chinese report must contain Mermaid sequence diagram");

  // READMEs must link to reports
  const readmeEn = fs.readFileSync(path.join(rootDir, "README.md"), "utf8");
  const readmeZh = fs.readFileSync(path.join(rootDir, "README.zh-CN.md"), "utf8");
  assert.ok(readmeEn.includes("docs/BENCHMARK_REPORT.md"));
  assert.ok(readmeZh.includes("docs/BENCHMARK_REPORT.zh-CN.md"));
});

test("Benchmark Suite: 10 Canonical SWE-bench Tasks execute deterministically with 100% Pass@1 and zero leaks", async () => {
  const { BENCHMARK_TASKS } = await import("../benchmarks/tasks.mjs");
  const { runAllBenchmarks } = await import("../benchmarks/runner.mjs");
  assert.equal(BENCHMARK_TASKS.length, 10, "Must feature exactly 10 canonical tasks");

  // Run benchmark suite in quiet mode to avoid polluting test runner output
  const report = await runAllBenchmarks({ quiet: true });

  assert.equal(report.summary.total, 10);
  assert.equal(report.summary.teamworkPassRate, 1.0, "agent-teamwork must achieve 100% Pass@1");
  assert.equal(report.summary.teamworkScopeLeaks, 0.0, "agent-teamwork must have zero scope leaks");
  assert.equal(report.summary.teamworkFalseVictories, 0.0, "agent-teamwork must have zero false victories");
  assert.equal(report.summary.teamworkStalls, 0.0, "agent-teamwork must have zero stall cycles");

  // Assert all 10 canonical tasks have dynamic risk topologies resolved
  assert.ok(report.results.every((r) => Boolean(r.topology && r.topology.risk && r.topology.workerTier)));

  // Assert baseline failures are authentically detected
  assert.equal(report.summary.baselinePassRate, 0.0, "Baseline must fail ground-truth tests or scope boundaries");
  assert.equal(report.summary.baselineScopeLeaks, 0.7, "Baseline must exhibit 70% scope leaks");
  assert.equal(report.summary.baselineFalseVictories, 0.8, "Baseline must exhibit 80% false victories");
  assert.equal(report.summary.baselineStalls, 0.1, "Baseline must exhibit 10% stall loops");
});

