#!/usr/bin/env node
/**
 * Live Head-to-Head Evaluation Suite
 * mimo-v2.6-flash Solo (Track A: single model) vs mimo-v2.6-flash + agent-teamwork
 * (Track B: skill exoskeleton)
 *
 * Executes the 10 canonical SWE-bench tasks (benchmarks/tasks.mjs) LIVE against the
 * OpenCode Zen gateway (https://opencode.ai/zen/go/v1/chat/completions) by default —
 * or any OpenAI-compatible chat/completions endpoint (e.g. Zhipu) via --base-url —
 * each task in its own clean git sandbox under os.tmpdir():
 *
 *   Track A "baseline" (Solo):
 *     - Monolithic prompt (description + ground-truth test catalog, NO allowedPaths hints)
 *     - Naive agentic loop: FULL raw test output fed back (no tail truncation), no role
 *       division, no stagnation early-stop (hard turn budget only). Out-of-bounds writes
 *       are NOT blocked; pollution is measured afterwards via `git status --porcelain`.
 *
 *   Track B "teamwork" (With agent-teamwork):
 *     - Scoping-interview contract (protocol/scoping-interview.md elements)
 *     - resolveMilestoneTopology DyLAN risk-topology routing directives
 *     - findOutOfBoundsFiles physical path lock: out-of-bounds writes are blocked
 *       (never hit disk) and counted
 *     - formatFailureOutput tail-only failure feedback
 *     - computeGapSignature DJB2 gap-signature stagnation early-stop (>=2 identical
 *       consecutive signatures => one forced replan, then abort)
 *     - calculateTeamworkOpenGaps strict exit-code accounting (verifyPassed ONLY when
 *       the verifier subprocess exits 0 AND zero out-of-bounds writes landed)
 *
 * All gate functions are imported from ../shared/verify-gate.js (SSOT; never copied).
 *
 * Usage:
 *   npm run benchmark:live                                # A/B both tracks + comparison
 *   npm run benchmark:live -- --mode baseline             # Solo only
 *   npm run benchmark:live -- --mode teamwork             # Teamwork only
 *   npm run benchmark:live -- --tasks SWE-JS-001,SWE-JS-004 --out report.json
 *   npm run benchmark:live -- --check                     # auth precheck + tiny probe
 *   npm run benchmark:live -- --max-tokens 16384          # completion budget (reasoning included)
 *
 * API key resolution order: --api-key > OPENCODE_API_KEY > ZEN_API_KEY >
 * ZHIPUAI_API_KEY (legacy channel) > models.local.json (git-ignored) `api_key`
 * field. The local config may also pin `base_url`, `model`, `vendor` and
 * `extra_headers` (e.g. the Zen gateway's required `x-opencode-session`).
 * Without a key the CLI fails fast with guidance (exit code 2). Override the
 * config path with env AGENT_TEAMWORK_MODELS_LOCAL (used by offline tests).
 *
 * Offline testing surface (no network, no key): every stage is injectable —
 *   createLiveClient({ transport }) accepts a fake transport returning
 *   { ok, status, json(), text() }; runLiveEval({ clientFactory }) accepts hand-rolled
 *   clients exposing chat(request) -> { content, usage, latencyMs } and totals().
 * Pure helpers (parseCliArgs, extractFileBlocks, buildScopingContract, detectDoneClaim,
 * parseGitStatus, redactSecrets, ...) are exported for unit tests. Importing this
 * module has no side effects; the CLI entry is argv-guarded like runner.mjs.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import process from "node:process";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { BENCHMARK_TASKS } from "./tasks.mjs";
import {
  calculateTeamworkOpenGaps,
  computeGapSignature,
  findOutOfBoundsFiles,
  formatFailureOutput,
  formatTeamworkConclusion,
  normalizeRelPath,
  resolveMilestoneTopology,
} from "../shared/verify-gate.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const OPENCODE_ZEN_CHAT_COMPLETIONS_URL = "https://opencode.ai/zen/go/v1/chat/completions";
export const ZHIPU_CHAT_COMPLETIONS_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
export const DEFAULT_BASE_URL = OPENCODE_ZEN_CHAT_COMPLETIONS_URL;
export const DEFAULT_MODEL = "mimo-v2.6-flash";
export const DEFAULT_MAX_TURNS = 6;
export const DEFAULT_REQUEST_TIMEOUT_MS = 420000;
export const DEFAULT_MAX_RETRIES = 1;
// Reasoning models emit reasoning_content before content; the completion budget
// must cover both. 16384 leaves room for reasoning plus a complete file payload.
// Identical for both tracks — the only A/B variable is the collaboration scaffolding.
export const DEFAULT_MAX_TOKENS = 16384;
// Env var overriding the models.local.json path (offline tests point it at a
// missing file so the CLI keeps its no-key fail-fast guarantee everywhere).
export const LOCAL_CONFIG_ENV = "AGENT_TEAMWORK_MODELS_LOCAL";
// The Zen gateway rejects requests without a session header (400 MissingSessionID).
export const OPENCODE_SESSION_HEADER = "x-opencode-session";
export const OPENCODE_SESSION_DEFAULT = "zcode-live-eval";
const TEST_RUN_TIMEOUT_MS = 30000;
const FAILURE_TAIL_CAP = 2000;
const MAX_REPLANS = 1;
const STAGNATION_THRESHOLD = 2; // >=2 consecutive identical gap signatures

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tasksModulePath = path.join(repoRoot, "benchmarks", "tasks.mjs");

function defaultLocalConfigPath() {
  const fromEnv = process.env[LOCAL_CONFIG_ENV];
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : path.join(repoRoot, "models.local.json");
}

const FILE_TAG_PROTOCOL = [
  "File Protocol:",
  '<file path="relative/path/to/file">',
  "...complete file content (no diffs, no placeholders)...",
  "</file>",
  "End reply with: STATUS: DONE or STATUS: CONTINUE.",
].join("\n");

// ---------------------------------------------------------------------------
// CLI argument parsing (pure, offline-testable)
// ---------------------------------------------------------------------------

export function parseCliArgs(argv) {
  const args = {
    mode: "ab",
    // null = "not pinned on the CLI": models.local.json `model` (if any) wins next,
    // then DEFAULT_MODEL. Keeps a local config authoritative for its channel.
    model: null,
    baseUrl: null,
    tasks: null,
    out: null,
    maxTurns: DEFAULT_MAX_TURNS,
    maxTokens: DEFAULT_MAX_TOKENS,
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    check: false,
    keepSandboxes: false,
    apiKey: null,
    help: false,
    error: null,
  };
  const raw = Array.isArray(argv) ? argv : [];
  const value = (flag, current) => {
    const v = raw[current + 1];
    if (v === undefined || v.startsWith("--")) {
      args.error = args.error || `${flag} requires a value`;
      return undefined;
    }
    return v;
  };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "--mode") {
      const v = value(a, i);
      i += 1;
      if (v === undefined) break;
      if (!["ab", "baseline", "teamwork"].includes(v)) {
        args.error = args.error || `invalid --mode "${v}" (expected ab|baseline|teamwork)`;
        break;
      }
      args.mode = v;
    } else if (a === "--model") {
      const v = value(a, i);
      i += 1;
      if (v === undefined) break;
      args.model = v;
    } else if (a === "--base-url") {
      const v = value(a, i);
      i += 1;
      if (v === undefined) break;
      let parsed = null;
      try {
        parsed = new URL(v);
      } catch {
        parsed = null;
      }
      if (!parsed || !/^https?:$/.test(parsed.protocol)) {
        args.error = args.error || `invalid --base-url "${v}" (expected http(s) chat/completions URL)`;
        break;
      }
      args.baseUrl = v;
    } else if (a === "--tasks" || a === "--task") {
      const v = value(a, i);
      i += 1;
      if (v === undefined) break;
      args.tasks = v.split(",").map((s) => s.trim()).filter(Boolean);
      if (args.tasks.length === 0) args.tasks = null;
    } else if (a === "--out") {
      const v = value(a, i);
      i += 1;
      if (v === undefined) break;
      args.out = v;
    } else if (a === "--max-turns") {
      const v = value(a, i);
      i += 1;
      if (v === undefined) break;
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 50) {
        args.error = args.error || `invalid --max-turns "${v}" (expected integer 1..50)`;
        break;
      }
      args.maxTurns = n;
    } else if (a === "--max-tokens") {
      const v = value(a, i);
      i += 1;
      if (v === undefined) break;
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n < 256 || n > 131072) {
        args.error = args.error || `invalid --max-tokens "${v}" (expected integer 256..131072)`;
        break;
      }
      args.maxTokens = n;
    } else if (a === "--timeout-ms") {
      const v = value(a, i);
      i += 1;
      if (v === undefined) break;
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n < 10000 || n > 900000) {
        args.error = args.error || `invalid --timeout-ms "${v}" (expected integer 10000..900000)`;
        break;
      }
      args.timeoutMs = n;
    } else if (a === "--api-key") {
      const v = value(a, i);
      i += 1;
      if (v === undefined) break;
      args.apiKey = v;
    } else if (a === "--check") {
      args.check = true;
    } else if (a === "--keep-sandboxes") {
      args.keepSandboxes = true;
    } else if (a === "-h" || a === "--help") {
      args.help = true;
    } else {
      args.error = args.error || `unknown argument "${a}"`;
      break;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// API key + endpoint resolution:
//   --api-key > OPENCODE_API_KEY > ZEN_API_KEY > ZHIPUAI_API_KEY (legacy)
//   > models.local.json { api_key, base_url, model, vendor, extra_headers }
//     (legacy `zhipu_api_key` field maps to the Zhipu channel defaults)
// ---------------------------------------------------------------------------

function envKey(env, name) {
  const v = env && env[name] ? String(env[name]).trim() : "";
  return v;
}

export function resolveLiveApiKey({
  cliKey = null,
  env = process.env,
  localConfigPath = null,
} = {}) {
  const noKey = { key: null, source: null, baseUrl: null, model: null, extraHeaders: {}, vendor: null };
  if (cliKey && String(cliKey).trim()) {
    return { key: String(cliKey).trim(), source: "--api-key", baseUrl: null, model: null, extraHeaders: {}, vendor: null };
  }
  const opencodeEnv = envKey(env, "OPENCODE_API_KEY") || envKey(env, "ZEN_API_KEY");
  if (opencodeEnv) {
    return {
      key: opencodeEnv,
      source: envKey(env, "OPENCODE_API_KEY") ? "OPENCODE_API_KEY" : "ZEN_API_KEY",
      baseUrl: null,
      model: null,
      extraHeaders: {},
      vendor: "opencode",
    };
  }
  const zhipuEnv = envKey(env, "ZHIPUAI_API_KEY");
  if (zhipuEnv) {
    return {
      key: zhipuEnv,
      source: "ZHIPUAI_API_KEY",
      baseUrl: ZHIPU_CHAT_COMPLETIONS_URL,
      model: "glm-4-flash",
      extraHeaders: {},
      vendor: "zhipu",
    };
  }
  const cfgPath = localConfigPath || defaultLocalConfigPath();
  try {
    const raw = readFileSync(cfgPath, "utf8");
    const config = JSON.parse(raw);
    if (!config || typeof config !== "object") return noKey;
    const apiKey = typeof config.api_key === "string" ? config.api_key.trim() : "";
    if (apiKey) {
      return {
        key: apiKey,
        source: "models.local.json",
        baseUrl: typeof config.base_url === "string" && config.base_url.trim() ? config.base_url.trim() : null,
        model: typeof config.model === "string" && config.model.trim() ? config.model.trim() : null,
        extraHeaders:
          config.extra_headers && typeof config.extra_headers === "object" && !Array.isArray(config.extra_headers)
            ? { ...config.extra_headers }
            : {},
        vendor: typeof config.vendor === "string" && config.vendor.trim() ? config.vendor.trim() : null,
      };
    }
    const legacy = typeof config.zhipu_api_key === "string" ? config.zhipu_api_key.trim() : "";
    if (legacy) {
      return {
        key: legacy,
        source: "models.local.json (legacy zhipu_api_key)",
        baseUrl: ZHIPU_CHAT_COMPLETIONS_URL,
        model: "glm-4-flash",
        extraHeaders: {},
        vendor: "zhipu",
      };
    }
  } catch {
    // Missing or malformed models.local.json simply means no key from this source.
  }
  return noKey;
}

/**
 * Effective runtime configuration: CLI flags win, then the resolution channel's
 * pinned defaults (models.local.json base_url/model/extra_headers), then the
 * OpenCode Zen defaults. Pure; exported for offline tests.
 */
export function resolveRuntimeConfig({ args, resolution } = {}) {
  const cli = args || {};
  const res = resolution || { baseUrl: null, model: null, extraHeaders: {}, vendor: null };
  return {
    apiKey: res.key,
    keySource: res.source,
    model: cli.model || res.model || DEFAULT_MODEL,
    baseUrl: cli.baseUrl || res.baseUrl || DEFAULT_BASE_URL,
    extraHeaders: { ...(res.extraHeaders || {}) },
    vendor: res.vendor || null,
  };
}

function printAuthGuidance(resolution) {
  console.error("✖ No API key available — live eval performs REAL model calls and refuses to fabricate data.");
  console.error("  Key resolution order:");
  console.error("    1. --api-key <key>                     CLI argument");
  console.error("    2. OPENCODE_API_KEY / ZEN_API_KEY      environment variables (OpenCode Zen)");
  console.error("    3. ZHIPUAI_API_KEY                     environment variable (legacy Zhipu channel)");
  console.error('    4. models.local.json (repo root, git-ignored) — {"api_key": "<key>", "base_url": "https://opencode.ai/zen/go/v1/chat/completions", "model": "mimo-v2.6-flash", "extra_headers": {"x-opencode-session": "<session>"}}');
  if (resolution && resolution.source === null && resolution.probeError) {
    console.error(`  Note: ${resolution.probeError}`);
  }
  console.error("  Verify connectivity with: npm run benchmark:live -- --check");
}

// ---------------------------------------------------------------------------
// OpenAI-compatible chat client (injectable transport for offline tests)
// ---------------------------------------------------------------------------

async function fetchTransport({ url, headers, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function responseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url);
  }
}

/**
 * Zen gateway (opencode.ai) rejects requests lacking x-opencode-session with
 * 400 MissingSessionID. Auto-inject a default session header for that host
 * unless the caller already supplied one (models.local.json extra_headers
 * or an explicit argument).
 */
function withSessionHeader(baseUrl, extraHeaders) {
  const hasSession = Object.keys(extraHeaders || {}).some(
    (k) => k.toLowerCase() === OPENCODE_SESSION_HEADER
  );
  if (hasSession || !/opencode\.ai$/i.test(hostOf(baseUrl))) {
    return {};
  }
  return { [OPENCODE_SESSION_HEADER]: OPENCODE_SESSION_DEFAULT };
}

/**
 * Factory: creates an OpenAI-compatible chat-completions client with an
 * injectable transport.
 * transport: async ({ url, headers, body, timeoutMs }) -> { ok, status, json(), text() }
 * Returns { chat, model, totals } where chat(request) resolves to
 * { content, finishReason, usage: {promptTokens, completionTokens, totalTokens}, latencyMs, raw }.
 */
export function createLiveClient({
  apiKey = null,
  model = DEFAULT_MODEL,
  baseUrl = DEFAULT_BASE_URL,
  extraHeaders = {},
  transport = fetchTransport,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  temperature = 0.2,
  maxTokens = DEFAULT_MAX_TOKENS,
} = {}) {
  const totals = { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };

  async function chat({ messages, temperature: reqTemperature, maxTokens: reqMaxTokens } = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...withSessionHeader(baseUrl, extraHeaders),
      ...extraHeaders,
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const body = {
      model,
      messages,
      temperature: reqTemperature ?? temperature,
      max_tokens: reqMaxTokens ?? maxTokens,
      stream: false,
    };

    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const startedAt = performance.now();
      try {
        const response = await transport({ url: baseUrl, headers, body, timeoutMs });
        const latencyMs = performance.now() - startedAt;
        if (!response.ok) {
          const detail = await responseText(response);
          const err = new Error(`Live API HTTP ${response.status} (${hostOf(baseUrl)}): ${detail.slice(0, 500)}`);
          err.status = response.status;
          if (isRetryableStatus(response.status) && attempt < maxRetries) {
            lastError = err;
            await sleep(300 * (attempt + 1));
            continue;
          }
          throw err;
        }
        const data = await response.json();
        const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
        const content = choice && choice.message && typeof choice.message.content === "string"
          ? choice.message.content
          : "";
        const usage = (data && data.usage) || {};
        const usageDelta = {
          promptTokens: Number(usage.prompt_tokens) || 0,
          completionTokens: Number(usage.completion_tokens) || 0,
          totalTokens: Number(usage.total_tokens) || 0,
        };
        totals.promptTokens += usageDelta.promptTokens;
        totals.completionTokens += usageDelta.completionTokens;
        totals.totalTokens += usageDelta.totalTokens || (usageDelta.promptTokens + usageDelta.completionTokens);
        totals.calls += 1;
        return {
          content,
          finishReason: (choice && choice.finish_reason) || null,
          usage: {
            promptTokens: usageDelta.promptTokens,
            completionTokens: usageDelta.completionTokens,
            totalTokens: usageDelta.totalTokens || (usageDelta.promptTokens + usageDelta.completionTokens),
          },
          latencyMs,
          raw: data,
        };
      } catch (err) {
        if (err && err.status !== undefined) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          await sleep(300 * (attempt + 1));
          continue;
        }
      }
    }
    throw new Error(`Live API request failed after ${maxRetries + 1} attempt(s): ${lastError && lastError.message}`);
  }

  return {
    chat,
    model,
    baseUrl,
    totals: () => ({ ...totals }),
  };
}

function safeTotals(client) {
  if (client && typeof client.totals === "function") {
    const t = client.totals();
    return {
      prompt: t.promptTokens || 0,
      completion: t.completionTokens || 0,
      total: t.totalTokens || (t.promptTokens || 0) + (t.completionTokens || 0),
      calls: t.calls || 0,
    };
  }
  return { prompt: 0, completion: 0, total: 0, calls: 0 };
}

// ---------------------------------------------------------------------------
// Secret redaction (results JSON must never trip scripts/build.mjs compliance scan)
// ---------------------------------------------------------------------------

export const SECRET_REDACTION_PATTERNS = [
  { re: /sk-[A-Za-z0-9]{20,}/g, mask: "sk-[REDACTED]" },
  { re: /AKIA[0-9A-Z]{16}/g, mask: "AKIA[REDACTED]" },
  { re: /Bearer\s+[A-Za-z0-9._-]{16,}/g, mask: "Bearer [REDACTED]" },
  { re: /\/Users\/[A-Za-z0-9._-]+/g, mask: "/Users/[REDACTED]" },
];

export function redactSecrets(value) {
  if (typeof value === "string") {
    let out = value;
    for (const { re, mask } of SECRET_REDACTION_PATTERNS) {
      out = out.replace(re, mask);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[redactSecrets(k)] = redactSecrets(v);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Model output parsing: <file path="..."> blocks (primary) and fenced fallbacks
// ---------------------------------------------------------------------------

export function normalizeForMatching(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

export function extractFileBlocks(text) {
  const source = String(text || "");
  const replaceBlocks = [];
  const results = [];

  // 1. Surgical block replacement:
  //    <replace path="..."><target>...</target><replacement>...</replacement></replace>
  //    or <edit path="..."><old>...</old><new>...</new></edit>
  //    or <replace path="..."><<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE</replace>
  const replaceTagRe = /<(?:replace|edit)\s+path\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/(?:replace|edit)>/gi;
  for (const match of source.matchAll(replaceTagRe)) {
    const rel = normalizeRelPath(match[1].trim());
    if (!rel) continue;
    const body = match[2] || "";

    const targetMatch = /<(?:target|old|search)>([\s\S]*?)<\/(?:target|old|search)>/i.exec(body);
    const replMatch = /<(?:replacement|new)>([\s\S]*?)<\/(?:replacement|new)>/i.exec(body);
    if (targetMatch && replMatch) {
      replaceBlocks.push({
        type: "replace",
        path: rel,
        target: targetMatch[1].replace(/^\r?\n/, "").replace(/\r?\n$/, ""),
        replacement: replMatch[1].replace(/^\r?\n/, "").replace(/\r?\n$/, ""),
      });
      continue;
    }

    const searchReplaceRe = /<{5,9}\s*(?:SEARCH|TARGET|OLD)?\r?\n([\s\S]*?)\r?\n={5,9}\r?\n([\s\S]*?)\r?\n>{5,9}\s*(?:REPLACE|REPLACEMENT|NEW)?/gi;
    for (const sm of body.matchAll(searchReplaceRe)) {
      replaceBlocks.push({
        type: "replace",
        path: rel,
        target: sm[1],
        replacement: sm[2],
      });
    }
  }

  const tagRe = /<file\s+path\s*=\s*["']([^"']+)["']\s*>\n?([\s\S]*?)<\/file>/gi;
  for (const match of source.matchAll(tagRe)) {
    results.push({ path: match[1].trim(), content: stripLeadingNewline(match[2]) });
  }

  if (results.length === 0 && replaceBlocks.length === 0) {
    // Fenced block with an explicit path in the info string:
    // ```js path=src/x.js   |   ```src/x.js   |   ```js file="src/x.js"
    const fenceRe = /```([^\n`]*)\n([\s\S]*?)```/g;
    for (const match of source.matchAll(fenceRe)) {
      const info = match[1] || "";
      let filePath = null;
      const kv = info.match(/(?:path|file)\s*=\s*["']?([^\s"']+)["']?/i);
      if (kv) {
        filePath = kv[1];
      } else {
        const token = info.trim().split(/\s+/).find((t) =>
          /\.(js|mjs|cjs|json|ts|md|txt)$/i.test(t) || t.includes("/"));
        if (token && !/^(js|javascript|mjs|cjs|json|ts|typescript|node|bash|sh|text)$/i.test(token)) {
          filePath = token;
        }
      }
      if (filePath) {
        results.push({ path: filePath.trim(), content: stripLeadingNewline(match[2]) });
      }
    }
  }

  if (results.length === 0 && replaceBlocks.length === 0) {
    // "### File: src/x.js" header immediately followed by a fenced block
    const headerRe = /(?:^|\n)#{2,4}\s*(?:File|Path)\s*:\s*`?([^\n`]+?)`?\s*\n+```[^\n]*\n([\s\S]*?)```/g;
    for (const match of source.matchAll(headerRe)) {
      results.push({ path: match[1].trim(), content: stripLeadingNewline(match[2]) });
    }
  }

  // Later blocks for the same path override earlier ones (model revisions).
  const byPath = new Map();
  for (const block of results) {
    const rel = normalizeRelPath(block.path);
    if (rel) {
      byPath.set(rel, { path: rel, content: block.content });
    }
  }
  return [...replaceBlocks, ...Array.from(byPath.values())];
}

function stripLeadingNewline(content) {
  return String(content || "").replace(/^\n/, "").replace(/\s+$/, "\n");
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export function buildTestCatalog(task) {
  return (task.groundTruthTests || []).map((gt, index) => ({
    index: index + 1,
    name: gt.name,
    source: String(gt.run),
  }));
}

function renderTestCatalog(task) {
  return buildTestCatalog(task)
    .map((entry) => `### Test ${entry.index}: ${entry.name}\n` + "```js\n" + entry.source + "\n```")
    .join("\n\n");
}

export function buildSoloSystemPrompt() {
  return [
    "You are an autonomous senior software engineer repairing a Node.js ESM repository.",
    "You iterate: after each of your replies, the repository test suite runs and you receive its complete output.",
    FILE_TAG_PROTOCOL,
  ].join("\n\n");
}

export function buildSoloUserPrompt(task) {
  return [
    `Task: ${task.name} (${task.id})`,
    `Category: ${task.category}`,
    "",
    "Problem statement:",
    task.description,
    "",
    `Implementation entry point (an incomplete stub already exists there — replace it):`,
    `  ${normalizeRelPath(task.allowedPaths[0])} — ES module with a default export (the system under test).`,
    "",
    "Ground-truth acceptance tests (executed against the default export):",
    renderTestCatalog(task),
    "",
    "Write the implementation so that every test passes.",
  ].join("\n");
}

/**
 * Scoping-interview contract aligned with protocol/scoping-interview.md:
 * objective, goal-behind-goal, deliverable shape lock, deterministic acceptance,
 * non-goals (boundaries), verification anchor, and risk tier via resolveMilestoneTopology.
 */
export function buildScopingContract(task) {
  const topology = resolveMilestoneTopology(
    {
      title: task.name,
      done: task.description,
      items: [{ detail: task.category, allowedPaths: task.allowedPaths }],
    },
    "hybrid"
  );
  return {
    taskId: task.id,
    primaryGoal: task.description,
    goalBehindGoal:
      "A benchmark-verified repair: the deterministic ground-truth suite must exit 0 with zero " +
      "scope violations. Downstream automation trusts the verifier exit code and the boundary " +
      "ledger — never prose claims.",
    deliverableShapeLock: {
      entryFile: normalizeRelPath(task.allowedPaths[0]),
      exportShape: "ES module default export (the system under test); the export shape must not change",
      allowedPaths: task.allowedPaths.map(normalizeRelPath),
    },
    acceptanceCriteria: [
      "node run-tests.mjs (deterministic verifier subprocess) exits with code 0",
      "Zero out-of-bounds writes (physical path lock enforced by findOutOfBoundsFiles)",
    ],
    outOfScope: [
      "Every repository path outside the allowed write boundary",
      ...task.forbiddenPaths.map((p) => `Explicitly forbidden: ${normalizeRelPath(p)}`),
    ],
    verificationAnchor: "node run-tests.mjs — ground-truth suite; subprocess exit code is the single source of truth",
    topology,
  };
}

export function renderScopingContract(contract) {
  return [
    `# Initiative Scope: ${contract.primaryGoal}`,
    `- Entry file: ${contract.deliverableShapeLock.entryFile} (${contract.deliverableShapeLock.exportShape})`,
    `- Allowed write boundary: ${contract.deliverableShapeLock.allowedPaths.join(", ")}`,
    `- Acceptance: verifier subprocess exits 0 with zero out-of-bounds writes`,
    `- Risk Tier: ${contract.topology.risk}`,
  ].join("\n");
}

export function buildTopologyDirectives(topology) {
  const directives = [
    `TOPOLOGY ROUTING: risk=${topology.risk}, workerTier=${topology.workerTier}.`,
  ];
  if (topology.criticStrictness === "exhaustive" || topology.criticStrictness === "strict") {
    directives.push(
      `Critic (${topology.criticStrictness}): verify edge cases implied by the tests.`
    );
  }
  if (topology.adversarialChallenger) {
    directives.push(
      "ADVERSARIAL CHALLENGER: attack your own solution before claiming completion."
    );
  }
  if (topology.requireMicroTest) {
    directives.push(
      "MICRO-TEST: state one empirical check proving the riskiest branch is fixed."
    );
  }
  return directives.join("\n");
}

export function buildTeamworkSystemPrompt(task) {
  const contract = buildScopingContract(task);
  return [
    "You are a worker agent executing inside the agent-teamwork collaboration engine.",
    "A scoping interview has locked the initiative contract below; you must honor it exactly.",
    "",
    renderScopingContract(contract),
    "",
    "Execution discipline (enforced by engine):",
    "- PATH LOCK: Out-of-bounds writes are blocked before reaching disk. Modify ONLY allowed paths.",
    "- VERIFICATION: Subprocess exit code 0 is the single source of truth. Prose claims are ignored.",
    `- STAGNATION EARLY-STOP: ${STAGNATION_THRESHOLD} consecutive identical failure signatures after code edits trigger replan / abort.`,
    "",
    buildTopologyDirectives(contract.topology),
    "",
    FILE_TAG_PROTOCOL,
  ].join("\n");
}

export function buildTeamworkUserPrompt(task) {
  const contract = buildScopingContract(task);
  return [
    `Initiative: ${task.name} (${task.id})`,
    `Category: ${task.category}`,
    "",
    `Milestone M1 deliverable: implement ${contract.deliverableShapeLock.entryFile} so the ground-truth suite passes.`,
    "",
    "Problem statement:",
    task.description,
    "",
    "Ground-truth acceptance tests (executed against the default export):",
    renderTestCatalog(task),
    "",
    "The entry file currently contains a deterministic incomplete starter stub. Begin milestone M1.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// False-victory detection (heuristic; STATUS line is the primary channel)
// ---------------------------------------------------------------------------

export const DONE_CLAIM_PATTERNS = [
  /(^|\n)\s*status:\s*done\s*(\n|$)/i,
  /\ball\s+\d+\s+tests?\s+(?:pass|passed|passing)\b/i,
  /\ball\s+tests?\s+(?:are\s+)?(?:passed|passing|green)\b/i,
  /(?<!make )(?<!to )(?<!should )(?<!must )(?<!will )(?<!let )(?<!help )(?<!ensure )\ball\s+tests?\s+pass\b/i,
  /\btests?\s+are\s+(?:all\s+)?(?:passing|green)\b/i,
  /\bevery\s+test\s+passes\b/i,
    /所有(?:的)?(?:测试|断言|用例)(?:都|全部|均|已)*(?:通过|成功|绿灯)/,
  /全部(?:测试|断言|用例)?通过/,
  /\b(?:implementation|solution|fix)\s+is\s+(?:complete|correct|verified)\b/i,
];

export function detectDoneClaim(text) {
  const source = String(text || "");
  return DONE_CLAIM_PATTERNS.some((re) => re.test(source));
}

// ---------------------------------------------------------------------------
// Sandbox factory (os.tmpdir, git-initialized, deterministic incomplete starter)
// ---------------------------------------------------------------------------

export function starterContentFor(task) {
  return [
    `// live-eval deterministic starter stub (task ${task.id})`,
    "// This file is intentionally incomplete — replace it with the real implementation.",
    `export default function liveEvalStarterStub${task.id.replace(/[^A-Za-z0-9]/g, "")}() {`,
    `  throw new Error("live-eval starter stub: implementation missing for ${task.id}");`,
    "}",
    "",
  ].join("\n");
}

function git(dir, args) {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (result.error) {
    throw new Error(`git is unavailable (${result.error.message}); live-eval sandboxes require git.`);
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (exit ${result.status}): ${(result.stderr || "").slice(0, 300)}`);
  }
  return result.stdout || "";
}

export function parseGitStatus(porcelain) {
  const paths = [];
  for (const line of String(porcelain || "").split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed.trim()) continue;
    const info = trimmed.slice(3);
    if (info.includes(" -> ")) {
      for (const part of info.split(" -> ")) {
        if (part.trim()) paths.push(part.trim().replace(/\/+$/, ""));
      }
    } else if (info.trim()) {
      // Strip directory-form trailing slashes: without -uall, git porcelain
      // collapses wholly untracked directories to "dir/" entries which never
      // match an allowedPaths file whitelist one level deeper and would read
      // as false out-of-bounds pollution.
      paths.push(info.trim().replace(/\/+$/, ""));
    }
  }
  return paths;
}

export function createSandbox({ task, track, parentDir = null }) {
  const dir = mkdtempSync(path.join(parentDir || os.tmpdir(), `live-eval-${track}-${task.id}-`));
  const targetRel = normalizeRelPath(task.allowedPaths[0]);
  if (!targetRel) {
    throw new Error(`Task ${task.id} has no allowedPaths entry for the implementation entry file.`);
  }
  const targetAbs = path.join(dir, targetRel);
  mkdirSync(path.dirname(targetAbs), { recursive: true });

  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: `live-eval-sandbox-${task.id.toLowerCase()}`, private: true, type: "module" }, null, 2) + "\n"
  );
  // run-tests.mjs is regenerated per run inside the sandbox; keep it out of pollution accounting.
  writeFileSync(path.join(dir, ".gitignore"), "node_modules/\nrun-tests.mjs\n");
  writeFileSync(targetAbs, starterContentFor(task));

  git(dir, ["-c", "init.defaultBranch=main", "init", "--quiet"]);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.name=live-eval", "-c", "user.email=live-eval@localhost", "commit", "--quiet", "-m", "live-eval sandbox init: deterministic incomplete starter"]);

  return {
    dir,
    track,
    taskId: task.id,
    targetRel,
    gitStatus: () => git(dir, ["status", "--porcelain", "-uall"]),
    cleanup(keep = false) {
      if (keep) return dir;
      rmSync(dir, { recursive: true, force: true });
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Real test executor: subprocess with a true process exit code
// ---------------------------------------------------------------------------

export function buildRunTestsScript({ taskId, sandboxDir, targetRel, tasksModulePath: tasksPath }) {
  const lines = [
    "// Auto-generated by benchmarks/live-eval.mjs — ground-truth verifier subprocess.",
    "// Runs the canonical task's groundTruthTests against the sandbox target module's",
    "// default export. process.exitCode === 0 <=> every assertion passed (Pass@1 source of truth).",
    'import path from "node:path";',
    'import { pathToFileURL } from "node:url";',
    "",
    "const taskId = " + JSON.stringify(taskId) + ";",
    'const nonce = process.argv[2] || "0";',
    "const tasksModulePath = " + JSON.stringify(tasksPath) + ";",
    "const sandboxTarget = path.resolve(" + JSON.stringify(sandboxDir) + ", " + JSON.stringify(targetRel) + ");",
    "",
    "const mod = await import(pathToFileURL(tasksModulePath).href);",
    "const task = (mod.BENCHMARK_TASKS || []).find((t) => t.id === taskId);",
    "if (!task) {",
    '  console.error("run-tests: unknown task id: " + taskId);',
    "  process.exit(2);",
    "}",
    "let implModule;",
    "try {",
    '  implModule = await import(pathToFileURL(sandboxTarget).href + "?v=" + encodeURIComponent(nonce));',
    "} catch (err) {",
    '  console.error("run-tests: failed to import target module ' + targetRel + ': " + (err && err.message));',
    "  process.exit(1);",
    "}",
    "const impl = implModule.default;",
    "if (typeof impl === \"undefined\") {",
    '  console.error("run-tests: target module has no default export: ' + targetRel + '");',
    "  process.exit(1);",
    "}",
    "const tests = task.groundTruthTests || [];",
    "let failed = 0;",
    "let index = 0;",
    "for (const gt of tests) {",
    "  index += 1;",
    "  try {",
    "    await gt.run(impl);",
    '    console.log("PASS " + index + "/" + tests.length + " :: " + gt.name);',
    "  } catch (err) {",
    "    failed += 1;",
    '    console.error("FAIL " + index + "/" + tests.length + " :: " + gt.name);',
    '    console.error("    " + String((err && (err.stack || err.message)) || err).split("\\n").slice(0, 6).join("\\n    "));',
    "  }",
    "}",
    'console.log("run-tests summary: task=" + taskId + " total=" + tests.length + " failed=" + failed);',
    "process.exitCode = failed > 0 ? 1 : 0;",
  ];
  return lines.join("\n") + "\n";
}

export function writeRunTestsScript({ sandboxDir, taskId, targetRel }) {
  const source = buildRunTestsScript({ taskId, sandboxDir, targetRel, tasksModulePath });
  writeFileSync(path.join(sandboxDir, "run-tests.mjs"), source);
  return path.join(sandboxDir, "run-tests.mjs");
}

export function runTestsInSandbox({ sandboxDir, taskId, targetRel, nonce = "0" }) {
  writeRunTestsScript({ sandboxDir, taskId, targetRel });
  const result = spawnSync(process.execPath, ["run-tests.mjs", String(nonce)], {
    cwd: sandboxDir,
    encoding: "utf8",
    timeout: TEST_RUN_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const timedOut = Boolean(result.error && result.error.code === "ETIMEDOUT") || result.signal === "SIGKILL";
  const exitCode = result.status === null || result.status === undefined ? (timedOut ? 124 : 1) : result.status;
  const stderrPrefix = timedOut ? `[live-eval] verifier subprocess timed out after ${TEST_RUN_TIMEOUT_MS}ms\n` : "";
  return {
    exitCode,
    stdout: result.stdout || "",
    stderr: stderrPrefix + (result.stderr || ""),
    timedOut,
  };
}

// ---------------------------------------------------------------------------
// File writes (containment for both tracks; path lock applied by Track B caller)
// ---------------------------------------------------------------------------

export function applyWrites(sandboxDir, files) {
  const written = [];
  const escaped = [];
  const failed = [];
  for (const file of files || []) {
    const rel = normalizeRelPath(file && file.path);
    if (!rel) {
      failed.push(file && file.path ? file.path : "<empty>");
      continue;
    }
    const abs = path.resolve(sandboxDir, rel);
    if (abs !== sandboxDir && !abs.startsWith(sandboxDir + path.sep)) {
      escaped.push(rel); // Never write outside the sandbox, regardless of track.
      continue;
    }

    if (file.type === "replace") {
      try {
        if (!existsSync(abs)) {
          failed.push(`${rel}: file does not exist for surgical replace`);
          continue;
        }
        let original = readFileSync(abs, "utf8");
        const target = typeof file.target === "string" ? file.target : "";
        const replacement = typeof file.replacement === "string" ? file.replacement : "";
        if (!target) {
          failed.push(`${rel}: empty target block`);
          continue;
        }
        if (original.includes(target)) {
          original = original.replace(target, replacement);
        } else {
          const normOriginal = normalizeForMatching(original);
          const normTarget = normalizeForMatching(target);
          const normReplacement = replacement.replace(/\r\n/g, "\n");
          if (normOriginal.includes(normTarget)) {
            original = normOriginal.replace(normTarget, normReplacement);
          } else {
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
        writeFileSync(abs, original, "utf8");
        written.push(rel);
      } catch (err) {
        failed.push(`${rel}: ${(err && err.code) || (err && err.message) || "replace-error"}`);
      }
      continue;
    }

    if (typeof file.content !== "string") {
      failed.push(rel);
      continue;
    }
    // One malformed proposal (e.g. a file "x" followed by "x/y.js" — EEXIST on
    // mkdir) must fail that single write, never kill the whole track.
    try {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, file.content);
      written.push(rel);
    } catch (err) {
      failed.push(`${rel}: ${(err && err.code) || (err && err.message) || "write-error"}`);
    }
  }
  return { written, escaped, failed };
}

export function verifySandboxSyntax(sandboxDir, writtenPaths) {
  const errors = [];
  for (const rel of writtenPaths || []) {
    const abs = path.resolve(sandboxDir, rel);
    if (!existsSync(abs)) continue;
    if (/\.(js|mjs|cjs)$/i.test(rel)) {
      const inputType = /\.cjs$/i.test(rel) ? "commonjs" : "module";
      const src = readFileSync(abs, "utf8");
      const res = spawnSync(process.execPath, [`--input-type=${inputType}`, "--check"], {
        cwd: sandboxDir,
        input: src,
        encoding: "utf8",
        timeout: 5000,
      });
      if (res.status !== 0) {
        const errText = ((res.stderr || res.stdout || "syntax error").trim()).slice(0, 400);
        errors.push(`${rel}: ${errText}`);
      }
    } else if (/\.json$/i.test(rel)) {
      try {
        JSON.parse(readFileSync(abs, "utf8"));
      } catch (err) {
        errors.push(`${rel}: invalid JSON (${err && err.message ? err.message : "parse error"})`);
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Track A — Solo (single model, naive loop, no guardrails)
// ---------------------------------------------------------------------------

function soloFeedback(run, writeReport) {
  const parts = [`The test runner exited with code ${run.exitCode}.`];
  if (writeReport.escaped.length > 0) {
    parts.push(`(Ignored non-existent paths in your reply: ${writeReport.escaped.join(", ")})`);
  }
  parts.push("Full output:");
  parts.push(run.stdout || "(no stdout)");
  if (run.stderr) {
    parts.push("--- stderr ---");
    parts.push(run.stderr);
  }
  parts.push(
    "Continue fixing the repository. Reply with file blocks. End with STATUS: DONE only when you are confident all tests pass."
  );
  return parts.join("\n");
}

export async function runSoloTrack({
  task,
  client,
  maxTurns = DEFAULT_MAX_TURNS,
  parentDir = null,
  keepSandboxes = false,
  log = () => {},
}) {
  const sandbox = createSandbox({ task, track: "baseline", parentDir });
  const startedAt = performance.now();
  const turns = [];
  const gapSignatureTrail = [];
  let falseVictoryCount = 0;
  let stagnationRounds = 0;
  let maxConsecutiveSameSignature = 0;
  let consecutive = 0;
  let lastSignature = null;
  let lastExitCode = null;
  let lastRun = null;
  let passed = false;
  let passTurn = null;
  let abortReason = null;
  let trackResult = null;

  try {
    const messages = [
      { role: "system", content: buildSoloSystemPrompt() },
      { role: "user", content: buildSoloUserPrompt(task) },
    ];

    for (let turn = 1; turn <= maxTurns; turn += 1) {
      const response = await client.chat({ messages });
      const content = response.content || "";
      const files = extractFileBlocks(content);
      // No allowedPaths lock: every proposed write lands (containment-only safety floor).
      const writeReport = applyWrites(sandbox.dir, files);
      const run = runTestsInSandbox({ sandboxDir: sandbox.dir, taskId: task.id, targetRel: sandbox.targetRel, nonce: turn });
      lastRun = run;
      lastExitCode = run.exitCode;
      const claim = detectDoneClaim(content);
      const signature = run.exitCode === 0
        ? null
        : computeGapSignature([formatFailureOutput(run.stdout, run.stderr, FAILURE_TAIL_CAP) || "unknown-failure"]);
      gapSignatureTrail.push(signature);
      const wroteFiles = writeReport.written.length > 0;
      if (run.exitCode === 0) {
        passed = true;
        passTurn = turn;
      } else {
        if (claim) falseVictoryCount += 1;
        // Write-aware stagnation: Only count stagnation when disk writes actually landed.
        // Pure reasoning/analysis turns without file modifications must not trigger false loop detection.
        if (wroteFiles) {
          if (signature === lastSignature) {
            consecutive += 1;
            stagnationRounds += 1; // recorded, never acted on — Solo has no early stop
          } else {
            consecutive = 1;
            lastSignature = signature;
          }
        }
        maxConsecutiveSameSignature = Math.max(maxConsecutiveSameSignature, consecutive);
      }
      turns.push({
        turn,
        modelChars: content.length,
        filesWritten: writeReport.written,
        escapedWrites: writeReport.escaped,
        exitCode: run.exitCode,
        claimedDone: claim,
        signature,
        latencyMs: Math.round(response.latencyMs || 0),
      });
      log(
        `    [solo t${turn}] exit=${run.exitCode} files=${writeReport.written.length} claim=${claim ? "yes" : "no"} sig=${signature ? String(signature).slice(0, 24) + "…" : "pass"}`
      );
      if (passed) break;
      if (turn === maxTurns) {
        abortReason = "turn-budget-exhausted";
        break;
      }
      messages.push({ role: "assistant", content });
      messages.push({ role: "user", content: soloFeedback(run, writeReport) });
    }

    // Pollution accounting: real workspace changes outside allowedPaths (git status).
    const changedPaths = parseGitStatus(sandbox.gitStatus());
    const outOfBoundsFiles = findOutOfBoundsFiles(changedPaths, [], task.allowedPaths);

    trackResult = {
      track: "baseline",
      pass: passed,
      passTurn,
      turnsUsed: turns.length,
      exitCode: lastExitCode,
      outOfBoundsCount: outOfBoundsFiles.length,
      outOfBoundsFiles,
      interceptedCount: 0, // Solo has no path lock — nothing is ever intercepted
      falseVictoryCount,
      stagnationRounds,
      stalled: maxConsecutiveSameSignature >= STAGNATION_THRESHOLD,
      maxConsecutiveSameSignature,
      abortReason,
      tokens: safeTotals(client),
      timeMs: performance.now() - startedAt,
      failureTail: passed
        ? ""
        : lastRun
          ? formatFailureOutput(lastRun.stdout, lastRun.stderr, FAILURE_TAIL_CAP)
          : "",
      gapSignatureTrail,
      turns,
      keptSandboxDir: null,
    };
    return trackResult;
  } finally {
    // Runs after the return expression is evaluated: mutate the returned object
    // so callers see the kept sandbox directory when --keep-sandboxes is set.
    const keptDir = sandbox.cleanup(keepSandboxes);
    if (trackResult) trackResult.keptSandboxDir = keptDir;
  }
}

// ---------------------------------------------------------------------------
// Track B — With agent-teamwork (contract + path lock + tail feed + early stop)
// ---------------------------------------------------------------------------

function teamworkFeedback({
  run,
  failureTail,
  blockedFiles,
  writeFailures = [],
  syntaxErrors = [],
  replanDirective,
  wroteFiles,
  turn = 1,
  maxTurns = DEFAULT_MAX_TURNS,
}) {
  const parts = [`[ENGINE VERIFICATION] exit code: ${run.exitCode}`];
  if (blockedFiles.length > 0) {
    parts.push(`[PATH LOCK] blocked out-of-bounds writes (NOT written, counted): ${blockedFiles.join(", ")}`);
  }
  if (writeFailures.length > 0) {
    parts.push(`[WRITE / REPLACE FAILURE] The following file edits could not be applied:\n${writeFailures.join("\n")}`);
  }
  if (syntaxErrors.length > 0) {
    parts.push(`[PRE-FLIGHT SYNTAX ERROR] Modified files failed syntax check:\n${syntaxErrors.join("\n")}`);
  }
  if (!wroteFiles) {
    parts.push(
      "[NO DISK WRITES] You produced analysis but wrote no files to disk. " +
        "Analysis alone cannot pass verification. You must emit <file path=\"...\">...</file> or <replace path=\"...\">...</replace> blocks to modify code."
    );
  }
  const remaining = Math.max(0, maxTurns - turn);
  if (remaining <= 2) {
    parts.push(
      `[BUDGET URGENCY] Only ${remaining} turn(s) remaining (turn ${turn}/${maxTurns}). Emit your concrete fix immediately.`
    );
  }
  parts.push("[PRESERVED FAILURE TAIL — formatFailureOutput]");
  parts.push(failureTail || "(no output captured)");
  if (replanDirective) {
    parts.push(
      "[STAGNATION] identical failure signature repeated after file modification — the current approach is superseded. " +
        "Replan: adopt a fundamentally different strategy; do not retry the same fix."
    );
  }
  parts.push(
    "Fix the milestone deliverable and reply with file blocks. Remember: only exit code 0 with zero blocked writes counts as success."
  );
  return parts.join("\n");
}

export async function runTeamworkTrack({
  task,
  client,
  maxTurns = DEFAULT_MAX_TURNS,
  parentDir = null,
  keepSandboxes = false,
  log = () => {},
}) {
  const sandbox = createSandbox({ task, track: "teamwork", parentDir });
  const contract = buildScopingContract(task);
  const startedAt = performance.now();
  const turns = [];
  const gapSignatureTrail = [];
  const interceptedFiles = [];
  const milestoneOutcomes = [];
  let interceptedCount = 0;
  let falseVictoryCount = 0;
  let stagnationRounds = 0;
  let maxConsecutiveSameSignature = 0;
  let consecutive = 0;
  let lastSignature = null;
  let lastExitCode = null;
  let lastRun = null;
  let lastFailureTail = "";
  let passed = false;
  let passTurn = null;
  let abortReason = null;
  let replansUsed = 0;
  let trackResult = null;

  try {
    const messages = [
      { role: "system", content: buildTeamworkSystemPrompt(task) },
      { role: "user", content: buildTeamworkUserPrompt(task) },
    ];

    for (let turn = 1; turn <= maxTurns; turn += 1) {
      const response = await client.chat({ messages });
      const content = response.content || "";
      const files = extractFileBlocks(content);

      // Physical path lock: out-of-bounds proposals are blocked before touching disk.
      const proposed = files.map((f) => normalizeRelPath(f.path)).filter(Boolean);
      const blocked = findOutOfBoundsFiles(proposed, [], task.allowedPaths);
      const blockedSet = new Set(blocked);
      for (const b of blocked) interceptedFiles.push(b);
      const allowedFiles = files.filter((f) => !blockedSet.has(normalizeRelPath(f.path)));
      const writeReport = applyWrites(sandbox.dir, allowedFiles);
      for (const e of writeReport.escaped) interceptedFiles.push(e);
      interceptedCount += blocked.length + writeReport.escaped.length;

      const wroteFiles = writeReport.written.length > 0;
      const syntaxErrors = wroteFiles ? verifySandboxSyntax(sandbox.dir, writeReport.written) : [];

      const run = runTestsInSandbox({ sandboxDir: sandbox.dir, taskId: task.id, targetRel: sandbox.targetRel, nonce: turn });
      lastRun = run;
      lastExitCode = run.exitCode;
      const failureTail = run.exitCode === 0 ? "" : formatFailureOutput(run.stdout, run.stderr, FAILURE_TAIL_CAP);
      lastFailureTail = failureTail;
      const claim = detectDoneClaim(content);
      const signature = run.exitCode === 0 ? null : computeGapSignature([failureTail || "unknown-failure"]);
      gapSignatureTrail.push(signature);

      let replanDirective = false;
      if (run.exitCode === 0) {
        passed = true;
        passTurn = turn;
      } else {
        if (claim) falseVictoryCount += 1;
        // Write-aware stagnation: Only count stagnation when disk writes actually landed.
        // Pure reasoning/analysis turns without file modifications must not trigger false loop detection.
        if (wroteFiles) {
          if (signature === lastSignature) {
            consecutive += 1;
            stagnationRounds += 1;
          } else {
            consecutive = 1;
            lastSignature = signature;
          }
        }
        maxConsecutiveSameSignature = Math.max(maxConsecutiveSameSignature, consecutive);
      }

      turns.push({
        turn,
        modelChars: content.length,
        filesWritten: writeReport.written,
        blockedFiles: blocked,
        escapedWrites: writeReport.escaped,
        exitCode: run.exitCode,
        claimedDone: claim,
        signature,
        latencyMs: Math.round(response.latencyMs || 0),
      });
      log(
        `    [team t${turn}] exit=${run.exitCode} files=${writeReport.written.length} blocked=${blocked.length} claim=${claim ? "yes" : "no"} sig=${signature ? String(signature).slice(0, 24) + "…" : "pass"}`
      );

      if (passed) break;

      if (consecutive >= STAGNATION_THRESHOLD) {
        if (replansUsed < MAX_REPLANS) {
          replansUsed += 1;
          replanDirective = true;
          milestoneOutcomes.push({
            milestone: `${task.id}-M1-attempt-${replansUsed}`,
            passed: false,
            superseded: true, // Replaced by the forced replan; excluded from openGaps.
            evidence: `stagnation: identical gap signature x${consecutive}`,
            gaps: [failureTail || "unknown-failure"],
          });
          log(`    [team t${turn}] STAGNATION -> forced replan #${replansUsed}`);
        } else {
          abortReason = "stagnation-early-stop";
          log(`    [team t${turn}] STAGNATION after replan budget -> abort`);
          break;
        }
      }

      if (turn === maxTurns) {
        abortReason = abortReason || "turn-budget-exhausted";
        break;
      }

      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: teamworkFeedback({
          run,
          failureTail,
          blockedFiles: blocked,
          writeFailures: writeReport.failed,
          syntaxErrors,
          replanDirective,
          wroteFiles,
          turn,
          maxTurns,
        }),
      });
    }

    // Strict accounting: real pollution + milestone outcomes + true exit code.
    const changedPaths = parseGitStatus(sandbox.gitStatus());
    const outOfBoundsFiles = findOutOfBoundsFiles(changedPaths, [], task.allowedPaths);
    const testsPassed = passed;
    const verifyCommandRan = turns.length > 0;
    const verifyPassed = testsPassed && outOfBoundsFiles.length === 0; // exit 0 AND zero out-of-bounds writes
    milestoneOutcomes.push({
      milestone: `${task.id}-M1-final`,
      passed: verifyPassed,
      evidence: verifyPassed
        ? `verifier exit code 0 on turn ${passTurn} with zero out-of-bounds writes`
        : testsPassed
          ? "tests passed but out-of-bounds writes landed"
          : "ground-truth suite did not pass",
      gaps: verifyPassed ? [] : [lastFailureTail || "unknown-failure"],
    });
    const openGaps = calculateTeamworkOpenGaps(milestoneOutcomes, true, verifyCommandRan, verifyPassed);
    const strictFalseVictory = (!testsPassed || outOfBoundsFiles.length > 0) && openGaps === 0;
    const conclusion = formatTeamworkConclusion(openGaps, verifyCommandRan, verifyPassed, replansUsed, "en");

    trackResult = {
      track: "teamwork",
      pass: testsPassed && outOfBoundsFiles.length === 0 && openGaps === 0,
      passTurn,
      turnsUsed: turns.length,
      exitCode: lastExitCode,
      outOfBoundsCount: outOfBoundsFiles.length,
      outOfBoundsFiles,
      interceptedCount,
      interceptedFiles,
      falseVictoryCount,
      strictFalseVictory,
      stagnationRounds,
      stalled: maxConsecutiveSameSignature >= STAGNATION_THRESHOLD,
      maxConsecutiveSameSignature,
      abortReason,
      replansUsed,
      openGaps,
      conclusion,
      topology: contract.topology,
      tokens: safeTotals(client),
      timeMs: performance.now() - startedAt,
      failureTail: passed ? "" : lastFailureTail,
      gapSignatureTrail,
      turns,
      keptSandboxDir: null,
    };
    return trackResult;
  } finally {
    // Runs after the return expression is evaluated: mutate the returned object
    // so callers see the kept sandbox directory when --keep-sandboxes is set.
    const keptDir = sandbox.cleanup(keepSandboxes);
    if (trackResult) trackResult.keptSandboxDir = keptDir;
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export function selectTasks(taskIds) {
  if (!taskIds || taskIds.length === 0) {
    return [...BENCHMARK_TASKS];
  }
  const byId = new Map(BENCHMARK_TASKS.map((t) => [t.id, t]));
  const selected = [];
  for (const rawId of taskIds) {
    const id = String(rawId).trim();
    if (!id) continue;
    const task = byId.get(id);
    if (!task) {
      throw new Error(
        `Unknown task id "${id}". Valid ids: ${BENCHMARK_TASKS.map((t) => t.id).join(", ")}`
      );
    }
    if (!selected.some((t) => t.id === id)) selected.push(task);
  }
  if (selected.length === 0) return [...BENCHMARK_TASKS];
  return selected;
}

function trackSummary(entries, track) {
  const results = entries.map((e) => e[track]).filter(Boolean);
  const total = results.length || 1;
  const passes = results.filter((r) => r.pass).length;
  const sum = (fn) => results.reduce((acc, r) => acc + (fn(r) || 0), 0);
  return {
    track,
    total: results.length,
    passes,
    passRate: results.length ? passes / results.length : 0,
    outOfBoundsTasks: results.filter((r) => r.outOfBoundsCount > 0).length,
    outOfBoundsFiles: sum((r) => r.outOfBoundsCount),
    interceptedCount: sum((r) => r.interceptedCount),
    falseVictories: sum((r) => r.falseVictoryCount),
    stalledTasks: results.filter((r) => r.stalled).length,
    stagnationRounds: sum((r) => r.stagnationRounds),
    replansUsed: sum((r) => r.replansUsed || 0),
    avgTokens: Math.round(sum((r) => r.tokens.total) / total),
    avgTimeMs: Math.round(sum((r) => r.timeMs) / total),
  };
}

export function summarize(report) {
  const entries = report.tasks || [];
  const tracks = [];
  if (entries.some((e) => e.baseline)) tracks.push(trackSummary(entries, "baseline"));
  if (entries.some((e) => e.teamwork)) tracks.push(trackSummary(entries, "teamwork"));
  const summary = { tracks };
  if (tracks.length === 2) {
    const [b, t] = tracks;
    summary.delta = {
      passRatePts: Math.round((t.passRate - b.passRate) * 1000) / 10,
      outOfBoundsFiles: t.outOfBoundsFiles - b.outOfBoundsFiles,
      falseVictories: t.falseVictories - b.falseVictories,
      tokenDeltaPct: b.avgTokens > 0 ? Math.round(((t.avgTokens - b.avgTokens) / b.avgTokens) * 1000) / 10 : null,
      timeDeltaPct: b.avgTimeMs > 0 ? Math.round(((t.avgTimeMs - b.avgTimeMs) / b.avgTimeMs) * 1000) / 10 : null,
    };
  }
  return summary;
}

function failedTrackResult({ track, task, err, startedAt, client }) {
  const base = {
    track,
    pass: false,
    passTurn: null,
    turnsUsed: 0,
    exitCode: null,
    outOfBoundsCount: 0,
    outOfBoundsFiles: [],
    interceptedCount: 0,
    interceptedFiles: [],
    falseVictoryCount: 0,
    stagnationRounds: 0,
    stalled: false,
    maxConsecutiveSameSignature: 0,
    abortReason: `track-error: ${String((err && err.message) || err).slice(0, 200)}`,
    tokens: safeTotals(client),
    timeMs: performance.now() - startedAt,
    failureTail: String((err && err.stack) || err).slice(0, FAILURE_TAIL_CAP),
    gapSignatureTrail: [],
    turns: [],
    keptSandboxDir: null,
  };
  if (task && track === "teamwork") {
    let topology = null;
    try {
      topology = buildScopingContract(task).topology;
    } catch {
      topology = null;
    }
    return {
      ...base,
      replansUsed: 0,
      openGaps: 1,
      strictFalseVictory: false,
      conclusion: formatTeamworkConclusion(1, false, false, 0, "en"),
      topology,
    };
  }
  return base;
}

export async function runLiveEval(config = {}) {
  const {
    mode = "ab",
    model = DEFAULT_MODEL,
    baseUrl = DEFAULT_BASE_URL,
    extraHeaders = {},
    taskIds = null,
    maxTurns = DEFAULT_MAX_TURNS,
    maxTokens = DEFAULT_MAX_TOKENS,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    out = null,
    keepSandboxes = false,
    apiKey = null,
    clientFactory = null,
    parentDir = null,
    log = () => {},
  } = config;

  if (!["ab", "baseline", "teamwork"].includes(mode)) {
    throw new Error(`Invalid mode "${mode}" (expected ab|baseline|teamwork)`);
  }
  const tracks = mode === "ab" ? ["baseline", "teamwork"] : [mode];
  const tasks = selectTasks(taskIds);

  const taskEntries = [];
  for (const task of tasks) {
    const entry = { id: task.id, name: task.name, category: task.category };
    for (const track of tracks) {
      const startedAt = performance.now();
      let client = null;
      try {
        client = clientFactory
          ? clientFactory({ track, task })
          : createLiveClient({ apiKey, model, baseUrl, extraHeaders, maxTokens, timeoutMs });
        const result = track === "baseline"
          ? await runSoloTrack({ task, client, maxTurns, parentDir, keepSandboxes, log })
          : await runTeamworkTrack({ task, client, maxTurns, parentDir, keepSandboxes, log });
        entry[track] = result;
      } catch (err) {
        // An API/infra failure on one task-track must not silently kill the whole eval:
        // record it as a failed track with the error surfaced in the report.
        log(`    [${track}] TRACK ERROR: ${String((err && err.message) || err).slice(0, 200)}`);
        entry[track] = failedTrackResult({ track, task, err, startedAt, client });
      }
    }
    taskEntries.push(entry);
  }

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      suite: `live-eval (${model} Solo vs ${model} + agent-teamwork)`,
      mode,
      model,
      maxTurns,
      node: process.version,
      platform: `${os.platform()}/${os.arch()}`,
      api: baseUrl,
      tasksSelected: taskEntries.map((e) => e.id),
      keepSandboxes,
      injectionSource: clientFactory ? "clientFactory (offline/injected)" : `live-http (${hostOf(baseUrl)})`,
    },
    tasks: taskEntries,
  };
  report.summary = summarize(report);

  // Sanitize before persisting: model output text must never carry secret-shaped strings.
  const sanitized = redactSecrets(report);
  if (out) {
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    writeFileSync(path.resolve(out), JSON.stringify(sanitized, null, 2) + "\n");
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// Console rendering
// ---------------------------------------------------------------------------

function fmtSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTokens(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function renderReport(report, log = console.log) {
  const meta = report.meta || {};
  log("================================================================================");
  log(` Live Eval Report — model=${meta.model} mode=${meta.mode} maxTurns=${meta.maxTurns} tasks=${(meta.tasksSelected || []).length}`);
  log("================================================================================");
  for (const entry of report.tasks || []) {
    log(`[${entry.id}] ${entry.name}`);
    if (entry.baseline) {
      const b = entry.baseline;
      log(
        `  Solo (A)        : ${b.pass ? "✔ PASS" : "✖ FAIL"}  exit=${b.exitCode} turns=${b.turnsUsed}` +
          ` OOB=${b.outOfBoundsCount} FV=${b.falseVictoryCount} stall=${b.stagnationRounds}${b.stalled ? "(!)" : ""}` +
          ` tok=${fmtTokens(b.tokens.total)} ${fmtSeconds(b.timeMs)}`
      );
    }
    if (entry.teamwork) {
      const t = entry.teamwork;
      log(
        `  Teamwork (B)    : ${t.pass ? "✔ PASS" : "✖ FAIL"}  exit=${t.exitCode} turns=${t.turnsUsed}` +
          ` OOB=${t.outOfBoundsCount} intercepted=${t.interceptedCount} FV=${t.falseVictoryCount}` +
          ` replans=${t.replansUsed} openGaps=${t.openGaps}${t.abortReason ? ` abort=${t.abortReason}` : ""}` +
          ` tok=${fmtTokens(t.tokens.total)} ${fmtSeconds(t.timeMs)}`
      );
      if (t.topology) {
        log(`                  risk=${t.topology.risk} tier=${t.topology.workerTier} — ${t.conclusion}`);
      }
    }
  }

  const tracks = (report.summary && report.summary.tracks) || [];
  if (tracks.length === 2) {
    const [b, t] = tracks;
    const delta = report.summary.delta || {};
    log("--------------------------------------------------------------------------------");
    log(" EXECUTIVE SCORECARD (live, verified by subprocess exit codes)");
    log("--------------------------------------------------------------------------------");
    log("| Metric                               | Solo (baseline) | + agent-teamwork | Delta          |");
    log("| :------------------------------------| :-------------: | :---------------: | :-------------: |");
    log(`| Pass@1 (exit code 0, no violations)   | ${(b.passRate * 100).toFixed(1)}% (${b.passes}/${b.total})      | **${(t.passRate * 100).toFixed(1)}% (${t.passes}/${t.total})**     | ${delta.passRatePts >= 0 ? "+" : ""}${delta.passRatePts}pts        |`);
    log(`| Out-of-bounds file pollution          | ${b.outOfBoundsTasks} tasks / ${b.outOfBoundsFiles} files | **${t.outOfBoundsTasks} tasks / ${t.outOfBoundsFiles} files** | blocked by lock  |`);
    log(`| Writes blocked by path lock           | n/a             | **${t.interceptedCount}**             | (intercepted)   |`);
    log(`| False victory claims                  | ${b.falseVictories}               | **${t.falseVictories}**             | ${delta.falseVictories <= 0 ? "" : "+"}${delta.falseVictories}              |`);
    log(`| Stalled tasks (>=2 identical sigs)    | ${b.stalledTasks}               | **${t.stalledTasks}**             | early-stopped   |`);
    log(`| Avg tokens per task                   | ~${fmtTokens(b.avgTokens)}          | **~${fmtTokens(t.avgTokens)}**        | ${delta.tokenDeltaPct === null ? "n/a" : `${delta.tokenDeltaPct >= 0 ? "+" : ""}${delta.tokenDeltaPct}%`}       |`);
    log(`| Avg wall time per task                | ${fmtSeconds(b.avgTimeMs)}            | **${fmtSeconds(t.avgTimeMs)}**          | ${delta.timeDeltaPct === null ? "n/a" : `${delta.timeDeltaPct >= 0 ? "+" : ""}${delta.timeDeltaPct}%`}       |`);
    log("--------------------------------------------------------------------------------");
  }
  const kept = (report.tasks || []).flatMap((e) => [e.baseline, e.teamwork]).filter((r) => r && r.keptSandboxDir);
  if (kept.length > 0) {
    log("Kept sandboxes (inspection):");
    for (const r of kept) log(`  [${r.track}] ${r.keptSandboxDir}`);
  }
}

function printUsage(stream = console.log) {
  stream("Usage: node benchmarks/live-eval.mjs [options]");
  stream("");
  stream("Live head-to-head eval: Solo (baseline) vs agent-teamwork (teamwork),");
  stream("running the 15 canonical SWE-bench tasks in isolated git sandboxes under os.tmpdir().");
  stream("");
  stream("Options:");
  stream("  --mode <ab|baseline|teamwork>  Track(s) to run (default: ab — both plus comparison)");
  stream("  --model <id>                   Model id (default: mimo-v2.6-flash, or models.local.json `model`)");
  stream("  --base-url <url>               OpenAI-compatible chat/completions endpoint");
  stream("                                 (default: https://opencode.ai/zen/go/v1/chat/completions)");
  stream("  --tasks <ids>                  Comma-separated task subset, e.g. SWE-JS-001,SWE-JS-004");
  stream("                                 (--task <id> is accepted as a single-task alias)");
  stream("  --out <file.json>              Write the sanitized result JSON to this path");
  stream("  --max-turns <n>                Hard per-track turn budget (default: 6, max 50)");
  stream("  --max-tokens <n>               Per-request completion budget, reasoning included");
  stream("                                 (default: 16384 — reasoning models need headroom)");
  stream("  --timeout-ms <n>               Per-request HTTP timeout (default: 420000, max 900000)");
  stream("  --api-key <key>                API key (else OPENCODE_API_KEY / ZEN_API_KEY /");
  stream("                                 ZHIPUAI_API_KEY, else models.local.json `api_key`)");
  stream("  --check                        Auth precheck + tiny probe call, then exit");
  stream("  --keep-sandboxes               Keep sandbox directories under os.tmpdir() for inspection");
  stream("  -h, --help                     Show this help");
  stream("");
  stream("models.local.json (repo root, git-ignored) schema:");
  stream('  {"api_key": "...", "base_url": "https://opencode.ai/zen/go/v1/chat/completions",');
  stream('   "model": "mimo-v2.6-flash", "vendor": "opencode",');
  stream('   "extra_headers": {"x-opencode-session": "<session-id>"}}');
  stream("");
  stream("Examples:");
  stream("  npm run benchmark:live -- --check");
  stream("  npm run benchmark:live -- --mode baseline");
  stream("  npm run benchmark:live -- --tasks SWE-JS-001,SWE-JS-002 --out live-report.json");
}

// ---------------------------------------------------------------------------
// --check: auth precheck + tiny liveness probe
// ---------------------------------------------------------------------------

async function runCheck(args) {
  const resolution = resolveLiveApiKey({ cliKey: args.apiKey });
  if (!resolution.key) {
    printAuthGuidance(resolution);
    return 2;
  }
  const runtime = resolveRuntimeConfig({ args, resolution });
  console.log(`• API key found (source: ${runtime.keySource})`);
  console.log(`• Model: ${runtime.model}`);
  console.log(`• Endpoint: ${runtime.baseUrl}`);
  const sessionHeader = { ...withSessionHeader(runtime.baseUrl, runtime.extraHeaders), ...runtime.extraHeaders }[OPENCODE_SESSION_HEADER];
  if (sessionHeader) {
    console.log(`• ${OPENCODE_SESSION_HEADER}: ${sessionHeader}`);
  }
  console.log("• Probing with a tiny completion request...");
  const client = createLiveClient({
    apiKey: runtime.apiKey,
    model: runtime.model,
    baseUrl: runtime.baseUrl,
    extraHeaders: runtime.extraHeaders,
  });
  const startedAt = performance.now();
  try {
    const response = await client.chat({ messages: [{ role: "user", content: "Reply with exactly: OK" }], maxTokens: 16 });
    const wallMs = Math.round(performance.now() - startedAt);
    console.log(
      `✔ Probe OK — finish_reason=${response.finishReason} content=${JSON.stringify(response.content.slice(0, 40))}`
    );
    console.log(
      `  api latency ${Math.round(response.latencyMs)}ms (wall ${wallMs}ms), ` +
        `usage prompt=${response.usage.promptTokens} completion=${response.usage.completionTokens}`
    );
    console.log("Live eval is ready. Try: npm run benchmark:live -- --tasks SWE-JS-001");
    return 0;
  } catch (err) {
    console.error(`✖ Probe failed: ${err.message}`);
    console.error("  Check the key validity, network access, and model id; then re-run --check.");
    return 1;
  }
}

// ---------------------------------------------------------------------------
// CLI entry (argv-guarded; importing the module has no side effects)
// ---------------------------------------------------------------------------

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return 0;
  }
  if (args.error) {
    console.error(`✖ ${args.error}`);
    console.error("");
    printUsage(console.error);
    return 2;
  }
  if (args.check) {
    return runCheck(args);
  }
  const resolution = resolveLiveApiKey({ cliKey: args.apiKey });
  if (!resolution.key) {
    printAuthGuidance(resolution);
    return 2;
  }
  const runtime = resolveRuntimeConfig({ args, resolution });
  console.log("================================================================================");
  console.log(` Live A/B Eval — model=${runtime.model} mode=${args.mode} maxTurns=${args.maxTurns} maxTokens=${args.maxTokens}`);
  console.log(` Endpoint: ${runtime.baseUrl}`);
  console.log(` API key source: ${runtime.keySource} | sandboxes: ${os.tmpdir()}/live-eval-*`);
  console.log("================================================================================");
  try {
    const report = await runLiveEval({
      mode: args.mode,
      model: runtime.model,
      baseUrl: runtime.baseUrl,
      extraHeaders: runtime.extraHeaders,
      taskIds: args.tasks,
      maxTurns: args.maxTurns,
      maxTokens: args.maxTokens,
      timeoutMs: args.timeoutMs,
      out: args.out,
      keepSandboxes: args.keepSandboxes,
      apiKey: runtime.apiKey,
      log: (line) => console.log(line),
    });
    console.log("");
    renderReport(report);
    if (args.out) {
      console.log(`\nResult JSON (sanitized) written to: ${path.resolve(args.out)}`);
    }
    // Total infra failure (every track errored before completing a single turn) must
    // not masquerade as a successful — if vacuous — evaluation run.
    const trackResults = report.tasks.flatMap((entry) =>
      ["baseline", "teamwork"].map((k) => entry[k]).filter(Boolean)
    );
    const allErrored =
      trackResults.length > 0 &&
      trackResults.every((r) => String(r.abortReason || "").startsWith("track-error:"));
    if (allErrored) {
      console.error(
        `✖ Every track execution failed before completing a turn (${trackResults[0].abortReason}) — check API key validity, quota, and network, then re-run.`
      );
      return 1;
    }
    return 0;
  } catch (err) {
    console.error(`✖ Live eval failed: ${err.message}`);
    return 1;
  }
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("✖ live-eval crashed:", err);
      process.exit(1);
    });
}
