#!/usr/bin/env node
/**
 * SWE-bench Verified Adapter & Benchmark Runner for agent-teamwork.
 *
 * Connects agent-teamwork's multi-agent collaboration engine (Scoping Contract,
 * Dynamic Risk Topology, Path Lock, Challenger Review, and Write-Aware Stagnation)
 * to the official Princeton SWE-bench Verified benchmark (500 real GitHub issues).
 *
 * Output: standard predictions.jsonl matching the official SWE-bench submission format:
 *   {"instance_id": "...", "model_name_or_path": "...", "model_patch": "..."}
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  findOutOfBoundsFiles,
  formatFailureOutput,
  computeGapSignature,
  resolveMilestoneTopology,
  calculateTeamworkOpenGaps,
  formatTeamworkConclusion,
  normalizeRelPath,
} from "../../shared/verify-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const DEFAULT_PREDICTIONS_PATH = path.join(__dirname, "predictions.jsonl");

export const OPENCODE_ZEN_URL = "https://opencode.ai/zen/go/v1/chat/completions";
export const DEFAULT_MODEL = "deepseek-v4.1-flash";
export const DEFAULT_TIMEOUT_MS = 420000;
export const DEFAULT_MAX_TURNS = 6;
export const DEFAULT_MAX_TOKENS = 16384;

// ---------------------------------------------------------------------------
// Git & Repository Utilities
// ---------------------------------------------------------------------------

function git(cwd, args, options = {}) {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  return res;
}

export function extractUnifiedDiff(repoDir) {
  const res = git(repoDir, ["diff", "HEAD"]);
  return (res.stdout || "").trim();
}

export function extractFileBlocks(text) {
  const blocks = [];
  const source = String(text || "");
  const tagRe = /<file\s+path=["']([^"']+)["']>([\s\S]*?)<\/file>/gi;
  let match;
  while ((match = tagRe.exec(source)) !== null) {
    blocks.push({ path: match[1].trim(), content: match[2] });
  }
  return blocks;
}

export function applyFileWrites(repoDir, files) {
  const written = [];
  const escaped = [];
  const resolvedRoot = path.resolve(repoDir);

  for (const f of files) {
    const rel = normalizeRelPath(f.path);
    const abs = path.resolve(repoDir, rel);
    if (!abs.startsWith(resolvedRoot + path.sep) && abs !== resolvedRoot) {
      escaped.push(rel);
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.content, "utf8");
      written.push(rel);
    } catch {
      escaped.push(rel);
    }
  }
  return { written, escaped };
}

// ---------------------------------------------------------------------------
// Prompt Formulation & Scoping Contract
// ---------------------------------------------------------------------------

export function buildSwebenchScopingContract(instance) {
  const topology = resolveMilestoneTopology(
    { title: instance.instance_id, done: "Resolve issue and pass all regression checks" },
    "hybrid"
  );

  return {
    instanceId: instance.instance_id,
    repo: instance.repo,
    baseCommit: instance.base_commit,
    primaryGoal: `Resolve issue ${instance.instance_id} in ${instance.repo}`,
    problemStatement: instance.problem_statement,
    topology,
    forbiddenPaths: [
      ".git/",
      ".github/",
      "tests/", // Prevent cheating by editing test suite
      "testing/",
    ],
  };
}

export function buildSwebenchSystemPrompt(contract, track = "teamwork") {
  const fileProtocol = [
    "File Modification Protocol (Strict):",
    '<file path="relative/path/to/source_file.py">',
    "...complete revised file content (no diffs, no placeholders)...",
    "</file>",
    "End reply with: STATUS: DONE or STATUS: CONTINUE.",
  ].join("\n");

  if (track === "baseline") {
    return [
      `You are an autonomous senior software engineer fixing an issue in ${contract.repo}.`,
      "Inspect the problem statement, identify the root cause in the source code, and fix it.",
      "",
      fileProtocol,
    ].join("\n");
  }

  // Track B: agent-teamwork Scoping & Discipline
  return [
    `You are a worker agent executing inside the agent-teamwork collaboration engine for SWE-bench.`,
    `Target: ${contract.instanceId} (${contract.repo})`,
    `Topology Routing: risk=${contract.topology.risk}, workerTier=${contract.topology.workerTier}.`,
    "",
    "Engine Guardrails (Strict Enforcement):",
    "1. BOUNDARY LOCK: Modify ONLY repository implementation files. Never tamper with tests/ or .git/.",
    "2. SURGICAL DISCIPLINE: Make minimal, backwards-compatible fixes. Do not refactor unrelated modules.",
    "3. ADVERSARIAL RIGOR: Enumerate edge cases (empty inputs, unicode, type bounds) before claiming completion.",
    "",
    fileProtocol,
  ].join("\n");
}

export function buildSwebenchUserPrompt(instance) {
  return [
    `# Issue Report: ${instance.instance_id} (${instance.repo})`,
    "",
    instance.problem_statement,
    "",
    instance.hints_text ? `Hints / Maintainer Discussion:\n${instance.hints_text}\n` : "",
    "Analyze the issue, locate the bug in the repository, and emit the corrected file blocks.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Core Task Evaluation Loop
// ---------------------------------------------------------------------------

export async function runSwebenchInstance({
  instance,
  repoDir,
  client,
  track = "teamwork",
  maxTurns = DEFAULT_MAX_TURNS,
  log = () => {},
}) {
  const contract = buildSwebenchScopingContract(instance);
  const startedAt = performance.now();
  const turns = [];
  let finalPatch = "";
  let interceptedWrites = 0;
  let falseVictories = 0;
  let lastSignature = null;
  let consecutive = 0;
  let stagnationRounds = 0;
  let abortReason = null;

  const messages = [
    { role: "system", content: buildSwebenchSystemPrompt(contract, track) },
    { role: "user", content: buildSwebenchUserPrompt(instance) },
  ];

  for (let turn = 1; turn <= maxTurns; turn++) {
    const response = await client.chat({ messages });
    const content = response.content || "";
    const files = extractFileBlocks(content);

    // Physical Path Lock (Track B only)
    let allowedFiles = files;
    let blockedFiles = [];
    if (track === "teamwork") {
      const forbidden = contract.forbiddenPaths;
      blockedFiles = files.filter((f) =>
        forbidden.some((p) => normalizeRelPath(f.path).startsWith(normalizeRelPath(p)))
      ).map((f) => f.path);
      interceptedWrites += blockedFiles.length;
      allowedFiles = files.filter((f) => !blockedFiles.includes(f.path));
    }

    const writeReport = applyFileWrites(repoDir, allowedFiles);
    const wroteFiles = writeReport.written.length > 0;
    const claimedDone = /STATUS:\s*DONE|I have completed the fix|all tests pass/i.test(content);

    // Compute diff and verify git state
    const currentDiff = extractUnifiedDiff(repoDir);
    const hasDiff = currentDiff.length > 0;

    // Check false victory: claimed done without writing code or generating diff
    if (claimedDone && !hasDiff) {
      falseVictories++;
    }

    // Write-aware stagnation check
    const currentSig = computeGapSignature([currentDiff.slice(0, 500) || "no-diff"]);
    if (wroteFiles) {
      if (currentSig === lastSignature) {
        consecutive++;
        stagnationRounds++;
      } else {
        consecutive = 1;
        lastSignature = currentSig;
      }
    }

    turns.push({
      turn,
      wroteFiles: writeReport.written,
      blockedFiles,
      claimedDone,
      diffLength: currentDiff.length,
      latencyMs: response.latencyMs || 0,
    });

    log(`  [${track} turn ${turn}] wrote=${writeReport.written.length} blocked=${blockedFiles.length} done=${claimedDone} diffChars=${currentDiff.length}`);

    if (claimedDone && hasDiff) {
      finalPatch = currentDiff;
      break;
    }

    if (track === "teamwork" && consecutive >= 2) {
      abortReason = "stagnation-early-stop";
      log(`  [${track} turn ${turn}] Stagnation detected after consecutive identical diffs; early stopping.`);
      break;
    }

    // Prepare next turn feedback
    messages.push({ role: "assistant", content });
    const feedbackParts = [];
    if (blockedFiles.length > 0) {
      feedbackParts.push(`[PATH LOCK] Blocked forbidden file writes: ${blockedFiles.join(", ")}`);
    }
    if (!wroteFiles) {
      feedbackParts.push("[NO DISK WRITES] You produced analysis but wrote no files. Emit <file path=\"...\"> blocks to apply changes.");
    } else {
      feedbackParts.push(`[DISK WRITES APPLIED] Modified files: ${writeReport.written.join(", ")}. Inspect git status and continue.`);
    }
    messages.push({ role: "user", content: feedbackParts.join("\n") });
  }

  if (!finalPatch) {
    finalPatch = extractUnifiedDiff(repoDir);
  }

  const durationMs = performance.now() - startedAt;

  return {
    instanceId: instance.instance_id,
    repo: instance.repo,
    track,
    modelPatch: finalPatch,
    turnsUsed: turns.length,
    interceptedWrites,
    falseVictories,
    stagnationRounds,
    abortReason,
    durationMs,
    turns,
  };
}

// ---------------------------------------------------------------------------
// Predictions Exporter
// ---------------------------------------------------------------------------

export function appendPrediction(predictionsPath, { instanceId, modelPatch, modelName = "agent-teamwork-v0.4.0" }) {
  const line = JSON.stringify({
    instance_id: instanceId,
    model_name_or_path: modelName,
    model_patch: modelPatch || "",
  }) + "\n";

  fs.appendFileSync(predictionsPath, line, "utf8");
}

// ---------------------------------------------------------------------------
// CLI Interface
// ---------------------------------------------------------------------------

export function parseCliArgs(argv) {
  const args = {
    instancesFile: null,
    instanceId: null,
    repo: null,
    mode: "teamwork",
    model: DEFAULT_MODEL,
    outPredictions: DEFAULT_PREDICTIONS_PATH,
    outReport: null,
    maxTurns: DEFAULT_MAX_TURNS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
    help: false,
  };

  const raw = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "--instances" && raw[i + 1]) args.instancesFile = raw[++i];
    else if (a === "--instance" && raw[i + 1]) args.instanceId = raw[++i];
    else if (a === "--repo" && raw[i + 1]) args.repo = raw[++i];
    else if (a === "--mode" && raw[i + 1]) args.mode = raw[++i];
    else if (a === "--model" && raw[i + 1]) args.model = raw[++i];
    else if (a === "--out-predictions" && raw[i + 1]) args.outPredictions = raw[++i];
    else if (a === "--out-report" && raw[i + 1]) args.outReport = raw[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "-h" || a === "--help") args.help = true;
  }
  return args;
}

export function printUsage() {
  console.log(`
Usage: node benchmarks/swebench/runner.mjs [options]

Evaluates agent-teamwork against SWE-bench Verified instances and generates
official submission-ready predictions.jsonl for Docker verification.

Options:
  --instances <file.json>       Path to exported instances JSON (from loader.py)
  --instance <id>               Run specific instance_id (e.g. psf__requests-1142)
  --repo <name>                 Filter by repository (e.g. psf/requests, django/django)
  --mode <teamwork|baseline|ab> Evaluation mode (default: teamwork)
  --model <id>                  Model id (default: deepseek-v4.1-flash)
  --out-predictions <file>      Path to output predictions.jsonl
  --out-report <file.json>      Path to output summary benchmark report
  --dry-run                     Validate pipeline without calling live LLM API
  -h, --help                    Show this help message

Workflow:
  1. Export sample instances:
     python3 benchmarks/swebench/loader.py --repo psf/requests --limit 5 --export /tmp/tasks.json
  2. Run agent-teamwork evaluation:
     node benchmarks/swebench/runner.mjs --instances /tmp/tasks.json --out-predictions predictions.jsonl
  3. Run official Docker evaluation:
     python3 benchmarks/swebench/eval.py --predictions predictions.jsonl
`);
}

if (process.argv[1] && process.argv[1].endsWith("runner.mjs")) {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }
  console.log(`[SWE-bench Runner] Initialized with mode=${args.mode}, model=${args.model}`);
}
