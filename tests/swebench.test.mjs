import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildSwebenchScopingContract,
  buildSwebenchSystemPrompt,
  buildSwebenchUserPrompt,
  extractFileBlocks,
  extractReadRequests,
  readRepoFile,
  renderReadResponses,
  applyFileWrites,
  appendPrediction,
  parseCliArgs,
} from "../benchmarks/swebench/runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

test("SWE-bench adapter: buildSwebenchScopingContract resolves dynamic risk topology and boundaries", () => {
  const instance = {
    instance_id: "psf__requests-1142",
    repo: "psf/requests",
    base_commit: "22623bd8c265b78b161542663ee980738441c307",
    problem_statement: "requests.get is ALWAYS sending content length header even when body is empty",
  };

  const contract = buildSwebenchScopingContract(instance);
  assert.equal(contract.instanceId, "psf__requests-1142");
  assert.equal(contract.repo, "psf/requests");
  assert.ok(contract.topology && contract.topology.risk, "Topology must have risk tier");
  assert.ok(contract.forbiddenPaths.includes("tests/"), "Must forbid editing test directory");
});

test("SWE-bench adapter: buildSwebenchSystemPrompt enforces boundary lock and file tag protocol", () => {
  const contract = {
    instanceId: "django__django-11099",
    repo: "django/django",
    topology: { risk: "high", workerTier: "heavy" },
  };

  const teamworkPrompt = buildSwebenchSystemPrompt(contract, "teamwork");
  assert.ok(teamworkPrompt.includes("BOUNDARY LOCK"), "Must include boundary lock guardrail");
  assert.ok(teamworkPrompt.includes("SURGICAL DISCIPLINE"), "Must include surgical discipline guardrail");
  assert.ok(teamworkPrompt.includes('<file path="'), "Must include file tag protocol");

  const baselinePrompt = buildSwebenchSystemPrompt(contract, "baseline");
  assert.ok(!baselinePrompt.includes("BOUNDARY LOCK"), "Baseline prompt must omit teamwork guardrails");
});

test("SWE-bench adapter: extractFileBlocks and applyFileWrites containment & escape handling", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "swebench-test-"));
  try {
    const text = [
      "Here is the proposed fix for the issue:",
      '<file path="requests/models.py">',
      "def fix(): return True",
      "</file>",
      '<file path="../../outside.py">',
      "malicious content",
      "</file>",
    ].join("\n");

    const blocks = extractFileBlocks(text);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].path, "requests/models.py");
    assert.equal(blocks[1].path, "../../outside.py");

    const report = applyFileWrites(tmpDir, blocks);
    assert.equal(report.written.length, 1);
    assert.equal(report.written[0], "requests/models.py");
    assert.equal(report.escaped.length, 1, "Path traversal must be intercepted as escaped");
    assert.ok(fs.existsSync(path.join(tmpDir, "requests", "models.py")));
    assert.ok(!fs.existsSync(path.join(tmpDir, "..", "outside.py")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SWE-bench adapter: appendPrediction and eval.py validation", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "swebench-pred-"));
  try {
    const predFile = path.join(tmpDir, "predictions.jsonl");

    appendPrediction(predFile, {
      instanceId: "psf__requests-1142",
      modelPatch: "diff --git a/requests/models.py b/requests/models.py\n--- a/requests/models.py\n+++ b/requests/models.py\n@@ -1,1 +1,2 @@\n",
      modelName: "agent-teamwork-v0.4.0",
    });

    assert.ok(fs.existsSync(predFile));
    const lines = fs.readFileSync(predFile, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.instance_id, "psf__requests-1142");
    assert.ok(parsed.model_patch.includes("diff --git"));
    assert.equal(parsed.model_name_or_path, "agent-teamwork-v0.4.0");

    // Test eval.py --local-check-only
    const evalScript = path.join(rootDir, "benchmarks", "swebench", "eval.py");
    const res = spawnSync("python3", [evalScript, "--predictions", predFile, "--local-check-only"], {
      encoding: "utf8",
    });
    assert.equal(res.status, 0, `eval.py must exit 0 on valid predictions: ${res.stderr}`);
    assert.ok(res.stdout.includes("Predictions file valid"));
    assert.ok(res.stdout.includes("Ready for Docker SWE-bench execution"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SWE-bench loader: loader.py CLI --info executes cleanly and outputs dataset metrics", () => {
  const loaderScript = path.join(rootDir, "benchmarks", "swebench", "loader.py");
  const res = spawnSync("python3", [loaderScript, "--info"], {
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `loader.py --info must exit 0: ${res.stderr}`);
  assert.ok(res.stdout.includes("SWE-bench Verified Dataset Summary"));
  assert.ok(res.stdout.includes("Total Verified Instances: 500"));
  assert.ok(res.stdout.includes("django/django"));
  assert.ok(res.stdout.includes("psf/requests"));
});

test("SWE-bench adapter: read-request protocol extraction and sandbox-contained file reads", () => {
  const text = [
    "Let me inspect the model layer first.",
    '<read path="requests/models.py"/>',
    '<read path="requests/adapters.py"/>',
    '<read path="../../etc/passwd"/>',
    '<read path="requests/models.py"/>', // duplicate must be deduped
  ].join("\n");
  const requests = extractReadRequests(text);
  assert.deepEqual(requests, ["requests/models.py", "requests/adapters.py", "../../etc/passwd"]);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "swebench-read-"));
  try {
    fs.mkdirSync(path.join(tmpDir, "requests"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "requests", "models.py"), "class Response:\n    pass\n", "utf8");

    const ok = readRepoFile(tmpDir, "requests/models.py");
    assert.ok(ok.content.includes("class Response:"));

    const escaped = readRepoFile(tmpDir, "../../etc/passwd");
    assert.equal(escaped.error, "path escapes sandbox");
    assert.ok(renderReadResponses([escaped]).includes('error="path escapes sandbox"'));

    const truncated = readRepoFile(tmpDir, "requests/models.py", { maxChars: 6 });
    assert.equal(truncated.truncated, true);
    assert.ok(renderReadResponses([truncated]).includes("[truncated"));

    // Multi-line file for line-slicing validation
    const multiLine = Array.from({ length: 20 }, (_, i) => `line_${i + 1}`).join("\n");
    fs.writeFileSync(path.join(tmpDir, "requests", "models.py"), multiLine, "utf8");

    const slicedObj = readRepoFile(tmpDir, { path: "requests/models.py", start: 5, end: 7 });
    assert.equal(slicedObj.sliced, true);
    assert.equal(slicedObj.totalLines, 20);
    assert.ok(slicedObj.content.includes("5 | line_5"));
    assert.ok(slicedObj.content.includes("7 | line_7"));
    assert.ok(!slicedObj.content.includes("line_8"));

    const renderedSliced = renderReadResponses([slicedObj]);
    assert.ok(renderedSliced.includes('lines="5-7"'));
    assert.ok(renderedSliced.includes('totalLines="20"'));

    // Sliced read tag extraction
    const sliceTags = [
      '<read path="requests/models.py" start="5" end="10"/>',
      '<read path="requests/adapters.py" lines="15-30"/>',
    ].join("\n");
    const extractedSlices = extractReadRequests(sliceTags);
    assert.deepEqual(extractedSlices, [
      { path: "requests/models.py", start: 5, end: 10 },
      { path: "requests/adapters.py", start: 15, end: 30 },
    ]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SWE-bench adapter: buildSwebenchUserPrompt embeds file tree and read protocol only when provided", () => {
  const instance = {
    instance_id: "psf__requests-1142",
    repo: "psf/requests",
    problem_statement: "content-length always sent",
  };

  const bare = buildSwebenchUserPrompt(instance);
  assert.ok(bare.includes("psf__requests-1142"));
  assert.ok(!bare.includes("<read path="), "No read protocol without a live tree");

  const withTree = buildSwebenchUserPrompt(instance, {
    tree: "requests/__init__.py\nrequests/models.py",
    totalFiles: 2,
    truncated: false,
  });
  assert.ok(withTree.includes("requests/models.py"));
  assert.ok(withTree.includes('<read path="requests/models.py"/>'));
  assert.ok(!withTree.includes("[tree truncated"));
});

test("SWE-bench adapter: parseCliArgs accepts driver flags and keeps defaults", () => {
  const args = parseCliArgs([
    "--instances", "/tmp/tasks.json",
    "--mode", "baseline",
    "--model", "deepseek-v4.1-flash",
    "--max-turns", "12",
    "--api-key", "k",
    "--keep-sandboxes",
  ]);
  assert.equal(args.mode, "baseline");
  assert.equal(args.maxTurns, 12);
  assert.equal(args.apiKey, "k");
  assert.equal(args.keepSandboxes, true);

  const defaults = parseCliArgs([]);
  assert.equal(defaults.mode, "teamwork");
  assert.equal(defaults.maxTurns, 6);
  assert.equal(defaults.keepSandboxes, false);
});
