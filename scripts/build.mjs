#!/usr/bin/env node
/**
 * Build, Single-Source-of-Truth (SSOT), and Open-Source Compliance validation script for agent-teamwork.
 * Verifies:
 * 1. JSON schema & models.example.json validity and semantic compliance.
 * 2. Bilingual role prompt and multi-platform adapter completeness.
 * 3. Exact body parity of pure functions across shared/verify-gate.ts,
 *    shared/verify-gate.js, and adapters/zcode/teamwork.dwf.ts.
 * 4. Syntax/delimiter balance across TypeScript workflow and gate modules.
 * 5. Clean-room open-source compliance (no leaked secrets, internal URLs, or personal paths).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

console.log("Checking agent-teamwork build, SSOT parity, and open-source compliance...");

// 1. Validate JSON schema & example files, plus bilingual adapters and role files
const schemaPath = path.join(rootDir, "shared", "models.schema.json");
const examplePath = path.join(rootDir, "models.example.json");
const opencodePath = path.join(rootDir, "adapters", "opencode", "agents.json");

try {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const example = JSON.parse(fs.readFileSync(examplePath, "utf8"));
  const opencode = JSON.parse(fs.readFileSync(opencodePath, "utf8"));

  if (typeof example.default_light_model !== "string" || !example.models) {
    throw new Error("models.example.json does not satisfy required fields in models.schema.json");
  }
  const allowedTiers = schema.properties.models.additionalProperties.properties.tier.enum;
  for (const [key, val] of Object.entries(example.models)) {
    if (!val.id || (val.tier && !allowedTiers.includes(val.tier))) {
      throw new Error(`Invalid model entry "${key}" in models.example.json`);
    }
  }
  for (const [role, cfg] of Object.entries(opencode.roles || {})) {
    const promptPath = path.join(rootDir, cfg.prompt || cfg.prompt_en);
    const zhPromptPath = path.join(rootDir, cfg.prompt_zh || promptPath.replace(/\.en\.md$/, ".zh.md"));
    if (!fs.existsSync(promptPath) || !fs.existsSync(zhPromptPath)) {
      throw new Error(`Missing bilingual role prompt files for OpenCode role "${role}"`);
    }
  }
} catch (err) {
  console.error("✖ Configuration validation failed:", err.message);
  process.exit(1);
}

const requiredFiles = [
  "bin/agent-teamwork.mjs",
  "adapters/zcode/teamwork.dwf.ts",
  "adapters/claude-code/teamwork.md",
  "adapters/codex/protocol.md",
  "adapters/deepseek/teamwork.md",
  "adapters/opencode/agents.json",
  "adapters/workbuddy/teamwork.md",
  "adapters/generic/teamwork.md",
  "protocol/scoping-interview.md",
  "protocol/teamwork.md",
  "roles/roles.zh.md",
  "roles/roles.en.md",
  "roles/orchestrator.zh.md",
  "roles/orchestrator.en.md",
  "roles/worker.zh.md",
  "roles/worker.en.md",
  "roles/critic.zh.md",
  "roles/critic.en.md",
  "roles/challenger.zh.md",
  "roles/challenger.en.md",
  "roles/reworker.zh.md",
  "roles/reworker.en.md",
  "roles/auditor.zh.md",
  "roles/auditor.en.md",
  "roles/scribe.zh.md",
  "roles/scribe.en.md",
  "docs/BENCHMARK_REPORT.md",
  "docs/BENCHMARK_REPORT.zh-CN.md",
  "docs/SWEBENCH_GUIDE.md",
  "docs/SWEBENCH_GUIDE.zh-CN.md",
  "benchmarks/swebench/loader.py",
  "benchmarks/swebench/runner.mjs",
  "benchmarks/swebench/eval.py",
  "BENCHMARKS.md",
  "BENCHMARKS.zh-CN.md",
];

for (const rel of requiredFiles) {
  const full = path.join(rootDir, rel);
  if (!fs.existsSync(full) || fs.statSync(full).size === 0) {
    console.error(`✖ Missing or empty required file: ${rel}`);
    process.exit(1);
  }
}
console.log("✔ JSON configurations, adapters, and bilingual role/protocol files valid.");

// 2. Verify exported functions and exact body parity across verify-gate.ts, verify-gate.js, verify-gate.d.ts, and teamwork.dwf.ts
const tsGateContent = fs.readFileSync(path.join(rootDir, "shared", "verify-gate.ts"), "utf8");
const jsGateContent = fs.readFileSync(path.join(rootDir, "shared", "verify-gate.js"), "utf8");
const dtsGateContent = fs.readFileSync(path.join(rootDir, "shared", "verify-gate.d.ts"), "utf8");
const dwfPath = path.join(rootDir, "adapters", "zcode", "teamwork.dwf.ts");
const dwfContent = fs.readFileSync(dwfPath, "utf8");

const requiredExports = [
  "formatFailureOutput",
  "computeFailureSignature",
  "computeGapSignature",
  "normalizeRelPath",
  "isPathAllowed",
  "findOutOfBoundsFiles",
  "isValidExperienceEntry",
  "formatHarnessGuardrails",
  "validateTeamProfile",
  "validateIntegrityMode",
  "isSubstantiveChallenge",
  "calculateTeamworkOpenGaps",
  "formatTeamworkConclusion",
  "resolveModelConfiguration",
  "rankExperienceLibrary",
  "composeHarnessGuardrails",
  "resolveMilestoneTopology",
  "synthesizeMicroTestPlan",
];

function extractNormalizedFunction(source, fnName) {
  const exportIdx = source.indexOf(`export function ${fnName}`);
  const plainIdx = source.indexOf(`function ${fnName}`);
  const startIdx = exportIdx !== -1 ? exportIdx : plainIdx;
  if (startIdx === -1) {
    throw new Error(`Function "${fnName}" not found`);
  }

  let parenDepth = 0;
  let closeParenIdx = -1;
  for (let i = startIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") parenDepth++;
    else if (ch === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        closeParenIdx = i;
        break;
      }
    }
  }
  if (closeParenIdx === -1) {
    throw new Error(`Could not locate parameter list end of "${fnName}"`);
  }

  let typeBraceDepth = 0;
  let bodyStartIdx = -1;
  const afterParen = source.slice(closeParenIdx + 1).trimStart();
  const hasReturnType = afterParen.startsWith(":");

  if (!hasReturnType) {
    bodyStartIdx = source.indexOf("{", closeParenIdx + 1);
  } else {
    let seenFirstTypeToken = false;
    let inObjectType = false;
    for (let i = closeParenIdx + 1; i < source.length; i++) {
      const ch = source[i];
      if (!seenFirstTypeToken) {
        if (ch === ":" || /\s/.test(ch)) continue;
        seenFirstTypeToken = true;
        if (ch === "{") {
          inObjectType = true;
          typeBraceDepth = 1;
          continue;
        }
      }
      if (inObjectType) {
        if (ch === "{") typeBraceDepth++;
        else if (ch === "}") {
          typeBraceDepth--;
          if (typeBraceDepth === 0) {
            inObjectType = false;
          }
        }
      } else if (ch === "{") {
        bodyStartIdx = i;
        break;
      }
    }
  }
  if (bodyStartIdx === -1) {
    throw new Error(`Could not locate body of "${fnName}"`);
  }

  let braceDepth = 0;
  let bodyEndIdx = -1;
  for (let i = bodyStartIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") braceDepth++;
    else if (ch === "}") {
      braceDepth--;
      if (braceDepth === 0) {
        bodyEndIdx = i;
        break;
      }
    }
  }
  if (bodyEndIdx === -1) {
    throw new Error(`Unbalanced braces in "${fnName}"`);
  }

  const rawBody = source.slice(bodyStartIdx, bodyEndIdx + 1);
  return rawBody
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/:\s*(?:string|number|boolean|any|FindingLike|MilestoneOutcomeLike|MilestoneOutcome|ChallengeLike|ChallengeResult|HarnessGuardrail|ExperienceEntry|MilestoneTopology|MicroTestPlan)(?:\[\])?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

for (const fn of requiredExports) {
  if (!tsGateContent.includes(`export function ${fn}`)) {
    console.error(`✖ Missing export "${fn}" in shared/verify-gate.ts`);
    process.exit(1);
  }
  if (!jsGateContent.includes(`export function ${fn}`)) {
    console.error(`✖ Missing export "${fn}" in shared/verify-gate.js`);
    process.exit(1);
  }
  if (!dtsGateContent.includes(`export function ${fn}`)) {
    console.error(`✖ Missing export "${fn}" in shared/verify-gate.d.ts`);
    process.exit(1);
  }
  if (!dwfContent.includes(`function ${fn}`)) {
    console.error(`✖ Missing inlined helper "${fn}" in teamwork.dwf.ts`);
    process.exit(1);
  }

  const tsBody = extractNormalizedFunction(tsGateContent, fn);
  const jsBody = extractNormalizedFunction(jsGateContent, fn);
  const dwfBody = extractNormalizedFunction(dwfContent, fn);

  if (tsBody !== jsBody) {
    console.error(`✖ Logic drift in "${fn}" between shared/verify-gate.ts and shared/verify-gate.js`);
    console.error("  TS:", tsBody);
    console.error("  JS:", jsBody);
    process.exit(1);
  }
  if (tsBody !== dwfBody) {
    console.error(`✖ Logic drift in "${fn}" between shared/verify-gate.ts and adapters/zcode/teamwork.dwf.ts`);
    console.error("  TS: ", tsBody);
    console.error("  DWF:", dwfBody);
    process.exit(1);
  }
}
console.log(`✔ All ${requiredExports.length} shared verify-gate functions are 100% body-identical across TS, JS, and teamwork.dwf.ts.`);

// 3. Validate syntax delimiter balance
function checkBalancedDelimiters(source, filename) {
  const stack = [];
  const pairs = { "{": "}", "(": ")", "[": "]" };
  const closers = new Set(["}", ")", "]"]);
  let i = 0;
  let line = 1;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "\n") {
      line++;
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }

    if (ch === "/" && next !== "/" && next !== "*") {
      let prevIdx = i - 1;
      while (prevIdx >= 0 && /\s/.test(source[prevIdx])) prevIdx--;
      const prevChar = prevIdx >= 0 ? source[prevIdx] : "";
      if (["(", ",", "=", ":", "[", "!", "&", "|", "?", ";", "{"].includes(prevChar)) {
        i++;
        let inCharClass = false;
        while (i < source.length) {
          if (source[i] === "\\") {
            i += 2;
            continue;
          }
          if (source[i] === "[") inCharClass = true;
          else if (source[i] === "]") inCharClass = false;
          else if (source[i] === "/" && !inCharClass) {
            i++;
            while (i < source.length && /[a-z]/i.test(source[i])) i++;
            break;
          }
          if (source[i] === "\n") line++;
          i++;
        }
        continue;
      }
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "\n") line++;
        i++;
      }
      i++;
      continue;
    }

    if (pairs[ch]) {
      stack.push({ char: ch, expected: pairs[ch], line });
    } else if (closers.has(ch)) {
      if (stack.length === 0) {
        throw new Error(`${filename}: Unexpected closing "${ch}" at line ${line}`);
      }
      const top = stack.pop();
      if (top.expected !== ch) {
        throw new Error(
          `${filename}: Mismatched "${ch}" at line ${line}; expected "${top.expected}" to close "${top.char}" from line ${top.line}`,
        );
      }
    }
    i++;
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    throw new Error(
      `${filename}: Unclosed "${unclosed.char}" opened at line ${unclosed.line} (expected "${unclosed.expected}")`,
    );
  }
}

// 4. Clean-room open-source compliance check (no secrets, internal URLs, or personal paths)
const complianceRegex = new RegExp(
  ["sk-[a-zA-Z0-9]{20,}", "AKIA[0-9A-Z]{16}", "/Users/" + "chenliangliang", "litellm_proxy"].join("|"),
);
// Local host-tool cache directories (git-ignored, auto-regenerated by the ZCode
// host's plugins) are not repository content and are excluded from the walk.
const COMPLIANCE_SKIP_DIRS = new Set([".git", "node_modules", ".video_agent", ".serena", ".zcode"]);
function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (COMPLIANCE_SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full);
    } else if (entry.isFile() && full !== fileURLToPath(import.meta.url)) {
      const content = fs.readFileSync(full, "utf8");
      if (complianceRegex.test(content)) {
        throw new Error(`Open-source compliance violation in ${path.relative(rootDir, full)}`);
      }
    }
  }
}

try {
  checkBalancedDelimiters(dwfContent, "adapters/zcode/teamwork.dwf.ts");
  checkBalancedDelimiters(tsGateContent, "shared/verify-gate.ts");
  walkDir(rootDir);
} catch (err) {
  console.error("✖ Syntax/Compliance check failed:", err.message);
  process.exit(1);
}
console.log("✔ teamwork.dwf.ts and verify-gate.ts syntax delimiter balance verified.");
console.log("✔ Open-source clean-room & privacy compliance verified.");
console.log("Build verification successful!");
