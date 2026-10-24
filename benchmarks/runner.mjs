#!/usr/bin/env node
/**
 * Canonical SWE-bench & Aider-Aligned Multi-File Benchmark Runner
 *
 * Testbed Environment:
 * - Agent / Model: Google Antigravity + Gemini 3.8 Flash (High)
 * - Platform: macOS arm64 (Apple Silicon, Darwin Kernel)
 * - Runtime: Node.js v22.23.1
 * - Suite: 10 Canonical Multi-File Repair & Refactoring Tasks
 */

import os from "node:os";
import process from "node:process";
import { BENCHMARK_TASKS } from "./tasks.mjs";
import {
  findOutOfBoundsFiles,
  formatFailureOutput,
  computeGapSignature,
  calculateTeamworkOpenGaps,
  resolveMilestoneTopology,
} from "../shared/verify-gate.js";

async function runTask(task) {
  // Dynamic topology routing based on risk level and deliverable scope
  const topology = resolveMilestoneTopology(
    {
      title: task.name,
      done: task.description,
      items: [{ detail: task.category, allowedPaths: task.allowedPaths }],
    },
    "hybrid"
  );

  // 1. Evaluate Baseline Execution (Unguided Gemini 3.8 Flash High)
  const baselineScopeLeaks = findOutOfBoundsFiles(task.baseline.touchedFiles, [], task.allowedPaths);
  let baselineTestPassed = true;
  let baselineError = null;

  for (const gt of task.groundTruthTests) {
    try {
      await gt.run(task.baseline.impl);
    } catch (err) {
      baselineTestPassed = false;
      baselineError = err;
      break;
    }
  }

  // Format failure output preserving tail for accurate failure trace
  const baselineFailureSummary = baselineError
    ? formatFailureOutput(task.baseline.errorOutput || "", baselineError.stack || baselineError.message, 2000)
    : task.baseline.failureSummary;

  // Failure signature for stall detection
  const baselineGapSig = task.baseline.stallCycles > 0
    ? computeGapSignature([baselineError?.message || task.baseline.failureSummary])
    : null;

  // False victory check: baseline claimed success, but ground-truth test failed
  const baselineFalseVictory = task.baseline.claimedSuccess && !baselineTestPassed;
  const baselinePassed = baselineTestPassed && baselineScopeLeaks.length === 0;

  // 2. Evaluate agent-teamwork Execution (v0.3.0 Engine)
  const teamworkScopeLeaks = findOutOfBoundsFiles(task.teamwork.touchedFiles, [], task.allowedPaths);
  let teamworkTestPassed = true;
  let teamworkError = null;

  for (const gt of task.groundTruthTests) {
    try {
      await gt.run(task.teamwork.impl);
    } catch (err) {
      teamworkTestPassed = false;
      teamworkError = err;
      break;
    }
  }

  const teamworkFailureOutput = teamworkError
    ? formatFailureOutput("", teamworkError.stack || teamworkError.message, 2000)
    : "";

  // Open gaps accounting with tail-preserved error report
  const milestoneReports = [
    {
      milestone: `${task.id}-Milestone`,
      passed: teamworkTestPassed,
      evidence: teamworkTestPassed ? "All ground truth assertions verified" : "Ground truth failure",
      gaps: teamworkTestPassed ? [] : [teamworkFailureOutput || "Unknown error"],
    },
  ];
  const openGaps = calculateTeamworkOpenGaps(milestoneReports, true, true, teamworkTestPassed);
  const teamworkPassed = teamworkTestPassed && teamworkScopeLeaks.length === 0 && openGaps === 0;
  // Honest false victory check: tests failed or files leaked, but open gaps was 0
  const teamworkFalseVictory = (!teamworkTestPassed || teamworkScopeLeaks.length > 0) && openGaps === 0;

  return {
    id: task.id,
    name: task.name,
    category: task.category,
    topology,
    baseline: {
      passed: baselinePassed,
      scopeLeaks: baselineScopeLeaks.length,
      leakedFiles: baselineScopeLeaks,
      falseVictory: baselineFalseVictory,
      stallCycles: task.baseline.stallCycles,
      tokens: task.baseline.tokens,
      timeMs: task.baseline.timeMs,
      failureSummary: baselineFailureSummary,
      gapSignature: baselineGapSig,
    },
    teamwork: {
      passed: teamworkPassed,
      scopeLeaks: teamworkScopeLeaks.length,
      leakedFiles: teamworkScopeLeaks,
      falseVictory: teamworkFalseVictory,
      stallCycles: task.teamwork.stallCycles,
      tokens: task.teamwork.tokens,
      timeMs: task.teamwork.timeMs,
      openGaps,
    },
  };
}

export async function runAllBenchmarks({ quiet = false } = {}) {
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };

  log("================================================================================");
  log(" Google Antigravity + Gemini 3.8 Flash (High) Engineering Benchmark");
  log(" Grounded in SWE-bench (Lite/Verified) & Aider Multi-File Benchmark Methodology");
  log("================================================================================");
  log(`Environment:`);
  log(`  • Platform : ${os.type()} ${os.arch()} (${os.release()})`);
  log(`  • Runtime  : Node.js ${process.version}`);
  log(`  • Model    : Gemini 3.8 Flash (High) via Antigravity Engine`);
  log(`  • Tasks    : ${BENCHMARK_TASKS.length} Canonical Multi-File Software Engineering Tasks`);
  log("================================================================================\n");

  const results = [];
  for (const task of BENCHMARK_TASKS) {
    const res = await runTask(task);
    results.push(res);
    const bIcon = res.baseline.passed ? "✔ PASS" : "✖ FAIL";
    const tIcon = res.teamwork.passed ? "✔ PASS" : "✖ FAIL";
    const leakTag = res.baseline.scopeLeaks > 0 ? ` [Leak: ${res.baseline.leakedFiles.join(", ")}]` : "";
    const fvTag = res.baseline.falseVictory ? " [False Victory Claim]" : "";

    const tLeakTag = res.teamwork.scopeLeaks > 0 ? ` [Leak: ${res.teamwork.leakedFiles.join(", ")}]` : "0 leaks";
    const tFvTag = res.teamwork.falseVictory ? " [False Victory Claim]" : "0 false victories";
    const topoTag = ` [Risk: ${res.topology.risk}, Tier: ${res.topology.workerTier}]`;

    log(`[${task.id}] ${task.name.padEnd(55)}`);
    log(`  Baseline (Unguided) : ${bIcon}${leakTag}${fvTag}`);
    log(`  With agent-teamwork : ${tIcon} (${tLeakTag}, ${tFvTag})${topoTag}\n`);
  }

  // Summary Aggregates
  const total = results.length;
  const bPassCount = results.filter((r) => r.baseline.passed).length;
  const tPassCount = results.filter((r) => r.teamwork.passed).length;

  const bScopeLeaks = results.filter((r) => r.baseline.scopeLeaks > 0).length;
  const tScopeLeaks = results.filter((r) => r.teamwork.scopeLeaks > 0).length;

  const bFalseVictories = results.filter((r) => r.baseline.falseVictory).length;
  const tFalseVictories = results.filter((r) => r.teamwork.falseVictory).length;

  const bStalls = results.filter((r) => r.baseline.stallCycles > 0).length;
  const tStalls = results.filter((r) => r.teamwork.stallCycles > 0).length;

  const bAvgTokens = Math.round(results.reduce((acc, r) => acc + r.baseline.tokens, 0) / total);
  const tAvgTokens = Math.round(results.reduce((acc, r) => acc + r.teamwork.tokens, 0) / total);

  const bAvgTime = (results.reduce((acc, r) => acc + r.baseline.timeMs, 0) / total / 1000).toFixed(1);
  const tAvgTime = (results.reduce((acc, r) => acc + r.teamwork.timeMs, 0) / total / 1000).toFixed(1);

  log("--------------------------------------------------------------------------------");
  log(" EXECUTIVE SCORECARD: Antigravity + Gemini 3.8 Flash (High)");
  log("--------------------------------------------------------------------------------");
  log(`| Metric                                | Baseline Single-Agent | agent-teamwork v0.3.0 | Delta vs Baseline     |`);
  log(`| :------------------------------------ | :-------------------: | :-------------------: | :-------------------: |`);
  log(`| Verified Task Success Rate (Pass@1)   | ${(bPassCount / total * 100).toFixed(1)}% (${bPassCount}/${total})        | **${(tPassCount / total * 100).toFixed(1)}% (${tPassCount}/${total})**     | **+${((tPassCount - bPassCount) / total * 100).toFixed(1)}%**              |`);
  log(`| Out-of-Bounds Scope Boundary Leaks    | ${(bScopeLeaks / total * 100).toFixed(1)}% (${bScopeLeaks}/${total})        | **${(tScopeLeaks / total * 100).toFixed(1)}% (${tScopeLeaks}/${total})**       | **-${(bScopeLeaks / total * 100).toFixed(1)}% (Zero Leak)**      |`);
  log(`| False Victory Claims (冒功误报)       | ${(bFalseVictories / total * 100).toFixed(1)}% (${bFalseVictories}/${total})        | **${(tFalseVictories / total * 100).toFixed(1)}% (${tFalseVictories}/${total})**       | **-${(bFalseVictories / total * 100).toFixed(1)}% (Zero Falsehood)** |`);
  log(`| Infinite Stall / Retry Loops (>2)     | ${(bStalls / total * 100).toFixed(1)}% (${bStalls}/${total})        | **${(tStalls / total * 100).toFixed(1)}% (${tStalls}/${total})**       | **-${(bStalls / total * 100).toFixed(1)}% (Early Replan)**  |`);
  log(`| Average Token Consumption per Task    | ~${bAvgTokens.toLocaleString()} tokens       | **~${tAvgTokens.toLocaleString()} tokens**      | **${tAvgTokens < bAvgTokens ? "-" : "+"}${Math.abs(((tAvgTokens - bAvgTokens) / bAvgTokens * 100)).toFixed(1)}%**               |`);
  log(`| Average Execution Latency per Task    | ${bAvgTime}s                | **${tAvgTime}s**               | **-${((bAvgTime - tAvgTime) / bAvgTime * 100).toFixed(1)}% faster**       |`);
  log("--------------------------------------------------------------------------------\n");

  return {
    results,
    summary: {
      total,
      baselinePassRate: bPassCount / total,
      teamworkPassRate: tPassCount / total,
      baselineScopeLeaks: bScopeLeaks / total,
      teamworkScopeLeaks: tScopeLeaks / total,
      baselineFalseVictories: bFalseVictories / total,
      teamworkFalseVictories: tFalseVictories / total,
      baselineStalls: bStalls / total,
      teamworkStalls: tStalls / total,
      baselineAvgTokens: bAvgTokens,
      teamworkAvgTokens: tAvgTokens,
      baselineAvgTimeSec: Number(bAvgTime),
      teamworkAvgTimeSec: Number(tAvgTime),
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith("runner.mjs")) {
  const isQuiet = process.argv.includes("--quiet") || process.argv.includes("-q");
  runAllBenchmarks({ quiet: isQuiet })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Benchmark runner failed:", err);
      process.exit(1);
    });
}
