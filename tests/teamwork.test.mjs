import test from "node:test";
import assert from "node:assert/strict";
import {
  formatFailureOutput,
  validateTeamProfile,
  validateIntegrityMode,
  isSubstantiveChallenge,
  calculateTeamworkOpenGaps,
  formatTeamworkConclusion,
} from "../shared/verify-gate.js";

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

test("C7: validates teamProfile and integrityMode", () => {
  assert.equal(validateTeamProfile("hybrid"), "hybrid");
  assert.equal(validateTeamProfile("QUALITY"), "quality");
  assert.equal(validateTeamProfile("economy"), "economy");
  assert.throws(() => validateTeamProfile("super-fast"), /Invalid teamProfile/);

  assert.equal(validateIntegrityMode("development"), "development");
  assert.equal(validateIntegrityMode("DEMO"), "demo");
  assert.equal(validateIntegrityMode("benchmark"), "benchmark");
  assert.throws(() => validateIntegrityMode("relaxed"), /Invalid integrityMode/);
});

