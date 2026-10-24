#!/usr/bin/env node
/**
 * Merge a primary live-eval report with supplemental single-track reports.
 *
 * Purpose: when a track dies on infrastructure (HTTP timeout / gateway 5xx)
 * BEFORE completing a single turn (abortReason starts with "track-error:"),
 * the eval records it as a failed track. Re-running just that track with a
 * longer --timeout-ms produces a supplemental report; this script splices the
 * supplemental track results into the primary report, recomputes the summary,
 * and records the splice in meta.supplements for full auditability.
 *
 * Usage:
 *   node benchmarks/merge-live-reports.mjs primary.json a.json b.json ... -o merged.json
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { summarize } from "./live-eval.mjs";

function parseArgs(argv) {
  const inputs = [];
  let out = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "-o" || a === "--out") {
      out = argv[i + 1];
      i += 1;
      if (!out) {
        throw new Error(`${a} requires a file path`);
      }
    } else {
      inputs.push(a);
    }
  }
  if (inputs.length < 2) {
    throw new Error("usage: merge-live-reports.mjs primary.json supplement.json [...] -o merged.json");
  }
  return { inputs, out };
}

function isInfraErroredTrack(trackResult) {
  return String(trackResult && trackResult.abortReason || "").startsWith("track-error:");
}

function main() {
  const { inputs, out } = parseArgs(process.argv.slice(2));
  const primaryPath = inputs[0];
  const primary = JSON.parse(fs.readFileSync(primaryPath, "utf8"));
  const supplements = [];
  for (const p of inputs.slice(1)) {
    supplements.push({ file: path.basename(p), report: JSON.parse(fs.readFileSync(p, "utf8")) });
  }

  const splices = [];
  for (const { file, report } of supplements) {
    for (const entry of report.tasks || []) {
      for (const track of ["baseline", "teamwork"]) {
        const incoming = entry[track];
        if (!incoming) continue;
        const target = (primary.tasks || []).find((t) => t.id === entry.id);
        if (!target) {
          throw new Error(`supplement ${file} carries task ${entry.id} which is absent from the primary report`);
        }
        const current = target[track];
        if (!current || !isInfraErroredTrack(current)) {
          throw new Error(
            `refusing to splice ${file}:${entry.id}:${track} — primary track is not infra-errored ` +
              `(abortReason=${current ? current.abortReason : "missing"}); supplements may only replace track-error results`
          );
        }
        if (isInfraErroredTrack(incoming)) {
          throw new Error(`supplement ${file}:${entry.id}:${track} is itself infra-errored; fix the timeout and re-run it`);
        }
        target[track] = incoming;
        splices.push({
          file,
          task: entry.id,
          track,
          replacedAbortReason: current.abortReason,
          replacedTimeMs: current.timeMs,
        });
      }
    }
  }

  primary.meta = primary.meta || {};
  primary.meta.supplements = splices;
  primary.summary = summarize(primary);

  const json = JSON.stringify(primary, null, 2) + "\n";
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, json);
    console.log(`merged ${splices.length} supplemental track(s) from ${supplements.length} file(s) -> ${out}`);
    for (const s of splices) {
      console.log(`  ${s.task} ${s.track}: replaced "${s.replacedAbortReason.slice(0, 60)}…"`);
    }
  } else {
    process.stdout.write(json);
  }
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    console.error(`✖ merge failed: ${err.message}`);
    process.exit(1);
  }
}
