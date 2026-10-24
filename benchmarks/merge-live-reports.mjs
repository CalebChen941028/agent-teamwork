#!/usr/bin/env node
/**
 * Merge live-eval reports into one auditable dataset. Two merge modes, applied
 * per task entry:
 *
 * 1. Union-add: a supplement task absent from the primary report is appended
 *    whole (both tracks). This is how per-task serial runs
 *    (`live-ab-<model>-task001.json` … `task015.json`) combine into one exam.
 * 2. Infra-error splice: when the primary already carries the task, a
 *    supplemental track may only replace a track that died on infrastructure
 *    (abortReason starts with "track-error:") BEFORE completing a single turn.
 *    Completed tracks are never replaced — the splice log in meta.supplements
 *    records every replacement for audit.
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
  primary.tasks = primary.tasks || [];
  const supplements = [];
  for (const p of inputs.slice(1)) {
    supplements.push({ file: path.basename(p), report: JSON.parse(fs.readFileSync(p, "utf8")) });
  }

  // Auditability guard: merging reports from different models or modes would
  // produce a dataset that answers no well-defined question.
  for (const { file, report } of supplements) {
    for (const key of ["model", "mode", "maxTurns"]) {
      if ((report.meta || {})[key] !== (primary.meta || {})[key]) {
        throw new Error(
          `refusing to merge ${file}: meta.${key}=${JSON.stringify((report.meta || {})[key])} ` +
            `differs from primary ${JSON.stringify((primary.meta || {})[key])}`
        );
      }
    }
  }

  const splices = [];
  const addedTasks = [];
  for (const { file, report } of supplements) {
    for (const entry of report.tasks || []) {
      const target = primary.tasks.find((t) => t.id === entry.id);
      if (!target) {
        // Union-add: the task was never measured in the primary run.
        for (const track of ["baseline", "teamwork"]) {
          if (isInfraErroredTrack(entry[track])) {
            throw new Error(
              `refusing to add ${file}:${entry.id}:${track} — the incoming track is itself infra-errored; ` +
                `re-run it with a longer --timeout-ms before merging`
            );
          }
        }
        primary.tasks.push(entry);
        addedTasks.push({ file, task: entry.id });
        continue;
      }
      for (const track of ["baseline", "teamwork"]) {
        const incoming = entry[track];
        if (!incoming) continue;
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
  if (splices.length > 0) primary.meta.supplements = splices;
  if (addedTasks.length > 0) primary.meta.mergedFromTasks = addedTasks;
  primary.meta.tasksSelected = primary.tasks.map((t) => t.id);
  primary.meta.generatedAt = new Date().toISOString();
  primary.summary = summarize(primary);

  const json = JSON.stringify(primary, null, 2) + "\n";
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, json);
    console.log(`merged ${primary.tasks.length} task(s): ${addedTasks.length} union-added, ${splices.length} infra-error splice(s) -> ${out}`);
    for (const a of addedTasks) console.log(`  + ${a.task} (from ${a.file})`);
    for (const s of splices) console.log(`  ~ ${s.task} ${s.track}: replaced "${String(s.replacedAbortReason).slice(0, 60)}…"`);
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
