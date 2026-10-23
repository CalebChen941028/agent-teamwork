#!/usr/bin/env node
/**
 * Build and validation script for agent-teamwork.
 * Verifies that shared gate helpers, schema definitions, and inlined helpers are in sync.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

console.log("Checking agent-teamwork build and shared module consistency...");

// 1. Validate JSON schema
const schemaPath = path.join(rootDir, "shared", "models.schema.json");
const examplePath = path.join(rootDir, "models.example.json");

try {
  JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  JSON.parse(fs.readFileSync(examplePath, "utf8"));
  console.log("✔ JSON configurations valid.");
} catch (err) {
  console.error("✖ JSON validation failed:", err.message);
  process.exit(1);
}

// 2. Validate teamwork.dwf.ts pure functions
const dwfPath = path.join(rootDir, "adapters", "zcode", "teamwork.dwf.ts");
const dwfContent = fs.readFileSync(dwfPath, "utf8");

const requiredPureFunctions = [
  "formatFailureOutput",
];

for (const fn of requiredPureFunctions) {
  if (!dwfContent.includes(`function ${fn}`)) {
    console.error(`✖ Missing inlined helper "${fn}" in teamwork.dwf.ts`);
    process.exit(1);
  }
}

console.log("✔ teamwork.dwf.ts helper alignment verified.");
console.log("Build verification successful!");
