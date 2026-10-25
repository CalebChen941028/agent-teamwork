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
import {
  createLiveClient,
  resolveLiveApiKey,
  resolveRuntimeConfig,
} from "../live-eval.mjs";

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
  let diff = (res.stdout || "").trim();
  if (diff && !diff.endsWith("\n")) {
    diff += "\n";
  }
  return diff;
}

export function extractFileBlocks(text) {
  const blocks = [];
  const source = String(text || "");

  // 1. Surgical block replacements: <replace path="..."> or <edit path="...">
  const replaceRe = /<(?:replace|edit)\s+path=["']([^"']+)["']>([\s\S]*?)<\/(?:replace|edit)>/gi;
  let rMatch;
  while ((rMatch = replaceRe.exec(source)) !== null) {
    const filePath = rMatch[1].trim();
    const body = rMatch[2];

    const targetMatch = /<(?:target|search)>([\s\S]*?)<\/(?:target|search)>/i.exec(body);
    const replacementMatch = /<(?:replacement|action)>([\s\S]*?)<\/(?:replacement|action)>/i.exec(body);

    if (targetMatch && replacementMatch) {
      blocks.push({
        type: "replace",
        path: filePath,
        target: targetMatch[1],
        replacement: replacementMatch[1],
      });
      continue;
    }

    const searchReplaceRe = /<{7}\s*SEARCH\s*\n([\s\S]*?)\n={7}\s*\n([\s\S]*?)\n>{7}\s*REPLACE/g;
    const srMatches = Array.from(body.matchAll(searchReplaceRe));
    if (srMatches.length > 0) {
      for (const sm of srMatches) {
        blocks.push({
          type: "replace",
          path: filePath,
          target: sm[1],
          replacement: sm[2],
        });
      }
      continue;
    }
  }

  // 2. Full-file replacement: <file path="...">...</file>
  const tagRe = /<file\s+path=["']([^"']+)["']>([\s\S]*?)<\/file>/gi;
  let match;
  while ((match = tagRe.exec(source)) !== null) {
    blocks.push({ type: "write", path: match[1].trim(), content: match[2] });
  }

  return blocks;
}

export function normalizeForMatching(text) {
  return String(text || "").replace(/\r\n/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n");
}

export function applyFileWrites(repoDir, files) {
  const written = [];
  const escaped = [];
  const failed = [];
  const resolvedRoot = path.resolve(repoDir);

  for (const f of files || []) {
    const rel = normalizeRelPath(f.path);
    if (!rel) {
      failed.push("<empty-path>");
      continue;
    }
    const abs = path.resolve(repoDir, rel);
    if (!abs.startsWith(resolvedRoot + path.sep) && abs !== resolvedRoot) {
      escaped.push(rel);
      continue;
    }

    if (f.type === "replace") {
      try {
        if (!fs.existsSync(abs)) {
          failed.push(`${rel}: file does not exist for surgical replace`);
          continue;
        }
        let original = fs.readFileSync(abs, "utf8");
        const target = f.target ?? "";
        const replacement = f.replacement ?? "";

        if (original.includes(target)) {
          original = original.replace(target, replacement);
        } else {
          // Flexible whitespace matching fallback (normalize CRLF and strip trailing whitespace per line)
          const normOriginal = normalizeForMatching(original);
          const normTarget = normalizeForMatching(target);
          const normReplacement = replacement.replace(/\r\n/g, "\n");

          if (normOriginal.includes(normTarget)) {
            original = normOriginal.replace(normTarget, normReplacement);
          } else {
            // Symmetrically trim outer blank lines if boundary spacing differed
            const trimmedTarget = normTarget.trim();
            const trimmedReplacement = normReplacement.trim();
            if (trimmedTarget && normOriginal.includes(trimmedTarget)) {
              original = normOriginal.replace(trimmedTarget, trimmedReplacement);
            } else {
              failed.push(`${rel}: target block not found in file`);
              continue;
            }
          }
        }
        if (original.length > 0 && !original.endsWith("\n")) {
          original += "\n";
        }
        fs.writeFileSync(abs, original, "utf8");
        written.push(rel);
      } catch (err) {
        failed.push(`${rel}: ${(err && err.message) || "replace error"}`);
      }
      continue;
    }

    // Default: full file write
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      let content = typeof f.content === "string" ? f.content : "";
      if (content.length > 0 && !content.endsWith("\n")) {
        content += "\n";
      }
      fs.writeFileSync(abs, content, "utf8");
      written.push(rel);
    } catch {
      escaped.push(rel);
    }
  }
  return { written, escaped, failed };
}

// ---------------------------------------------------------------------------
// Repository Cache & Per-Instance Sandboxes
// ---------------------------------------------------------------------------

const GIT_SANE_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

function repoCachePath(repo) {
  return path.join(__dirname, "cache", "repos", repo.replace("/", "__"));
}

export function ensureRepoClone(repo, { remote = `https://github.com/${repo}.git` } = {}) {
  const dir = repoCachePath(repo);
  const probe = git(dir, ["rev-parse", "--git-dir"], { env: GIT_SANE_ENV });
  if (probe.status !== 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const res = git(path.dirname(dir), ["clone", "--quiet", remote, dir], { env: GIT_SANE_ENV });
    if (res.status !== 0) {
      throw new Error(`git clone failed for ${repo}: ${(res.stderr || "").trim().slice(0, 300)}`);
    }
  }
  return dir;
}

export function ensureCommitAvailable(repoDir, sha) {
  if (git(repoDir, ["cat-file", "-e", `${sha}^{commit}`], { env: GIT_SANE_ENV }).status === 0) {
    return;
  }
  git(repoDir, ["fetch", "--quiet", "origin"], { env: GIT_SANE_ENV });
  if (git(repoDir, ["cat-file", "-e", `${sha}^{commit}`], { env: GIT_SANE_ENV }).status !== 0) {
    throw new Error(`base commit ${sha} not found in repository clone`);
  }
}

export function createInstanceSandbox({ instance, track, parentDir = null }) {
  const cacheDir = ensureRepoClone(instance.repo);
  ensureCommitAvailable(cacheDir, instance.base_commit);
  const safeId = String(instance.instance_id).replace(/[^A-Za-z0-9._-]/g, "_");
  const dir = fs.mkdtempSync(path.join(parentDir || os.tmpdir(), `swebench-${track}-${safeId}-`));
  const res = git(os.tmpdir(), ["clone", "--quiet", "--shared", "--no-checkout", cacheDir, dir], {
    env: GIT_SANE_ENV,
  });
  if (res.status !== 0) {
    throw new Error(`sandbox clone failed for ${instance.instance_id}: ${(res.stderr || "").trim().slice(0, 300)}`);
  }
  const checkout = git(dir, ["checkout", "--quiet", "--detach", instance.base_commit], { env: GIT_SANE_ENV });
  if (checkout.status !== 0) {
    throw new Error(
      `checkout failed for ${instance.instance_id}@${instance.base_commit}: ${(checkout.stderr || "").trim().slice(0, 300)}`,
    );
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Repository Visibility (file tree + read-on-request protocol)
// ---------------------------------------------------------------------------

const SOURCE_FILE_RE = /\.(py|js|ts|mjs|cjs|c|h|cpp|cc|java|go|rs|rb|php|sh|cfg|toml|ini|json|yaml|yml|rst|txt|in|pyi)$/i;
const NON_CORE_DIRS = /^(doc|docs|changelog|news|bench|extra|scripts|\.github)\//i;

export function buildRepoFileTree(repoDir, { maxEntries = 400 } = {}) {
  const res = git(repoDir, ["ls-files"], { env: GIT_SANE_ENV });
  const all = (res.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (all.length <= maxEntries) {
    return { tree: all.join("\n"), totalFiles: all.length, truncated: false };
  }
  // Prioritize primary source directory files over documentation / changelogs
  const coreSource = all.filter((l) => !NON_CORE_DIRS.test(l) && SOURCE_FILE_RE.test(l));
  const candidate = coreSource.length > 0 ? coreSource : all;
  const capped = candidate.slice(0, maxEntries);
  return {
    tree: capped.join("\n"),
    totalFiles: all.length,
    truncated: true,
    shownFiles: capped.length,
  };
}

const READ_TAG_RE = /<read\b([^>]*?)(?:\/>|>(?:<\/read>)?)/gi;

function toReadItemKey(r) {
  if (typeof r === "string") return `${r}::`;
  return `${r.path}:${r.start || ""}:${r.end || ""}`;
}

export function extractReadRequests(text, { maxRequests = 5 } = {}) {
  const requests = [];
  const source = String(text || "");
  let match;
  while ((match = READ_TAG_RE.exec(source)) !== null && requests.length < maxRequests) {
    const attrs = match[1] || "";
    const pathMatch = /path=["']([^"']+)["']/.exec(attrs);
    if (!pathMatch) continue;
    const rel = normalizeRelPath(pathMatch[1].trim());
    if (!rel) continue;

    const startMatch = /start=["']?(\d+)["']?/.exec(attrs);
    const endMatch = /end=["']?(\d+)["']?/.exec(attrs);
    const linesMatch = /lines=["']?(\d+)\s*[-:]\s*(\d+)["']?/.exec(attrs);
    const start = startMatch ? Number(startMatch[1]) : (linesMatch ? Number(linesMatch[1]) : null);
    const end = endMatch ? Number(endMatch[1]) : (linesMatch ? Number(linesMatch[2]) : null);

    const item = (start != null || end != null) ? { path: rel, start, end } : rel;
    const key = toReadItemKey(item);
    if (!requests.some((r) => toReadItemKey(r) === key)) {
      requests.push(item);
    }
  }
  return requests;
}

export function readRepoFile(repoDir, target, { maxChars = 60000 } = {}) {
  const relPath = typeof target === "string" ? target : (target && target.path ? target.path : "");
  const start = typeof target === "object" && target ? target.start : null;
  const end = typeof target === "object" && target ? target.end : null;

  const resolvedRoot = path.resolve(repoDir);
  const normalized = normalizeRelPath(relPath);
  const abs = path.resolve(repoDir, normalized);
  if (!abs.startsWith(resolvedRoot + path.sep)) {
    return { path: relPath, error: "path escapes sandbox" };
  }
  let raw;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch {
    return { path: relPath, error: "file not found" };
  }

  const allLines = raw.split("\n");
  const totalLines = allLines.length;

  if (start != null || end != null) {
    const s = Math.max(1, start != null ? start : 1);
    const e = Math.min(totalLines, end != null ? end : totalLines);
    if (s > e || s > totalLines) {
      return {
        path: relPath,
        content: `[lines ${s}-${e} out of range; file has ${totalLines} lines]`,
        start: s,
        end: e,
        totalLines,
      };
    }
    const sliced = allLines.slice(s - 1, e);
    const padLen = String(e).length;
    const numbered = sliced
      .map((line, idx) => `${String(s + idx).padStart(padLen, " ")} | ${line}`)
      .join("\n");

    return {
      path: relPath,
      content: numbered,
      start: s,
      end: e,
      totalLines,
      sliced: true,
    };
  }

  if (raw.length > maxChars) {
    return {
      path: relPath,
      content: raw.slice(0, maxChars),
      truncated: true,
      totalLines,
      totalChars: raw.length,
    };
  }
  return { path: relPath, content: raw, totalLines };
}

export function renderReadResponses(reads) {
  return reads
    .map((r) => {
      if (r.error) return `<read-result path="${r.path}" error="${r.error}"/>`;
      if (r.sliced) {
        return `<read-result path="${r.path}" lines="${r.start}-${r.end}" totalLines="${r.totalLines}">\n${r.content}\n</read-result>`;
      }
      const body = r.truncated
        ? `${r.content}\n... [truncated at ${r.content.length} chars (file has ${r.totalLines || "many"} lines) — use <read path="${r.path}" start="n" end="m"/> to inspect specific lines]`
        : r.content;
      return `<read-result path="${r.path}" totalLines="${r.totalLines || "unknown"}">\n${body}\n</read-result>`;
    })
    .join("\n\n");
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
    "Preferred (Surgical Block Replacement - saves context & prevents diff corruption):",
    '<replace path="relative/path/to/source_file.py">',
    "<target>",
    "exact existing code snippet to replace",
    "</target>",
    "<replacement>",
    "new replacement code",
    "</replacement>",
    "</replace>",
    "",
    "Full-File Overwrite (for new files or complete file rewrites):",
    '<file path="relative/path/to/source_file.py">',
    "...complete revised file content (no placeholders)...",
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
    "2. SURGICAL DISCIPLINE: Make minimal, backwards-compatible fixes. Prefer <replace> over full file rewrites.",
    "3. IMPORT & DISCOVERY INTEGRITY: Ensure modified modules compile cleanly without syntax errors and preserve package importability.",
    "4. ADVERSARIAL RIGOR: Enumerate edge cases (empty inputs, unicode, type bounds) before claiming completion.",
    "",
    fileProtocol,
  ].join("\n");
}

export function buildSwebenchUserPrompt(instance, fileTree = null) {
  const parts = [
    `# Issue Report: ${instance.instance_id} (${instance.repo})`,
    "",
    instance.problem_statement,
    "",
    instance.hints_text ? `Hints / Maintainer Discussion:\n${instance.hints_text}\n` : "",
  ];

  if (fileTree && fileTree.tree) {
    parts.push("# Repository File Tree (checked out at the base commit)");
    parts.push(fileTree.tree);
    if (fileTree.truncated) {
      parts.push(`[tree truncated: showing ${fileTree.shownFiles} of ${fileTree.totalFiles} files — prefer source directories]`);
    }
    parts.push("");
    parts.push(
      [
        "# Repository Read Access",
        "The working tree above is live in your workspace. Before editing a file, read its current contents:",
        '<read path="requests/models.py"/>  (reads entire file, up to 60KB)',
        '<read path="requests/models.py" start="100" end="150"/>  (target specific line range; recommended to save context)',
        "The driver replies with <read-result path=\"...\"> blocks containing exact file contents.",
        "Analyze the issue, locate the bug, then emit the corrected file blocks.",
      ].join("\n"),
    );
  } else {
    parts.push("Analyze the issue, locate the bug in the repository, and emit the corrected file blocks.");
  }

  return parts.join("\n");
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
    { role: "user", content: buildSwebenchUserPrompt(instance, buildRepoFileTree(repoDir)) },
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
    const readRequests = extractReadRequests(content);
    if (readRequests.length > 0) {
      const reads = readRequests.map((rel) => readRepoFile(repoDir, rel));
      feedbackParts.push(renderReadResponses(reads));
    }
    // Context tax optimization: prune large file tree from initial user message for subsequent turns
    if (turn === 1 && messages[1] && typeof messages[1].content === "string") {
      messages[1].content = messages[1].content.replace(
        /# Repository File Tree \(checked out at the base commit\)[\s\S]*?(?=# Repository Read Access)/,
        `# Repository File Tree\n[Repository tree loaded in turn 1. Use <read path="..." [start="n" end="m"]/> to inspect source files]\n\n`
      );
    }

    if (!wroteFiles) {
      if (readRequests.length === 0) {
        feedbackParts.push("[NO DISK WRITES] You produced analysis but wrote no files. Emit <replace path=\"...\"> or <file path=\"...\"> blocks to apply changes.");
      }
    } else {
      feedbackParts.push(`[DISK WRITES APPLIED] Modified files: ${writeReport.written.join(", ")}. Inspect git status and continue.`);
    }

    if (writeReport.failed && writeReport.failed.length > 0) {
      feedbackParts.push(`[WRITE ERROR] Failed to apply edit block(s): ${writeReport.failed.join("; ")}`);
    }

    // Pre-flight syntax validation on written files
    if (writeReport.written.length > 0) {
      for (const rel of writeReport.written) {
        if (rel.endsWith(".py")) {
          const pyComp = spawnSync("python3", ["-m", "py_compile", path.join(repoDir, rel)], { encoding: "utf8" });
          if (pyComp.status !== 0) {
            const errTail = formatFailureOutput(pyComp.stdout, pyComp.stderr, 400);
            feedbackParts.push(`[SYNTAX INTEGRITY WARNING] python3 -m py_compile failed on ${rel}:\n${errTail}\nFix this syntax defect immediately.`);
          }
        } else if (rel.endsWith(".js") || rel.endsWith(".mjs")) {
          const jsComp = spawnSync("node", ["--check", path.join(repoDir, rel)], { encoding: "utf8" });
          if (jsComp.status !== 0) {
            const errTail = formatFailureOutput(jsComp.stdout, jsComp.stderr, 400);
            feedbackParts.push(`[SYNTAX INTEGRITY WARNING] node --check failed on ${rel}:\n${errTail}\nFix this syntax defect immediately.`);
          }
        }
      }
    }

    // Critical Urgency Nudge if no files have been modified yet in the late turns
    const urgentTurnThreshold = Math.max(3, maxTurns - 2);
    if (!hasDiff && turn >= urgentTurnThreshold) {
      feedbackParts.push(
        `[CRITICAL BUDGET ALERT: Turn ${turn} of ${maxTurns}] Zero files have been modified so far. You are at imminent risk of an EMPTY PATCH failure! You MUST stop reading/exploration now and emit concrete <replace path="..."> or <file path="..."> patch blocks in your next response!`
      );
    } else {
      feedbackParts.push(`[TURN BUDGET] turn ${turn}/${maxTurns}. When you have located the defect, emit the corrected <replace> or <file> blocks and end with STATUS: DONE.`);
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

export function appendPrediction(predictionsPath, { instanceId, modelPatch, modelName = "agent-teamwork-v0.5.0" }) {
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
    maxTokens: DEFAULT_MAX_TOKENS,
    apiKey: null,
    baseUrl: null,
    concurrency: 1,
    resume: false,
    keepSandboxes: false,
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
    else if (a === "--max-turns" && raw[i + 1]) args.maxTurns = Number(raw[++i]) || args.maxTurns;
    else if (a === "--timeout-ms" && raw[i + 1]) args.timeoutMs = Number(raw[++i]) || args.timeoutMs;
    else if (a === "--max-tokens" && raw[i + 1]) args.maxTokens = Number(raw[++i]) || args.maxTokens;
    else if (a === "--api-key" && raw[i + 1]) args.apiKey = raw[++i];
    else if (a === "--base-url" && raw[i + 1]) args.baseUrl = raw[++i];
    else if (a === "--concurrency" && raw[i + 1]) args.concurrency = Math.max(1, Number(raw[++i]) || 1);
    else if (a === "--resume") args.resume = true;
    else if (a === "--no-resume") args.resume = false;
    else if (a === "--keep-sandboxes") args.keepSandboxes = true;
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
  --model <model_name>          Model to evaluate (default: deepseek-v4.1-flash)
  --concurrency <N>             Number of instances to evaluate in parallel (default: 1)
  --resume                      Resume from existing predictions file (skips already resolved instances)
  --out-predictions <file>      Path to output predictions.jsonl
                                (in ab mode: -teamwork / -baseline suffixes are derived)
  --out-report <file.json>      Path to output summary benchmark report
  --max-turns <n>               Per-instance turn budget (default: 6)
  --max-tokens <n>              Per-request completion budget (default: 16384)
  --timeout-ms <n>              Per-request HTTP timeout (default: 420000)
  --api-key <key>               API key (else OPENCODE_API_KEY / ZEN_API_KEY /
                                ZHIPUAI_API_KEY, else models.local.json api_key)
  --base-url <url>              OpenAI-compatible chat/completions endpoint
  --keep-sandboxes              Keep per-instance git sandboxes under os.tmpdir()
  --dry-run                     Validate pipeline without calling live LLM API
  -h, --help                    Show this help

Workflow:
  1. Export sample instances:
     python3 benchmarks/swebench/loader.py --repo psf/requests --limit 5 --export /tmp/tasks.json
  2. Run agent-teamwork evaluation:
     node benchmarks/swebench/runner.mjs --instances /tmp/tasks.json --out-predictions predictions.jsonl
  3. Run official Docker evaluation:
     python3 benchmarks/swebench/eval.py --predictions predictions.jsonl
`);
}

// ---------------------------------------------------------------------------
// Main Driver
// ---------------------------------------------------------------------------

export function loadInstances({ instancesFile, repo = null, instanceId = null } = {}) {
  if (!instancesFile) {
    throw new Error("No instances source: pass --instances <file.json> (from loader.py)");
  }
  const raw = JSON.parse(fs.readFileSync(instancesFile, "utf8"));
  let items = Array.isArray(raw) ? raw : Array.isArray(raw.instances) ? raw.instances : null;
  if (!items) throw new Error(`Instances file ${instancesFile} is neither an array nor {instances: []}`);
  if (repo) items = items.filter((it) => it.repo === repo);
  if (instanceId) items = items.filter((it) => it.instance_id === instanceId);
  for (const it of items) {
    if (!it.instance_id || !it.repo || !it.base_commit || !it.problem_statement) {
      throw new Error(`Instance missing required fields (instance_id/repo/base_commit/problem_statement): ${it.instance_id || "?"}`);
    }
  }
  return items;
}

function predictionsPathFor(args, track) {
  if (args.mode !== "ab") return args.outPredictions;
  const ext = path.extname(args.outPredictions);
  const base = args.outPredictions.slice(0, args.outPredictions.length - ext.length);
  return `${base}-${track}${ext}`;
}

function modelNameFor(track, model) {
  return track === "teamwork" ? `agent-teamwork-v0.5.0+swebench (${model})` : `${model}-solo`;
}

function summarizeResult(result) {
  return {
    instanceId: result.instanceId,
    track: result.track,
    turnsUsed: result.turnsUsed,
    patchChars: (result.modelPatch || "").length,
    patchEmpty: !(result.modelPatch || "").trim(),
    interceptedWrites: result.interceptedWrites,
    falseVictories: result.falseVictories,
    stagnationRounds: result.stagnationRounds,
    abortReason: result.abortReason,
    durationMs: Math.round(result.durationMs),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    printUsage();
    return 0;
  }
  if (!["teamwork", "baseline", "ab"].includes(args.mode)) {
    console.error(`✖ Unknown mode "${args.mode}" (expected teamwork | baseline | ab)`);
    return 1;
  }

  const instances = loadInstances(args);
  console.log(
    `[SWE-bench Runner] ${instances.length} instance(s) | mode=${args.mode} | model=${args.model} | maxTurns=${args.maxTurns}`,
  );

  if (args.dryRun) {
    for (const it of instances) {
      console.log(`  [dry-run] ${it.instance_id} @ ${it.base_commit.slice(0, 10)} (${it.repo})`);
    }
    console.log("[dry-run] Pipeline validated; no API calls made.");
    return 0;
  }

  const resolution = resolveLiveApiKey({ cliKey: args.apiKey });
  const config = resolveRuntimeConfig({ args: { model: args.model, baseUrl: args.baseUrl }, resolution });
  if (!config.apiKey) {
    console.error("✖ No API key available — live SWE-bench runs perform REAL model calls and refuse to fabricate data.");
    console.error("  Pass --api-key, or set OPENCODE_API_KEY / ZEN_API_KEY, or configure models.local.json (git-ignored).");
    return 1;
  }

  const client = createLiveClient({
    apiKey: config.apiKey,
    model: args.model,
    baseUrl: config.baseUrl,
    extraHeaders: config.extraHeaders,
    maxTokens: args.maxTokens,
    timeoutMs: args.timeoutMs,
  });

  const tracks = args.mode === "ab" ? ["teamwork", "baseline"] : [args.mode];
  const report = {
    benchmark: "swebench-verified",
    model: args.model,
    mode: args.mode,
    keySource: config.keySource,
    maxTurns: args.maxTurns,
    generatedAt: new Date().toISOString(),
    tracks: {},
  };

  for (const track of tracks) {
    const predPath = predictionsPathFor(args, track);
    const completedIds = new Set();

    if (args.resume && fs.existsSync(predPath)) {
      const existingLines = fs.readFileSync(predPath, "utf8").split("\n").filter(Boolean);
      for (const line of existingLines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed && parsed.instance_id) completedIds.add(parsed.instance_id);
        } catch {}
      }
      console.log(`[resume] Found ${completedIds.size} already completed instance(s) in ${predPath}`);
    } else {
      fs.rmSync(predPath, { force: true });
    }

    const instancesToRun = instances.filter((it) => !completedIds.has(it.instance_id));
    const trackResults = [];
    const trackErrors = [];
    console.log(`\n=== Track: ${track} → ${predPath} (${instancesToRun.length}/${instances.length} to evaluate) ===`);

    async function evaluateOne(instance) {
      console.log(`\n[${track}] ${instance.instance_id} (${instance.repo}@${instance.base_commit.slice(0, 10)})`);
      let sandbox = null;
      try {
        sandbox = createInstanceSandbox({ instance, track });
        const result = await runSwebenchInstance({
          instance,
          repoDir: sandbox,
          client,
          track,
          maxTurns: args.maxTurns,
          log: (m) => console.log(m),
        });
        appendPrediction(predPath, {
          instanceId: result.instanceId,
          modelPatch: result.modelPatch,
          modelName: modelNameFor(track, args.model),
        });
        const summary = summarizeResult(result);
        trackResults.push(summary);
        console.log(
          `  → patch ${summary.patchChars} chars, turns=${summary.turnsUsed}, abort=${summary.abortReason || "none"}, ${Math.round(summary.durationMs / 1000)}s`,
        );
      } catch (err) {
        appendPrediction(predPath, {
          instanceId: instance.instance_id,
          modelPatch: "",
          modelName: modelNameFor(track, args.model),
        });
        trackErrors.push({ instanceId: instance.instance_id, error: String(err && err.message ? err.message : err) });
        console.error(`  ✖ failed: ${err && err.message ? err.message : err}`);
      } finally {
        if (sandbox && !args.keepSandboxes) {
          fs.rmSync(sandbox, { recursive: true, force: true });
        }
      }
    }

    const limit = Math.max(1, args.concurrency || 1);
    if (limit === 1) {
      for (const instance of instancesToRun) {
        await evaluateOne(instance);
      }
    } else {
      console.log(`[concurrency] Running with worker pool size = ${limit}`);
      const executing = [];
      for (const instance of instancesToRun) {
        const p = Promise.resolve().then(() => evaluateOne(instance));
        const e = p.then(() => executing.splice(executing.indexOf(e), 1));
        executing.push(e);
        if (executing.length >= limit) {
          await Promise.race(executing);
        }
      }
      await Promise.all(executing);
    }

    const totals = client.totals();
    report.tracks[track] = {
      predictionsPath: predPath,
      instancesTotal: instances.length,
      patchesGenerated: trackResults.filter((r) => !r.patchEmpty).length,
      results: trackResults,
      errors: trackErrors,
      tokenUsage: {
        prompt: totals.promptTokens,
        completion: totals.completionTokens,
        total: totals.totalTokens,
        calls: totals.calls,
      },
    };
    console.log(
      `\n[${track} summary] patches=${report.tracks[track].patchesGenerated}/${instances.length} errors=${trackErrors.length}`,
    );
  }

  if (args.outReport) {
    fs.mkdirSync(path.dirname(path.resolve(args.outReport)), { recursive: true });
    fs.writeFileSync(args.outReport, JSON.stringify(report, null, 2), "utf8");
    console.log(`\n[✔] Report written to ${args.outReport}`);
  }

  // Pre-warm the official Docker verdict path with an offline sanity check.
  for (const track of tracks) {
    const predPath = predictionsPathFor(args, track);
    if (fs.existsSync(predPath)) {
      console.log(`[✔] Predictions written: ${predPath} (verify with: python3 benchmarks/swebench/eval.py --predictions ${predPath} --local-check-only)`);
    }
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("runner.mjs")) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error("✖ SWE-bench runner crashed:", err && err.stack ? err.stack : err);
      process.exit(1);
    },
  );
}
