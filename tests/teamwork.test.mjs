import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  formatFailureOutput,
  computeFailureSignature,
  computeGapSignature,
  normalizeRelPath,
  isPathAllowed,
  findOutOfBoundsFiles,
  isValidExperienceEntry,
  formatHarnessGuardrails,
  validateTeamProfile,
  validateIntegrityMode,
  isSubstantiveChallenge,
  calculateTeamworkOpenGaps,
  formatTeamworkConclusion,
  resolveModelConfiguration,
} from "../shared/verify-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

test("C3: formatFailureOutput preserves error tail for teamwork verification", () => {
  const stdout = "Compiling 400 modules...\n" + "line\n".repeat(100);
  const stderr = "FAIL: test_milestone_acceptance() -> Assertion error at line 99\nExited with 1";
  const output = formatFailureOutput(stdout, stderr, 400);

  assert.ok(output.length <= 400);
  assert.ok(output.includes("FAIL: test_milestone_acceptance()"));
  assert.ok(!output.includes("Compiling 400 modules"));
});

test("C1: verifyCommand failure accurately updates openGaps and prevents false success conclusion", () => {
  const milestoneOutcomes = [
    { milestone: "M1", passed: true, evidence: "ok", gaps: [], reworkRounds: 0 },
    { milestone: "M2", passed: true, evidence: "ok", gaps: [], reworkRounds: 1 },
  ];
  const auditPassed = true;
  const verifyCommandRan = true;
  const verifyPassed = false; // verifyCommand failed!

  const openGaps = calculateTeamworkOpenGaps(
    milestoneOutcomes,
    auditPassed,
    verifyCommandRan,
    verifyPassed,
  );

  assert.equal(openGaps, 1, "Failed verifyCommand must be counted in openGaps");

  const zhConclusion = formatTeamworkConclusion(openGaps, verifyCommandRan, verifyPassed, 0, "zh");
  assert.ok(!zhConclusion.includes("终局验收命令通过"), "Must not claim command passed when it failed");
  assert.ok(zhConclusion.includes("终局验收命令未通过"));

  const enConclusion = formatTeamworkConclusion(openGaps, verifyCommandRan, verifyPassed, 0, "en");
  assert.ok(!enConclusion.includes("final verification command passed"));
  assert.ok(enConclusion.includes("final verification command failed"));
});

test("C1: formatTeamworkConclusion outputs clean English and Chinese success messages", () => {
  const enConclusion = formatTeamworkConclusion(0, true, true, 1, "en");
  assert.ok(enConclusion.includes("final verification command passed"));
  assert.ok(!/[\u4e00-\u9fff]/.test(enConclusion), "English conclusion must not contain Chinese text");

  const zhConclusion = formatTeamworkConclusion(0, true, true, 1, "zh");
  assert.ok(zhConclusion.includes("终局验收命令通过"));
  assert.ok(zhConclusion.includes("整体重规划 1 次"));
});

test("C2: superseded failed milestones are not counted as openGaps after replanning", () => {
  const milestoneOutcomes = [
    { milestone: "M1-Old", passed: false, superseded: true, evidence: "stalled", gaps: ["gap 1"], reworkRounds: 3 },
    { milestone: "M1-New", passed: true, evidence: "passed after replan", gaps: [], reworkRounds: 0 },
    { milestone: "M2", passed: true, evidence: "passed", gaps: [], reworkRounds: 0 },
  ];

  const openGaps = calculateTeamworkOpenGaps(milestoneOutcomes, true, false, false);
  assert.equal(openGaps, 0, "Superseded milestone must not count as active failure");

  const conclusion = formatTeamworkConclusion(openGaps, false, false, 1, "zh");
  assert.ok(conclusion.includes("已完成"));
  assert.ok(conclusion.includes("整体重规划 1 次"));
});

test("C4: structured challenger verdict filters out empty suspicions", () => {
  const cleanChallenge = { foundIssue: false, evidence: "找不到未完成的实证，全部用例均已通过。" };
  const emptyChallenge = { foundIssue: true, evidence: "" };
  const realIssueChallenge = { foundIssue: true, evidence: "发现并发写入时存在死锁风险（L140）" };

  assert.equal(isSubstantiveChallenge(cleanChallenge), false);
  assert.equal(isSubstantiveChallenge(emptyChallenge), false);
  assert.equal(isSubstantiveChallenge(realIssueChallenge), true);
  assert.equal(isSubstantiveChallenge(null), false);
  assert.equal(isSubstantiveChallenge(undefined), false);
});

test("C6: isPathAllowed and findOutOfBoundsFiles enforce strict path boundaries without reverse substring leaks", () => {
  assert.equal(normalizeRelPath("./src/utils/"), "src/utils");

  const allowed = ["src/app", "shared/verify-gate.ts", "tests/*.test.mjs"];
  assert.equal(isPathAllowed("src/app/index.ts", allowed), true);
  assert.equal(isPathAllowed("./src/app/sub/helper.ts", allowed), true);
  assert.equal(isPathAllowed("shared/verify-gate.ts", allowed), true);
  assert.equal(isPathAllowed("tests/teamwork.test.mjs", allowed), true);

  // Must reject sibling prefix ("src/app-other") and parent substring ("src" or "verify-gate.ts")
  assert.equal(isPathAllowed("src/app-other/index.ts", allowed), false);
  assert.equal(isPathAllowed("src", allowed), false);
  assert.equal(isPathAllowed("verify-gate.ts", allowed), false);

  // Incremental out-of-bounds calculation ignores pre-existing dirty files from earlier milestones
  const baseline = ["README.md", "src/legacy/old.ts"];
  const current = ["README.md", "src/legacy/old.ts", "src/app/new.ts", "src/unauthorized/hack.ts"];
  const outOfBounds = findOutOfBoundsFiles(current, baseline, allowed);
  assert.deepEqual(outOfBounds, ["src/unauthorized/hack.ts"]);
});

test("C7: validates teamProfile, integrityMode, and stall signatures", () => {
  assert.equal(validateTeamProfile("hybrid"), "hybrid");
  assert.equal(validateTeamProfile("QUALITY"), "quality");
  assert.equal(validateTeamProfile("economy"), "economy");
  assert.throws(() => validateTeamProfile("super-fast"), /Invalid teamProfile/);

  assert.equal(validateIntegrityMode("development"), "development");
  assert.equal(validateIntegrityMode("DEMO"), "demo");
  assert.equal(validateIntegrityMode("benchmark"), "benchmark");
  assert.throws(() => validateIntegrityMode("relaxed"), /Invalid integrityMode/);

  const sig1 = computeFailureSignature("2026-10-24T00:00:01Z Error at /Users/dev/app.ts:42:10 took 120ms");
  const sig2 = computeFailureSignature("2026-10-24T00:05:59Z Error at /Users/dev/app.ts:99:4 took 350ms");
  assert.equal(sig1, sig2, "Volatile timestamps, line numbers, and durations must normalize to identical signature");

  const gapSig1 = computeGapSignature(["Missing test in /Users/a/b/foo.ts line 12", "API mismatch"]);
  const gapSig2 = computeGapSignature(["API mismatch", "Missing test in /home/ci/work/foo.ts line 88"]);
  assert.equal(gapSig1, gapSig2, "Gap signatures must sort and normalize paths/numbers");
});

test("Harness²: validates non-confounded experience entries and formats invariant/domain guardrails", () => {
  const validExp = {
    cue: "When parallel workers update shared barrel exports",
    lesson: "Assign barrel index.ts to a dedicated final item or single owner in allowedPaths",
    evidence: "Milestone 1 avoided merge conflict after isolating index.ts",
    verdict: "helped",
    confidence: "high",
  };
  const confoundedExp = {
    cue: "When tests fail",
    lesson: "Change everything at once",
    evidence: "Unclear which edit worked",
    verdict: "confounded",
    confidence: "medium",
  };
  const lowConfExp = {
    cue: "When linting",
    lesson: "Run linter",
    evidence: "Single run",
    verdict: "helped",
    confidence: "low",
  };

  assert.equal(isValidExperienceEntry(validExp), true);
  assert.equal(isValidExperienceEntry(confoundedExp), false, "Confounded attribution must be rejected");
  assert.equal(isValidExperienceEntry(lowConfExp), false, "Low confidence entry must be rejected");
  assert.equal(isValidExperienceEntry({ cue: "NO_ENTRY", lesson: "x", evidence: "y" }), false);

  const guardrails = [
    { scope: "invariant", rule: "Never modify files outside allowedPaths", evidence: "M1" },
    { scope: "domain", rule: "Use node --test instead of jest in this repo", evidence: "package.json" },
  ];
  const zhBlock = formatHarnessGuardrails(guardrails, 6, "zh");
  assert.ok(zhBlock.includes("通用纪律 (Invariant)"));
  assert.ok(zhBlock.includes("领域护栏 (Domain)"));

  const enBlock = formatHarnessGuardrails(guardrails, 6, "en");
  assert.ok(enBlock.includes("Invariant Rules:"));
  assert.ok(enBlock.includes("Domain Rules:"));
});

test("B11: resolveModelConfiguration resolves custom and default light models", () => {
  const localCfg = JSON.parse(fs.readFileSync(path.join(rootDir, "models.example.json"), "utf8"));
  const resDefault = resolveModelConfiguration("", localCfg);
  assert.equal(resDefault.modelId, "deepseek-chat");
  assert.equal(resDefault.tier, "light");

  const resNamed = resolveModelConfiguration("claude-3-5-haiku", localCfg);
  assert.equal(resNamed.modelId, "claude-3-5-haiku-20241022");

  const resHeavy = resolveModelConfiguration("deepseek-reasoner", localCfg);
  assert.equal(resHeavy.modelId, "deepseek-reasoner");
  assert.equal(resHeavy.tier, "heavy");

  const resFallback = resolveModelConfiguration("", null);
  assert.equal(resFallback.modelId, null);
  assert.equal(resFallback.tier, "default");
});

test("Installer & Build verification smoke test across all supported agent targets and languages", () => {
  const targets = ["zcode", "claude", "codex", "deepseek", "opencode", "workbuddy", "generic"];
  for (const t of targets) {
    for (const lang of ["en", "zh"]) {
      const dryRunOut = execFileSync(
        "bash",
        [path.join(rootDir, "install.sh"), "--target", t, "--lang", lang, "--dry-run"],
        { encoding: "utf8" },
      );
      assert.ok(dryRunOut.includes(`[Dry-Run] Target: ${t} (${lang})`));
      assert.ok(dryRunOut.includes(`roles/*.${lang}.md`));
    }
  }

  const buildOut = execFileSync(process.execPath, [path.join(rootDir, "scripts", "build.mjs")], {
    encoding: "utf8",
  });
  assert.ok(buildOut.includes("Build verification successful!"));
});
