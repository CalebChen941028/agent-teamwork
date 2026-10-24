import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  OPENCODE_ZEN_CHAT_COMPLETIONS_URL,
  ZHIPU_CHAT_COMPLETIONS_URL,
  LOCAL_CONFIG_ENV,
  parseCliArgs,
  resolveLiveApiKey,
  resolveRuntimeConfig,
  createLiveClient,
  extractFileBlocks,
  detectDoneClaim,
  createSandbox,
  applyWrites,
  parseGitStatus,
  buildRunTestsScript,
  writeRunTestsScript,
  runTestsInSandbox,
  runSoloTrack,
  runTeamworkTrack,
  runLiveEval,
  selectTasks,
  redactSecrets,
} from "../benchmarks/live-eval.mjs";
import { findOutOfBoundsFiles } from "../shared/verify-gate.js";
import { BENCHMARK_TASKS } from "../benchmarks/tasks.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const liveEvalPath = path.join(rootDir, "benchmarks", "live-eval.mjs");

/**
 * Offline test suite for benchmarks/live-eval.mjs
 * (mimo-v2.6-flash Solo vs mimo-v2.6-flash + agent-teamwork via OpenCode Zen).
 *
 * ZERO network calls by construction:
 * - Full A/B loops are driven by hand-rolled scripted clients injected via
 *   runLiveEval({ clientFactory }) / runSoloTrack / runTeamworkTrack.
 * - The HTTP layer is exercised through createLiveClient({ transport }) with a
 *   fake transport returning { ok, status, json(), text() }.
 * - The only subprocesses spawned are local node processes (run-tests.mjs
 *   verifiers and the no-key fail-fast CLI invocations, which exit before any
 *   network I/O — the models.local.json lookup is redirected to a missing path
 *   via LOCAL_CONFIG_ENV so the repo's real key is never discovered).
 */

// ---------------------------------------------------------------------------
// Shared fixtures (SWE-JS-001: Prototype Pollution Guardrail in Recursive Merge)
// ---------------------------------------------------------------------------

const SWE001 = BENCHMARK_TASKS.find((t) => t.id === "SWE-JS-001");
assert.ok(SWE001, "SWE-JS-001 must exist in the canonical task list");

// Known-good / known-bad implementations, serialized from the canonical task
// definitions (the runner's own ground truth) into ESM default-export modules.
const GOOD_IMPL = `export default ${String(SWE001.teamwork.impl)}\n`;
const BAD_IMPL = `export default ${String(SWE001.baseline.impl)}\n`;

// Compliance-safe fixtures: secret-shaped strings are assembled at runtime so
// their literals never appear in this file's source (scripts/build.mjs runs a
// clean-room scan over the whole repo and would flag them).
// "sk-" + exactly 20 alphanumerics: secret-shaped per SECRET_REDACTION_PATTERNS,
// but a perfectly legal relative file path for the sandbox filesystem.
const SECRET_STEM = ["sk-", "abcdefghijklmnopqrst"].join("");
const SECRET_PATH = `${SECRET_STEM}.js`;
const SECRET_MARKER = SECRET_STEM;
// AKIA + 16 uppercase: secret-shaped per SECRET_REDACTION_PATTERNS.
const AKIA_TOKEN = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
// Personal absolute path prefix: secret-shaped per SECRET_REDACTION_PATTERNS.
const USER_HOME = ["/Users/", "chenliangliang"].join("");

function fileBlock(filePath, content) {
  return `<file path="${filePath}">\n${content}</file>`;
}

/**
 * Fake model reply that (a) writes a failing implementation into the allowed
 * entry file, (b) proposes two out-of-bounds writes (package.json is an
 * explicit forbiddenPath of SWE-JS-001; SECRET_PATH is secret-shaped), and
 * (c) claims victory in prose ("STATUS: DONE" + "All tests pass").
 */
function polluterReply() {
  return [
    "Here is the fix.",
    fileBlock("src/utils/merge.js", BAD_IMPL),
    fileBlock("package.json", JSON.stringify({ name: "polluted", private: true, type: "module" }) + "\n"),
    fileBlock(SECRET_PATH, "leak\n"),
    "All tests pass now. STATUS: DONE",
  ].join("\n");
}

/** Fake model reply with the verified-good implementation and a done claim. */
function successReply() {
  return ["Here is the verified implementation.", fileBlock("src/utils/merge.js", GOOD_IMPL), "STATUS: DONE"].join("\n");
}

/**
 * Scripted stand-in client matching the runLiveEval clientFactory contract:
 * chat(request) -> { content, finishReason, usage, latencyMs } plus totals().
 * Repeats the last scripted reply once the script is exhausted.
 */
function makeScriptedClient(script) {
  let cursor = 0;
  const totals = { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };
  return {
    model: "scripted-fake",
    async chat() {
      const content = script[Math.min(cursor, script.length - 1)];
      cursor += 1;
      totals.promptTokens += 100;
      totals.completionTokens += 50;
      totals.totalTokens += 150;
      totals.calls += 1;
      return {
        content,
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        latencyMs: 5,
      };
    },
    totals: () => ({ ...totals }),
  };
}

function makeParentDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "live-eval-test-"));
}

function okTransportResponse(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    }),
    text: async () => "",
  };
}

// ---------------------------------------------------------------------------
// (4) CLI argument parsing and --mode validation (pure function level)
// ---------------------------------------------------------------------------

test("live-eval CLI: parseCliArgs defaults, --mode validation, value flags, and unknown-argument rejection", () => {
  // Defaults: A/B dual track, 6-turn budget; model/baseUrl stay null so the
  // resolution chain (models.local.json pin, then OpenCode Zen defaults) applies.
  const defaults = parseCliArgs([]);
  assert.equal(defaults.mode, "ab");
  assert.equal(defaults.model, null);
  assert.equal(defaults.baseUrl, null);
  assert.equal(DEFAULT_MODEL, "mimo-v2.6-flash");
  assert.equal(DEFAULT_BASE_URL, OPENCODE_ZEN_CHAT_COMPLETIONS_URL);
  assert.equal(defaults.maxTurns, 6);
  assert.equal(defaults.tasks, null);
  assert.equal(defaults.out, null);
  assert.equal(defaults.apiKey, null);
  assert.equal(defaults.check, false);
  assert.equal(defaults.keepSandboxes, false);
  assert.equal(defaults.help, false);
  assert.equal(defaults.error, null);

  // --mode accepts exactly ab|baseline|teamwork
  assert.equal(parseCliArgs(["--mode", "ab"]).mode, "ab");
  assert.equal(parseCliArgs(["--mode", "baseline"]).mode, "baseline");
  assert.equal(parseCliArgs(["--mode", "teamwork"]).mode, "teamwork");
  const badMode = parseCliArgs(["--mode", "bogus"]);
  assert.match(badMode.error, /invalid --mode "bogus" \(expected ab\|baseline\|teamwork\)/);

  // Missing value / flag-looking value => explicit error, never a silent default
  assert.match(parseCliArgs(["--mode"]).error, /--mode requires a value/);
  assert.match(parseCliArgs(["--mode", "--check"]).error, /--mode requires a value/);

  // Value flags
  assert.equal(parseCliArgs(["--model", "mimo-v2.6-flash"]).model, "mimo-v2.6-flash");
  assert.equal(
    parseCliArgs(["--base-url", "https://api.example.com/v1/chat/completions"]).baseUrl,
    "https://api.example.com/v1/chat/completions"
  );
  assert.match(
    parseCliArgs(["--base-url", "not-a-url"]).error,
    /invalid --base-url "not-a-url" \(expected http\(s\) chat\/completions URL\)/
  );
  assert.match(parseCliArgs(["--base-url", "ftp://x/y"]).error, /invalid --base-url/);
  assert.deepEqual(parseCliArgs(["--tasks", " SWE-JS-001 , SWE-JS-002 "]).tasks, ["SWE-JS-001", "SWE-JS-002"]);
  assert.deepEqual(parseCliArgs(["--task", "SWE-JS-007"]).tasks, ["SWE-JS-007"], "--task is a single-task alias of --tasks");
  assert.equal(parseCliArgs(["--out", "report.json"]).out, "report.json");
  assert.equal(parseCliArgs(["--api-key", "sk-cli"]).apiKey, "sk-cli");
  assert.equal(parseCliArgs(["--max-turns", "3"]).maxTurns, 3);
  assert.match(parseCliArgs(["--max-turns", "0"]).error, /invalid --max-turns "0"/);
  assert.match(parseCliArgs(["--max-turns", "51"]).error, /invalid --max-turns "51"/);

  // Boolean flags
  assert.equal(parseCliArgs(["--check"]).check, true);
  assert.equal(parseCliArgs(["--keep-sandboxes"]).keepSandboxes, true);
  assert.equal(parseCliArgs(["-h"]).help, true);
  assert.equal(parseCliArgs(["--help"]).help, true);

  // Unknown arguments are rejected, not ignored
  assert.match(parseCliArgs(["--frobnicate"]).error, /unknown argument "--frobnicate"/);
});

test("live-eval orchestration: runLiveEval rejects invalid modes and selectTasks resolves or rejects task ids", async () => {
  await assert.rejects(
    () => runLiveEval({ mode: "bogus", taskIds: ["SWE-JS-001"], clientFactory: () => makeScriptedClient([""]) }),
    /Invalid mode "bogus" \(expected ab\|baseline\|teamwork\)/
  );

  // selectTasks: null => all 15 canonical tasks; dedupe; unknown id => hard error listing valid ids
  assert.equal(selectTasks(null).length, 15);
  assert.equal(selectTasks([]).length, 15);
  assert.deepEqual(
    selectTasks(["SWE-JS-001", "SWE-JS-001"]).map((t) => t.id),
    ["SWE-JS-001"]
  );
  assert.throws(() => selectTasks(["SWE-JS-999"]), /Unknown task id "SWE-JS-999".*SWE-JS-001/s);
});

// ---------------------------------------------------------------------------
// (5) No-key fail-fast: API key resolution precedence
// ---------------------------------------------------------------------------

test("live-eval auth: resolveLiveApiKey precedence CLI > OPENCODE_API_KEY > ZEN_API_KEY > ZHIPUAI_API_KEY > models.local.json > none", () => {
  const keyTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-eval-key-"));
  try {
    const localConfigPath = path.join(keyTmpDir, "models.local.json");

    // 1. CLI key wins over everything
    assert.deepEqual(
      resolveLiveApiKey({ cliKey: " sk-cli ", env: { OPENCODE_API_KEY: "sk-env" }, localConfigPath }),
      { key: "sk-cli", source: "--api-key", baseUrl: null, model: null, extraHeaders: {}, vendor: null }
    );

    // 2. OPENCODE_API_KEY beats ZEN_API_KEY, the Zhipu env channel, and the file
    assert.deepEqual(
      resolveLiveApiKey({
        env: { OPENCODE_API_KEY: "sk-open", ZEN_API_KEY: "sk-zen", ZHIPUAI_API_KEY: "sk-zp" },
        localConfigPath,
      }),
      { key: "sk-open", source: "OPENCODE_API_KEY", baseUrl: null, model: null, extraHeaders: {}, vendor: "opencode" }
    );

    // 3. ZEN_API_KEY is the secondary OpenCode env channel
    assert.deepEqual(
      resolveLiveApiKey({ env: { ZEN_API_KEY: "sk-zen" }, localConfigPath }),
      { key: "sk-zen", source: "ZEN_API_KEY", baseUrl: null, model: null, extraHeaders: {}, vendor: "opencode" }
    );

    // 4. Legacy Zhipu env channel pins the Zhipu endpoint + model
    assert.deepEqual(
      resolveLiveApiKey({ env: { ZHIPUAI_API_KEY: "sk-zp" }, localConfigPath }),
      {
        key: "sk-zp",
        source: "ZHIPUAI_API_KEY",
        baseUrl: ZHIPU_CHAT_COMPLETIONS_URL,
        model: "glm-4-flash",
        extraHeaders: {},
        vendor: "zhipu",
      }
    );

    // 5. models.local.json new schema carries key + endpoint + model + session header
    fs.writeFileSync(
      localConfigPath,
      JSON.stringify({
        api_key: "  oc-local-key  ",
        base_url: "https://opencode.ai/zen/go/v1/chat/completions",
        model: "mimo-v2.6-flash",
        vendor: "opencode",
        extra_headers: { "x-opencode-session": "sess-1" },
      })
    );
    assert.deepEqual(
      resolveLiveApiKey({ env: {}, localConfigPath }),
      {
        key: "oc-local-key",
        source: "models.local.json",
        baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
        model: "mimo-v2.6-flash",
        extraHeaders: { "x-opencode-session": "sess-1" },
        vendor: "opencode",
      }
    );

    // 6. Legacy zhipu_api_key field maps to the Zhipu channel defaults
    fs.writeFileSync(localConfigPath, JSON.stringify({ zhipu_api_key: "sk-legacy" }));
    assert.deepEqual(
      resolveLiveApiKey({ env: {}, localConfigPath }),
      {
        key: "sk-legacy",
        source: "models.local.json (legacy zhipu_api_key)",
        baseUrl: ZHIPU_CHAT_COMPLETIONS_URL,
        model: "glm-4-flash",
        extraHeaders: {},
        vendor: "zhipu",
      }
    );

    // 7. Malformed local config file is tolerated (means "no key from this source")
    fs.writeFileSync(localConfigPath, "{ not valid json");
    assert.deepEqual(
      resolveLiveApiKey({ env: {}, localConfigPath }),
      { key: null, source: null, baseUrl: null, model: null, extraHeaders: {}, vendor: null }
    );

    // 8. Nothing anywhere => fail-fast signal { key: null }
    assert.deepEqual(
      resolveLiveApiKey({ env: {}, localConfigPath: path.join(keyTmpDir, "missing.json") }),
      { key: null, source: null, baseUrl: null, model: null, extraHeaders: {}, vendor: null }
    );
  } finally {
    fs.rmSync(keyTmpDir, { recursive: true, force: true });
  }
});

test("live-eval auth: resolveRuntimeConfig applies CLI > channel pin > OpenCode Zen defaults", () => {
  // Channel pin (models.local.json) wins when the CLI is silent
  const pinned = resolveRuntimeConfig({
    args: parseCliArgs([]),
    resolution: {
      key: "k",
      source: "models.local.json",
      baseUrl: "https://a.example/v1/chat/completions",
      model: "m1",
      extraHeaders: { h: "1" },
      vendor: "opencode",
    },
  });
  assert.deepEqual(pinned, {
    apiKey: "k",
    keySource: "models.local.json",
    model: "m1",
    baseUrl: "https://a.example/v1/chat/completions",
    extraHeaders: { h: "1" },
    vendor: "opencode",
  });

  // Explicit CLI flags override the channel pin
  assert.equal(
    resolveRuntimeConfig({
      args: parseCliArgs(["--model", "m2", "--base-url", "https://b.example/v1/chat/completions"]),
      resolution: { key: "k", source: "--api-key", baseUrl: "https://a.example/v1/chat/completions", model: "m1", extraHeaders: {}, vendor: null },
    }).model,
    "m2"
  );
  assert.equal(
    resolveRuntimeConfig({
      args: parseCliArgs(["--base-url", "https://b.example/v1/chat/completions"]),
      resolution: { key: "k", source: "--api-key", baseUrl: "https://a.example/v1/chat/completions", model: "m1", extraHeaders: {}, vendor: null },
    }).baseUrl,
    "https://b.example/v1/chat/completions"
  );

  // Bare env-key resolution falls through to the OpenCode Zen defaults
  assert.deepEqual(
    resolveRuntimeConfig({
      args: parseCliArgs([]),
      resolution: { key: "k", source: "OPENCODE_API_KEY", baseUrl: null, model: null, extraHeaders: {}, vendor: "opencode" },
    }),
    {
      apiKey: "k",
      keySource: "OPENCODE_API_KEY",
      model: DEFAULT_MODEL,
      baseUrl: DEFAULT_BASE_URL,
      extraHeaders: {},
      vendor: "opencode",
    }
  );
});

// ---------------------------------------------------------------------------
// (1a) Injectable transport: request shape, token accounting, retry, failures
// ---------------------------------------------------------------------------

test("live-eval client: injectable transport receives a well-formed request and token totals accumulate", async () => {
  const seen = [];
  const fakeApiKey = ["sk-test", "fake-key"].join("-");
  const client = createLiveClient({
    apiKey: fakeApiKey,
    model: "mimo-v2.6-flash",
    transport: async (req) => {
      seen.push(req);
      return okTransportResponse("hello world");
    },
  });

  const response = await client.chat({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(response.content, "hello world");
  assert.equal(response.finishReason, "stop");
  assert.deepEqual(response.usage, { promptTokens: 11, completionTokens: 7, totalTokens: 18 });

  // Transport saw the exact request shape: Zen endpoint, bearer auth,
  // auto-injected session header, model id, non-streaming
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, OPENCODE_ZEN_CHAT_COMPLETIONS_URL);
  assert.equal(seen[0].url, DEFAULT_BASE_URL);
  assert.equal(seen[0].headers.Authorization, `Bearer ${fakeApiKey}`);
  assert.equal(seen[0].headers["Content-Type"], "application/json");
  assert.equal(seen[0].headers["x-opencode-session"], "zcode-live-eval");
  assert.equal(seen[0].body.model, "mimo-v2.6-flash");
  assert.equal(seen[0].body.stream, false);
  assert.deepEqual(seen[0].body.messages, [{ role: "user", content: "hi" }]);

  // Totals accumulate across successful calls only
  await client.chat({ messages: [{ role: "user", content: "again" }] });
  assert.deepEqual(client.totals(), { promptTokens: 22, completionTokens: 14, totalTokens: 36, calls: 2 });

  // Non-Zen hosts get NO session header; explicit extra headers pass through
  const seenOther = [];
  const otherClient = createLiveClient({
    apiKey: "k",
    baseUrl: "https://api.example.com/v1/chat/completions",
    extraHeaders: { "X-Custom": "yes" },
    transport: async (req) => {
      seenOther.push(req);
      return okTransportResponse("hi");
    },
  });
  await otherClient.chat({ messages: [] });
  assert.equal(seenOther[0].url, "https://api.example.com/v1/chat/completions");
  assert.equal("x-opencode-session" in seenOther[0].headers, false, "session header is Zen-only");
  assert.equal(seenOther[0].headers["X-Custom"], "yes");

  // An explicit session header in extra_headers wins over the auto default
  const seenExplicit = [];
  const explicitClient = createLiveClient({
    apiKey: "k",
    extraHeaders: { "x-opencode-session": "custom-session" },
    transport: async (req) => {
      seenExplicit.push(req);
      return okTransportResponse("hi");
    },
  });
  await explicitClient.chat({ messages: [] });
  assert.equal(seenExplicit[0].headers["x-opencode-session"], "custom-session");
});

test("live-eval client: retryable 5xx is retried, non-retryable 4xx fails fast, exhausted retries throw", async () => {
  // 500 once, then success: exactly one retry, single successful call recorded
  let transportCalls = 0;
  const retryClient = createLiveClient({
    apiKey: "k",
    maxRetries: 1,
    transport: async () => {
      transportCalls += 1;
      if (transportCalls === 1) {
        return { ok: false, status: 500, json: async () => ({}), text: async () => "server exploded" };
      }
      return okTransportResponse("recovered");
    },
  });
  const recovered = await retryClient.chat({ messages: [] });
  assert.equal(recovered.content, "recovered");
  assert.equal(transportCalls, 2);
  assert.equal(retryClient.totals().calls, 1);

  // 400 is NOT retryable: immediate throw despite maxRetries headroom
  let badCalls = 0;
  const badClient = createLiveClient({
    apiKey: "k",
    maxRetries: 2,
    transport: async () => {
      badCalls += 1;
      return { ok: false, status: 400, json: async () => ({}), text: async () => "bad request detail" };
    },
  });
  await assert.rejects(
    () => badClient.chat({ messages: [] }),
    (err) => err.status === 400 && /Live API HTTP 400 \([^)]+\): bad request detail/.test(err.message)
  );
  assert.equal(badCalls, 1);

  // 503 with maxRetries=1: exactly 2 transport attempts, then a hard failure
  let downCalls = 0;
  const downClient = createLiveClient({
    apiKey: "k",
    maxRetries: 1,
    transport: async () => {
      downCalls += 1;
      return { ok: false, status: 503, json: async () => ({}), text: async () => "down" };
    },
  });
  await assert.rejects(
    () => downClient.chat({ messages: [] }),
    (err) => err.status === 503 && /Live API HTTP 503 \([^)]+\): down/.test(err.message)
  );
  assert.equal(downCalls, 2, "maxRetries=1 must yield exactly 2 transport attempts");
});

// ---------------------------------------------------------------------------
// (2) Sandbox factory: real os.tmpdir git sandbox, pollution accounting, cleanup
// ---------------------------------------------------------------------------

test("live-eval sandbox: created under real os.tmpdir as a clean git repo with starter stub, and fully cleaned up", () => {
  const sandbox = createSandbox({ task: SWE001, track: "test" }); // default parent => os.tmpdir()
  try {
    assert.ok(
      sandbox.dir.startsWith(os.tmpdir()),
      `sandbox must live under os.tmpdir() (got ${sandbox.dir})`
    );
    assert.equal(sandbox.track, "test");
    assert.equal(sandbox.taskId, "SWE-JS-001");
    assert.equal(sandbox.targetRel, "src/utils/merge.js");
    assert.ok(fs.existsSync(path.join(sandbox.dir, ".git")), "sandbox must be a git repository");
    assert.ok(
      fs.readFileSync(path.join(sandbox.dir, sandbox.targetRel), "utf8").includes("live-eval starter stub"),
      "entry file must contain the deterministic incomplete starter stub"
    );
    // Freshly committed sandbox is clean
    assert.equal(sandbox.gitStatus().trim(), "");
  } finally {
    const returned = sandbox.cleanup();
    assert.equal(returned, null, "cleanup() without keep must return null");
    assert.equal(fs.existsSync(sandbox.dir), false, "cleanup() must remove the sandbox directory");
  }
});

test("live-eval sandbox: git status pollution is counted via parseGitStatus + findOutOfBoundsFiles, verifier script excluded", () => {
  const sandbox = createSandbox({ task: SWE001, track: "test" });
  try {
    // parseGitStatus unit: modified, untracked, and rename lines
    assert.deepEqual(
      parseGitStatus(" M src/a.js\n?? new.txt\nR  old.js -> renamed.js\n"),
      ["src/a.js", "new.txt", "old.js", "renamed.js"]
    );

    // Model-style pollution: an allowed write plus two out-of-bounds writes
    // (both inside tracked or root locations so git porcelain lists the files themselves)
    const writeReport = applyWrites(sandbox.dir, [
      { path: "src/utils/merge.js", content: GOOD_IMPL },
      { path: "src/utils/stray.js", content: "stray sibling\n" },
      { path: SECRET_PATH, content: "leak\n" },
    ]);
    assert.deepEqual(
      [...writeReport.written].sort(),
      [SECRET_PATH, "src/utils/merge.js", "src/utils/stray.js"].sort()
    );
    assert.deepEqual(writeReport.escaped, [], "sandbox-internal paths must never be rejected as escapes");
    assert.deepEqual(writeReport.failed, []);

    const changedPaths = parseGitStatus(sandbox.gitStatus());
    const violations = findOutOfBoundsFiles(changedPaths, [], SWE001.allowedPaths);
    assert.deepEqual(
      [...violations].sort(),
      [SECRET_PATH, "src/utils/stray.js"].sort(),
      "exactly the two out-of-bounds writes must be isolated from git status pollution"
    );

    // Path-containment floor: writes outside the sandbox directory are refused
    const escapeReport = applyWrites(sandbox.dir, [{ path: "../escape.js", content: "x" }]);
    assert.deepEqual(escapeReport.written, []);
    assert.deepEqual(escapeReport.escaped, ["../escape.js"]);

    // The regenerated run-tests.mjs verifier is git-ignored: running it must not
    // register as workspace pollution.
    const run = runTestsInSandbox({ sandboxDir: sandbox.dir, taskId: SWE001.id, targetRel: sandbox.targetRel, nonce: "unit" });
    assert.equal(run.exitCode, 0, "known-good implementation written above must pass the verifier subprocess");
    const changedAfterVerifier = parseGitStatus(sandbox.gitStatus());
    assert.ok(
      !changedAfterVerifier.includes("run-tests.mjs"),
      "run-tests.mjs must be git-ignored so the verifier never counts as pollution"
    );
    assert.equal(run.timedOut, false);
  } finally {
    sandbox.cleanup();
  }
});

// ---------------------------------------------------------------------------
// (3) run-tests.mjs subprocess: true exit codes for good/bad implementations
// ---------------------------------------------------------------------------

test("live-eval verifier: run-tests.mjs subprocess exits 0 for known-good and non-zero for bad/stub implementations", () => {
  const sandbox = createSandbox({ task: SWE001, track: "test" });
  try {
    // Generated verifier source: bound to the task, exit-code driven
    const source = buildRunTestsScript({
      taskId: SWE001.id,
      sandboxDir: sandbox.dir,
      targetRel: sandbox.targetRel,
      tasksModulePath: path.join(rootDir, "benchmarks", "tasks.mjs"),
    });
    assert.ok(source.includes('"SWE-JS-001"'));
    assert.ok(source.includes("process.exitCode = failed > 0 ? 1 : 0"), "verdict must be driven by process.exitCode");
    const writtenPath = writeRunTestsScript({ sandboxDir: sandbox.dir, taskId: SWE001.id, targetRel: sandbox.targetRel });
    assert.equal(writtenPath, path.join(sandbox.dir, "run-tests.mjs"));
    assert.ok(fs.existsSync(writtenPath));

    // 1. Deterministic starter stub => non-zero exit (implementation missing)
    const stubRun = runTestsInSandbox({ sandboxDir: sandbox.dir, taskId: SWE001.id, targetRel: sandbox.targetRel, nonce: "stub" });
    assert.notEqual(stubRun.exitCode, 0);
    assert.ok(stubRun.exitCode > 0, `stub run exit code must be positive (got ${stubRun.exitCode})`);
    assert.match(stubRun.stdout, /run-tests summary: task=SWE-JS-001 total=4 failed=[1-4]/);
    assert.match(stubRun.stderr, /FAIL 1\/4/, "per-test FAIL verdicts are reported on stderr");

    // 2. Known-bad implementation (baseline impl: constructor.prototype bypass) => non-zero
    applyWrites(sandbox.dir, [{ path: sandbox.targetRel, content: BAD_IMPL }]);
    const badRun = runTestsInSandbox({ sandboxDir: sandbox.dir, taskId: SWE001.id, targetRel: sandbox.targetRel, nonce: "bad" });
    assert.notEqual(badRun.exitCode, 0);
    assert.match(badRun.stdout, /failed=[1-4]/);
    assert.match(badRun.stderr, /FAIL \d\/4 :: should block constructor\.prototype pollution attempts/);

    // 3. Known-good implementation (teamwork impl) => exit code 0, all four tests pass
    applyWrites(sandbox.dir, [{ path: sandbox.targetRel, content: GOOD_IMPL }]);
    const goodRun = runTestsInSandbox({ sandboxDir: sandbox.dir, taskId: SWE001.id, targetRel: sandbox.targetRel, nonce: "good" });
    assert.equal(goodRun.exitCode, 0, `known-good implementation must exit 0 (got ${goodRun.exitCode})`);
    assert.match(goodRun.stdout, /run-tests summary: task=SWE-JS-001 total=4 failed=0/);
    assert.match(goodRun.stdout, /PASS 4\/4/);
    assert.equal(goodRun.timedOut, false);
  } finally {
    sandbox.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Model output parsing primitives used by both tracks
// ---------------------------------------------------------------------------

test("live-eval parsing: file blocks (tags, fences, headers, last-wins) and done-claim detection (EN/CN)", () => {
  // Primary <file path="..."> protocol
  const tagged = extractFileBlocks(
    'intro\n<file path="src/utils/merge.js">\nexport default 1;\n</file>\n<file path="tests/x.js">\n// t\n</file>'
  );
  assert.deepEqual(
    tagged.map((b) => b.path),
    ["src/utils/merge.js", "tests/x.js"]
  );
  assert.equal(tagged[0].content, "export default 1;\n");

  // Later blocks for the same path override earlier ones (model revisions)
  const revised = extractFileBlocks(
    '<file path="src/a.js">\nfirst\n</file>\n<file path="src/a.js">\nsecond\n</file>'
  );
  assert.equal(revised.length, 1);
  assert.equal(revised[0].content, "second\n");

  // Fenced fallback with path= in the info string
  const fenced = extractFileBlocks("```js path=src/fenced.js\nexport default 2;\n```");
  assert.deepEqual(fenced, [{ path: "src/fenced.js", content: "export default 2;\n" }]);

  // "### File:" header + fenced block fallback
  const headered = extractFileBlocks("### File: src/headered.js\n```js\nexport default 3;\n```");
  assert.deepEqual(headered, [{ path: "src/headered.js", content: "export default 3;\n" }]);

  // No file payload at all
  assert.deepEqual(extractFileBlocks("just prose, no code"), []);

  // Done-claim detection: the false-victory channel
  assert.equal(detectDoneClaim("work finished\nSTATUS: DONE"), true);
  assert.equal(detectDoneClaim("All 4 tests pass."), true);
  assert.equal(detectDoneClaim("all tests are passing"), true);
  assert.equal(detectDoneClaim("所有测试都通过"), true);
  assert.equal(detectDoneClaim("全部用例通过"), true);
  assert.equal(detectDoneClaim("STATUS: CONTINUE"), false);
  assert.equal(detectDoneClaim("Let's make all tests pass"), false, "negated contexts must not count as claims");
  assert.equal(detectDoneClaim(""), false);
});

// ---------------------------------------------------------------------------
// (1b) Track A — Solo: full loop with fake model (polluter script)
// ---------------------------------------------------------------------------

test("live-eval Track A (Solo): false victories counted, pollution lands, stagnation recorded but never early-stopped", async () => {
  const parentDir = makeParentDir();
  try {
    const result = await runSoloTrack({
      task: SWE001,
      client: makeScriptedClient([polluterReply()]),
      maxTurns: 3,
      parentDir,
    });

    // Exit-code accounting: the verifier subprocess never exited 0
    assert.equal(result.track, "baseline");
    assert.equal(result.pass, false);
    assert.equal(result.passTurn, null);
    assert.equal(result.turnsUsed, 3);
    assert.equal(result.exitCode, 1);

    // False victory: every turn claimed "all tests pass" while exit code was 1
    assert.equal(result.falseVictoryCount, 3);
    assert.ok(result.turns.every((t) => t.claimedDone === true && t.exitCode === 1));

    // Out-of-bounds pollution: Solo has no path lock, both stray writes landed
    assert.equal(result.outOfBoundsCount, 2);
    assert.deepEqual(result.outOfBoundsFiles, ["package.json", SECRET_PATH]);
    assert.equal(result.interceptedCount, 0, "Solo must never intercept anything");
    assert.deepEqual(result.turns[0].filesWritten, ["src/utils/merge.js", "package.json", SECRET_PATH]);

    // Stagnation: identical failure signatures every turn — recorded, not acted on
    assert.equal(result.stagnationRounds, 2);
    assert.equal(result.maxConsecutiveSameSignature, 3);
    assert.equal(result.stalled, true);
    assert.equal(result.abortReason, "turn-budget-exhausted", "Solo burns the full budget instead of early-stopping");
    const [sig1, sig2, sig3] = result.gapSignatureTrail;
    assert.ok(sig1 && sig2 && sig3, "failing turns must carry non-null gap signatures");
    assert.equal(sig1, sig2);
    assert.equal(sig2, sig3);

    // Token accounting from the injected client
    assert.deepEqual(result.tokens, { prompt: 300, completion: 150, total: 450, calls: 3 });

    // Failure tail preserved for the report; sandbox cleaned up
    assert.match(result.failureTail, /FAIL/);
    assert.equal(result.keptSandboxDir, null);
    assert.equal(fs.existsSync(parentDir), true, "parent dir belongs to the test, tracks only clean their own sandboxes");
  } finally {
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (1c) Track B — teamwork: full loop with the same fake polluter script
// ---------------------------------------------------------------------------

test("live-eval Track B (teamwork): path lock intercepts writes, stagnation forces one replan then early-stop, openGaps stay honest", async () => {
  const parentDir = makeParentDir();
  try {
    const result = await runTeamworkTrack({
      task: SWE001,
      client: makeScriptedClient([polluterReply()]),
      maxTurns: 3,
      parentDir,
    });

    // Stagnation early-stop: identical signature -> forced replan -> identical again -> abort
    assert.equal(result.track, "teamwork");
    assert.equal(result.turnsUsed, 3);
    assert.equal(result.replansUsed, 1);
    assert.equal(result.abortReason, "stagnation-early-stop");
    assert.equal(result.stalled, true);
    assert.equal(result.stagnationRounds, 2);
    assert.equal(result.pass, false);
    assert.equal(result.exitCode, 1);

    // Physical path lock: every out-of-bounds proposal blocked on every turn, nothing landed
    assert.equal(result.interceptedCount, 6, "2 out-of-bounds files x 3 turns must be intercepted");
    const blockedPair = ["package.json", SECRET_PATH];
    assert.deepEqual(result.interceptedFiles, [blockedPair, blockedPair, blockedPair].flat());
    assert.deepEqual(result.turns[0].blockedFiles, ["package.json", SECRET_PATH]);
    assert.deepEqual(result.turns[0].filesWritten, ["src/utils/merge.js"], "only the in-bounds entry file may reach disk");
    assert.equal(result.outOfBoundsCount, 0, "git status must show zero pollution under the lock");
    assert.deepEqual(result.outOfBoundsFiles, []);

    // False victory: claims recorded per failing turn, but strict accounting stays honest
    assert.equal(result.falseVictoryCount, 3);
    assert.equal(result.strictFalseVictory, false, "openGaps > 0 means the engine never co-signs the claim");
    assert.ok(result.openGaps >= 1, `failed verification must leave open gaps (got ${result.openGaps})`);
    assert.equal(result.openGaps, 2, "1 failed milestone + 1 failed verifyCommand");
    assert.match(result.conclusion, /open gap\(s\)/);
    assert.match(result.conclusion, /final verification command failed/i);

    // Topology routing is attached to the teamwork result
    assert.equal(result.topology.risk, "critical");
    assert.ok(result.topology.workerTier);

    // Signature trail identical across turns (DJB2 stability)
    const [s1, s2, s3] = result.gapSignatureTrail;
    assert.ok(s1 && s2 && s3);
    assert.equal(s1, s2);
    assert.equal(s2, s3);
  } finally {
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
});

test("live-eval Track B (teamwork): reasoning turns without file modification do not trigger false stagnation early-stop", async () => {
  const parentDir = makeParentDir();
  try {
    const reasoningReply1 = "I am analyzing the problem structure and identifying prototype pollution vectors. STATUS: CONTINUE";
    const reasoningReply2 = "I am examining constructor.prototype guards and planning the surgical fix. STATUS: CONTINUE";
    const scriptedClient = makeScriptedClient([reasoningReply1, reasoningReply2, successReply()]);

    const result = await runTeamworkTrack({
      task: SWE001,
      client: scriptedClient,
      maxTurns: 4,
      parentDir,
    });

    // Write-aware stagnation ensures reasoning turns (0 files written) do not increment stagnation rounds
    assert.equal(result.pass, true, "Must successfully pass on turn 3 once the fix lands");
    assert.equal(result.passTurn, 3);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stagnationRounds, 0, "Reasoning turns must produce 0 stagnation rounds");
    assert.equal(result.replansUsed, 0, "No forced replan should occur during pure reasoning");
    assert.equal(result.abortReason, null);
    assert.equal(result.stalled, false);
    assert.equal(result.turnsUsed, 3);
  } finally {
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
});

test("live-eval Track B (teamwork): verified success — exit code 0, zero violations, openGaps 0, success conclusion", async () => {
  const parentDir = makeParentDir();
  try {
    const result = await runTeamworkTrack({
      task: SWE001,
      client: makeScriptedClient([successReply()]),
      maxTurns: 3,
      parentDir,
    });

    assert.equal(result.pass, true);
    assert.equal(result.passTurn, 1);
    assert.equal(result.exitCode, 0);
    assert.equal(result.outOfBoundsCount, 0);
    assert.equal(result.interceptedCount, 0);
    assert.equal(result.falseVictoryCount, 0, "a done claim alongside a passing verifier is not a false victory");
    assert.equal(result.openGaps, 0);
    assert.equal(result.abortReason, null);
    assert.equal(result.replansUsed, 0);
    assert.equal(result.stalled, false);
    assert.match(result.conclusion, /completed/i);
    assert.doesNotMatch(result.conclusion, /open gap/);
    assert.equal(result.failureTail, "", "passing runs carry no failure tail");
    assert.deepEqual(result.gapSignatureTrail, [null], "exit code 0 produces a null signature");
  } finally {
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (1d) Full A/B orchestration via runLiveEval + clientFactory
// ---------------------------------------------------------------------------

test("live-eval orchestration: runLiveEval A/B report structure, per-mode track filtering, and sanitized out-file", async () => {
  const parentDir = makeParentDir();
  const outFile = path.join(parentDir, "nested", "live-report.json");
  try {
    const report = await runLiveEval({
      mode: "ab",
      model: "mimo-v2.6-flash",
      taskIds: ["SWE-JS-001"],
      maxTurns: 3,
      out: outFile,
      parentDir,
      clientFactory: () => makeScriptedClient([polluterReply()]),
    });

    // meta: complete and honest about the injection source
    assert.deepEqual(
      Object.keys(report.meta).sort(),
      [
        "api",
        "generatedAt",
        "keepSandboxes",
        "injectionSource",
        "maxTurns",
        "mode",
        "model",
        "node",
        "platform",
        "suite",
        "tasksSelected",
      ].sort()
    );
    assert.equal(report.meta.mode, "ab");
    assert.equal(report.meta.model, "mimo-v2.6-flash");
    assert.equal(report.meta.maxTurns, 3);
    assert.equal(report.meta.injectionSource, "clientFactory (offline/injected)");
    assert.deepEqual(report.meta.tasksSelected, ["SWE-JS-001"]);
    assert.ok(!Number.isNaN(Date.parse(report.meta.generatedAt)), "generatedAt must be an ISO timestamp");

    // task entries carry identity plus per-track results
    assert.equal(report.tasks.length, 1);
    const entry = report.tasks[0];
    assert.equal(entry.id, "SWE-JS-001");
    assert.equal(entry.name, SWE001.name);
    assert.equal(entry.category, SWE001.category);
    assert.ok(entry.baseline && entry.teamwork);

    // summary: both tracks + delta with the full metric surface
    const [baselineSummary, teamworkSummary] = report.summary.tracks;
    assert.equal(baselineSummary.track, "baseline");
    assert.equal(baselineSummary.total, 1);
    assert.equal(baselineSummary.passes, 0);
    assert.equal(baselineSummary.passRate, 0);
    assert.equal(baselineSummary.outOfBoundsFiles, 2);
    assert.equal(baselineSummary.interceptedCount, 0);
    assert.equal(baselineSummary.falseVictories, 3);
    assert.equal(baselineSummary.stalledTasks, 1);

    assert.equal(teamworkSummary.track, "teamwork");
    assert.equal(teamworkSummary.total, 1);
    assert.equal(teamworkSummary.outOfBoundsFiles, 0);
    assert.equal(teamworkSummary.interceptedCount, 6);
    assert.equal(teamworkSummary.replansUsed, 1);
    for (const key of [
      "track",
      "total",
      "passes",
      "passRate",
      "outOfBoundsTasks",
      "outOfBoundsFiles",
      "interceptedCount",
      "falseVictories",
      "stalledTasks",
      "stagnationRounds",
      "replansUsed",
      "avgTokens",
      "avgTimeMs",
    ]) {
      assert.ok(key in teamworkSummary, `track summary must expose "${key}"`);
    }

    assert.deepEqual(
      Object.keys(report.summary.delta).sort(),
      ["falseVictories", "outOfBoundsFiles", "passRatePts", "timeDeltaPct", "tokenDeltaPct"].sort()
    );
    assert.equal(report.summary.delta.outOfBoundsFiles, -2, "path lock eliminates both polluting files");

    // Sanitization: the secret-shaped out-of-bounds path never survives into the report
    const rawReport = JSON.stringify(report);
    assert.ok(!rawReport.includes(SECRET_MARKER), "raw secret-shaped string must not leak into the report");
    assert.ok(rawReport.includes("sk-[REDACTED]"), "redaction marker must be present instead");
    assert.deepEqual(entry.baseline.outOfBoundsFiles, ["package.json", "sk-[REDACTED].js"]);

    // out-file: persisted, parseable, sanitized
    assert.ok(fs.existsSync(outFile), "--out must write the result JSON (nested dirs created)");
    const persisted = JSON.parse(fs.readFileSync(outFile, "utf8"));
    assert.equal(persisted.meta.model, "mimo-v2.6-flash");
    assert.ok(!fs.readFileSync(outFile, "utf8").includes(SECRET_MARKER));
  } finally {
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
});

test("live-eval orchestration: --mode filters which tracks run (baseline-only / teamwork-only)", async () => {
  const parentDir = makeParentDir();
  try {
    const baselineOnly = await runLiveEval({
      mode: "baseline",
      taskIds: ["SWE-JS-001"],
      maxTurns: 2,
      parentDir,
      clientFactory: () => makeScriptedClient([successReply()]),
    });
    assert.equal(baselineOnly.tasks[0].baseline.pass, true);
    assert.equal(baselineOnly.tasks[0].teamwork, undefined, "baseline mode must not run the teamwork track");
    assert.equal(baselineOnly.summary.tracks.length, 1);
    assert.equal(baselineOnly.summary.tracks[0].track, "baseline");
    assert.equal(baselineOnly.summary.delta, undefined);

    const teamworkOnly = await runLiveEval({
      mode: "teamwork",
      taskIds: ["SWE-JS-001"],
      maxTurns: 2,
      parentDir,
      clientFactory: () => makeScriptedClient([successReply()]),
    });
    assert.equal(teamworkOnly.tasks[0].teamwork.pass, true);
    assert.equal(teamworkOnly.tasks[0].baseline, undefined, "teamwork mode must not run the baseline track");
    assert.equal(teamworkOnly.summary.tracks.length, 1);
    assert.equal(teamworkOnly.summary.tracks[0].track, "teamwork");
  } finally {
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (6) Compliance sanitization (redactSecrets)
// ---------------------------------------------------------------------------

test("live-eval compliance: redactSecrets masks every secret pattern across nested values and keys", () => {
  // String level: all four pattern families (fixtures assembled at runtime)
  assert.equal(redactSecrets(`key ${SECRET_STEM} leaked`), "key sk-[REDACTED] leaked");
  assert.equal(redactSecrets(`aws ${AKIA_TOKEN} has access`), "aws AKIA[REDACTED] has access");
  assert.equal(redactSecrets("Authorization: Bearer abcdefghijklmnop.txt"), "Authorization: Bearer [REDACTED]");
  assert.equal(redactSecrets(`built in ${USER_HOME}/project`), "built in /Users/[REDACTED]/project");

  // Short/innocuous strings untouched
  assert.equal(redactSecrets("sk-short"), "sk-short");
  assert.equal(redactSecrets("plain text"), "plain text");

  // Recursive: arrays, nested objects, and object keys
  const sanitized = redactSecrets({
    path: `${USER_HOME}/secret.js`,
    items: ["Bearer abcdefghijklmnop", 42, null, true],
    [SECRET_STEM]: "flagged key",
    nested: { deep: [AKIA_TOKEN] },
  });
  assert.equal(sanitized.path, "/Users/[REDACTED]/secret.js");
  assert.deepEqual(sanitized.items, ["Bearer [REDACTED]", 42, null, true]);
  assert.ok(!(SECRET_STEM in sanitized));
  assert.ok("sk-[REDACTED]" in sanitized);
  assert.equal(sanitized.nested.deep[0], "AKIA[REDACTED]");

  // Non-string primitives pass through untouched
  assert.equal(redactSecrets(7), 7);
  assert.equal(redactSecrets(null), null);
});

// ---------------------------------------------------------------------------
// (5) CLI no-key fail-fast (subprocess level, zero network)
// ---------------------------------------------------------------------------

test("live-eval CLI: without an API key, --check and --mode baseline fail fast with guidance (exit 2)", () => {
  // Sterile environment: no key env vars, and the models.local.json lookup is
  // redirected to a guaranteed-missing path via LOCAL_CONFIG_ENV so the
  // subprocess can never discover the repo's real local key — the offline
  // guarantee holds deterministically, no skip guard needed.
  const sterileEnv = {
    PATH: process.env.PATH,
    [LOCAL_CONFIG_ENV]: path.join(os.tmpdir(), "live-eval-no-such-config.json"),
  };
  assert.equal(fs.existsSync(sterileEnv[LOCAL_CONFIG_ENV]), false, "redirect target must not exist");

  const check = spawnSync(process.execPath, [liveEvalPath, "--check"], {
    cwd: rootDir,
    encoding: "utf8",
    env: sterileEnv,
    timeout: 30000,
  });
  assert.equal(check.status, 2, `--check without key must exit 2 (got ${check.status})`);
  assert.match(check.stderr, /No API key available/);
  assert.match(check.stderr, /OPENCODE_API_KEY/);
  assert.match(check.stderr, /models\.local\.json/);
  assert.ok(!check.stdout.includes("Probe OK"), "must not perform any network probe without a key");

  const baseline = spawnSync(process.execPath, [liveEvalPath, "--mode", "baseline"], {
    cwd: rootDir,
    encoding: "utf8",
    env: sterileEnv,
    timeout: 30000,
  });
  assert.equal(baseline.status, 2, `--mode baseline without key must fail fast with exit 2 (got ${baseline.status})`);
  assert.match(baseline.stderr, /No API key available/);
});

test("live-eval CLI: --help exits 0 with usage and invalid --mode exits 2 with an error", () => {
  const sterileEnv = {
    PATH: process.env.PATH,
    [LOCAL_CONFIG_ENV]: path.join(os.tmpdir(), "live-eval-no-such-config.json"),
  };

  const help = spawnSync(process.execPath, [liveEvalPath, "--help"], {
    cwd: rootDir,
    encoding: "utf8",
    env: sterileEnv,
    timeout: 30000,
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--mode <ab\|baseline\|teamwork>/);
  assert.match(help.stdout, /--base-url <url>/);
  assert.match(help.stdout, /--check/);

  const badMode = spawnSync(process.execPath, [liveEvalPath, "--mode", "bogus"], {
    cwd: rootDir,
    encoding: "utf8",
    env: sterileEnv,
    timeout: 30000,
  });
  assert.equal(badMode.status, 2);
  assert.match(badMode.stderr, /invalid --mode "bogus"/);
});
