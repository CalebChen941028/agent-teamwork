#!/usr/bin/env node

/**
 * agent-teamwork — Unified CLI interface
 *
 * Provides a direct command-line entrypoint for agent-teamwork:
 *   ./bin/agent-teamwork.mjs install --target all --lang auto
 *   ./bin/agent-teamwork.mjs benchmark --verbose
 *   ./bin/agent-teamwork.mjs live --tasks LIVE-01-WORKSPACE-MONOREPO
 *   ./bin/agent-teamwork.mjs swebench --dry-run
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

function readPackageJson() {
  try {
    const pkgPath = path.join(ROOT_DIR, "package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return { version: "0.6.4" };
  }
}

const pkg = readPackageJson();
const VERSION = pkg.version || "0.6.4";

function printHelp() {
  console.log(`
agent-teamwork v${VERSION} — Multi-Agent Collaborative Execution Engine (Harness²)

Usage:
  agent-teamwork <command> [options]
  teamwork <command> [options]

Commands:
  install       Install agent-teamwork into target AI coding agents
                Options:
                  --target <name>  all | zcode | claude | codex | antigravity | agents |
                                   deepseek | opencode | workbuddy | cursor | windsurf |
                                   cline | aider | generic
                  --lang <opt>     auto | zh | en (default: auto)
                  --dest <path>    Custom destination directory
                  --dry-run        Simulate installation without writing files

  uninstall     Uninstall agent-teamwork from target AI coding agents
                Options:
                  --target <name>  Target platform adapter to remove (or all)
                  --purge-backups  Remove .bak-* backup files created during installation

  benchmark     Run deterministic offline multi-agent simulation benchmarks (8 scenarios)
                Options:
                  --verbose        Print per-scenario breakdown
                  --json <path>    Write JSON benchmark report

  live          Run live LLM sandbox coding evaluation (10 real tasks)
                Options:
                  --mode <m>       teamwork | baseline | ab (default: ab)
                  --model <name>   Model identifier
                  --tasks <ids>    Comma-separated task IDs
                  --out <path>     Output JSON report path

  swebench      Run official SWE-bench Verified evaluation harness
                Options:
                  --dry-run        Validate dataset loader & pipeline without API spend
                  --mode <m>       teamwork | baseline | ab (default: ab)
                  --limit <n>      Number of instances to evaluate

  version, -v   Print version (${VERSION})
  help, -h      Show this help message

Documentation & Repository:
  https://github.com/CalebChen941028/agent-teamwork
`);
}

function runShellScript(scriptName, args) {
  const scriptPath = path.join(ROOT_DIR, scriptName);
  const result = spawnSync("bash", [scriptPath, ...args], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: { ...process.env, AGENT_TEAMWORK_ROOT: ROOT_DIR },
  });
  process.exit(result.status ?? 0);
}

function runNodeScript(scriptRelativePath, args) {
  const scriptPath = path.join(ROOT_DIR, scriptRelativePath);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: { ...process.env, AGENT_TEAMWORK_ROOT: ROOT_DIR },
  });
  process.exit(result.status ?? 0);
}

const args = process.argv.slice(2);
const command = args[0];
const subArgs = args.slice(1);

if (!command || command === "-h" || command === "--help" || command === "help") {
  printHelp();
  process.exit(0);
}

if (command === "-v" || command === "--version" || command === "version") {
  console.log(`agent-teamwork v${VERSION}`);
  process.exit(0);
}

switch (command) {
  case "install":
    runShellScript("install.sh", subArgs);
    break;

  case "uninstall":
    runShellScript("uninstall.sh", subArgs);
    break;

  case "benchmark":
  case "selftest":
    runNodeScript("benchmarks/runner.mjs", subArgs);
    break;

  case "live":
    runNodeScript("benchmarks/live-eval.mjs", subArgs);
    break;

  case "swebench":
    runNodeScript("benchmarks/swebench/runner.mjs", subArgs);
    break;

  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
