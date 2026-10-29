/**
 * Pure functions for verification gates, failure output formatting,
 * stall detection signatures, strict path boundary validation,
 * Harness² recursive experience/guardrail management,
 * teamwork gap calculations, and workflow conclusion formatting.
 * Standalone verification gate for agent-teamwork.
 */

export interface FindingLike {
  what: string;
  evidence: string;
  severity: "low" | "medium" | "high";
  status: "verified" | "unconfirmed";
}

export interface MilestoneOutcomeLike {
  milestone: string;
  passed: boolean;
  evidence: string;
  gaps: string[];
  reworkRounds: number;
  superseded?: boolean;
}

export interface ChallengeLike {
  foundIssue?: boolean;
  evidence?: string;
}

/**
 * Harness² Task-Level Adaptation Lever (Invariant vs Domain-Specific)
 */
export interface HarnessGuardrail {
  scope: "invariant" | "domain";
  rule: string;
  evidence: string;
}

/**
 * Harness² Harnessing-Level Experience Entry ({ cue, lesson, evidence })
 * Filters out confounded or speculative attributions.
 */
export interface ExperienceEntry {
  cue: string;
  lesson: string;
  evidence: string;
  verdict?: "helped" | "hurt" | "no_effect" | "confounded";
  confidence?: "high" | "medium" | "low";
}

export interface MilestoneTopology {
  risk: "low" | "medium" | "high" | "critical";
  parallelism: "concurrent" | "sequential";
  adversarialChallenger: boolean;
  criticStrictness: "standard" | "strict" | "exhaustive";
  workerTier: "light" | "heavy" | "adaptive";
  requireMicroTest: boolean;
}

export interface MicroTestPlan {
  testType: "unit" | "smoke" | "syntax" | "ast_shape";
  suggestedCommand: string;
  shapeValidationRule: string;
  synthesizedAssertionSnippet: string;
}

/**
 * Combines stdout and stderr, prioritizing the tail where assertion failures
 * and stack traces reside (B2, C3).
 */
export function formatFailureOutput(
  stdout: string = "",
  stderr: string = "",
  maxLength: number = 2000,
): string {
  const cap = Math.max(0, typeof maxLength === "number" && !isNaN(maxLength) ? Math.floor(maxLength) : 2000);
  if (cap === 0) {
    return "";
  }

  const out = (stdout || "").trim();
  const err = (stderr || "").trim();

  let combined = "";
  if (out && err) {
    combined = `${out}\n--- stderr ---\n${err}`;
  } else {
    combined = out || err;
  }

  if (combined.length <= cap) {
    return combined;
  }

  // Preserve the tail rather than the head
  return combined.slice(-cap);
}

/**
 * Computes a normalized failure signature from test output (B3, C3).
 * Strips volatile elements: line numbers, memory addresses, timestamps, file paths.
 * Takes the last 20 non-empty lines to ensure static initial runner lines
 * (e.g. "> test", "TAP version 13", "pytest ...") do not cause false positives.
 */
export function computeFailureSignature(output: string): string {
  if (!output || !output.trim()) {
    return "empty-failure";
  }

  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return "empty-failure";
  }

  // Take the last 20 lines
  const tailLines = lines.slice(-20);

  const normalized = tailLines.map((line) => {
    return line
      // Strip ISO timestamps or times (HH:MM:SS)
      .replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/gi, "")
      .replace(/\b\d{1,2}:\d{2}:\d{2}(\.\d+)?\b/g, "")
      // Strip hex memory addresses (0x...)
      .replace(/0x[a-f0-9]+/gi, "0xHEX")
      // Strip file line/column numbers (e.g. :42:10 or line 42)
      .replace(/:\d+:\d+/g, ":L:C")
      .replace(/:\d+/g, ":L")
      .replace(/\bline \d+\b/gi, "line N")
      // Strip durations/percentages (e.g. 120ms, 1.4s, 85%)
      .replace(/\b\d+(\.\d+)?(ms|s|m|%)\b/gi, "NUM_UNIT")
      // Strip volatile number constants
      .replace(/\b\d+\b/g, "N")
      // Strip absolute directory paths (/Users/... or /home/...)
      .replace(/(?:\/[\w.-]+){2,}/g, "/PATH")
      .trim();
  });

  return normalized.filter((l) => l.length > 0).join(" | ");
}

/**
 * Computes signature for acceptance gaps across rounds.
 */
export function computeGapSignature(gaps: string[]): string {
  if (!gaps || gaps.length === 0) {
    return "no-gaps";
  }
  return gaps
    .map((g) => {
      const firstLine = g.split("\n").find((l) => l.trim().length > 0) ?? "";
      return firstLine
        .replace(/\d+/g, "N")
        .replace(/(?:\/[\w.-]+){2,}/g, "/PATH")
        .trim();
    })
    .sort()
    .join(" ; ");
}

/**
 * Normalizes a relative file path (strips leading ./ and trailing /).
 */
export function normalizeRelPath(p: string): string {
  return (p || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

/**
 * Checks whether a modified file path is permitted by a list of allowedPaths (C6).
 * Enforces strict path segment boundaries so "src/app" does not match "src/app-other/x.ts",
 * and never checks reverse substring inclusion (which previously allowed "src" when "src/a/b.ts" was specified).
 * Supports exact file matches, directory prefix matches, and simple glob patterns (e.g. "src/*.ts", "**").
 */
export function isPathAllowed(filePath: string, allowedPaths: string[]): boolean {
  const normFile = normalizeRelPath(filePath);
  if (!normFile) return false;
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) return false;

  for (const rawAllowed of allowedPaths) {
    const normAllowed = normalizeRelPath(rawAllowed);
    if (!normAllowed) continue;

    if (normAllowed === "." || normAllowed === "*" || normAllowed === "**") {
      return true;
    }

    // Handle glob patterns containing *
    if (normAllowed.includes("*")) {
      const escaped = normAllowed
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*\//g, "___DOUBLE_STAR_SLASH___")
        .replace(/\*\*/g, "___DOUBLE_STAR___")
        .replace(/\*/g, "[^/]*")
        .replace(/___DOUBLE_STAR_SLASH___/g, "(?:.*/)?")
        .replace(/___DOUBLE_STAR___/g, ".*");
      const regex = new RegExp(`^${escaped}$`);
      if (regex.test(normFile)) {
        return true;
      }
      continue;
    }

    // Exact match or directory boundary prefix match
    if (normFile === normAllowed || normFile.startsWith(`${normAllowed}/`)) {
      return true;
    }
  }

  return false;
}

/**
 * Detects newly modified or untracked files compared to a baseline set of paths,
 * and returns those that violate allowedPaths (C6).
 */
export function findOutOfBoundsFiles(
  currentFiles: string[],
  baselineFiles: string[],
  allowedPaths: string[],
): string[] {
  const baseSet = new Set((baselineFiles || []).map(normalizeRelPath).filter(Boolean));
  const touchedInMilestone = (currentFiles || [])
    .map(normalizeRelPath)
    .filter((f) => Boolean(f) && !baseSet.has(f));

  return Array.from(new Set(touchedInMilestone.filter((f) => !isPathAllowed(f, allowedPaths))));
}

/**
 * Validates whether an ExperienceEntry from Harness² reflection is transferable and non-confounded.
 * Rejects entries marked as "confounded", "hurt", or "no_effect", or entries missing cue/lesson/evidence.
 */
export function isValidExperienceEntry(entry: ExperienceEntry | null | undefined): boolean {
  if (!entry || typeof entry !== "object") return false;
  const cue = typeof entry.cue === "string" ? entry.cue.trim() : "";
  const lesson = typeof entry.lesson === "string" ? entry.lesson.trim() : "";
  const evidence = typeof entry.evidence === "string" ? entry.evidence.trim() : "";

  if (!cue || !lesson || !evidence) return false;
  if (cue.toUpperCase() === "NO_ENTRY" || lesson.toUpperCase() === "NO_ENTRY") return false;

  if (
    entry.verdict &&
    (entry.verdict === "confounded" || entry.verdict === "hurt" || entry.verdict === "no_effect")
  ) {
    return false;
  }

  if (entry.confidence === "low") {
    return false;
  }

  return true;
}

/**
 * Formats active Harness² guardrails (invariant + domain levers) into a compact context block
 * to respect the Context Tax Hierarchy (keep always-on prose minimal and evidence-backed).
 */
export function formatHarnessGuardrails(
  guardrails: HarnessGuardrail[],
  maxItems: number = 6,
  lang: "zh" | "en" = "zh",
): string {
  const cap = Math.max(1, typeof maxItems === "number" && !isNaN(maxItems) ? Math.floor(maxItems) : 6);
  const composed = composeHarnessGuardrails(guardrails || [], [], cap);
  if (composed.length === 0) return "";

  const inv = composed.filter((g) => g.scope === "invariant");
  const dom = composed.filter((g) => g.scope === "domain");

  const lines: string[] = [];
  if (lang === "en") {
    lines.push("[Harness² Active Execution Guardrails]");
    if (inv.length > 0) {
      lines.push("- Invariant Rules: " + inv.map((g) => g.rule.trim()).join(" | "));
    }
    if (dom.length > 0) {
      lines.push("- Domain Rules: " + dom.map((g) => g.rule.trim()).join(" | "));
    }
  } else {
    lines.push("【Harness² 动态执行护栏】");
    if (inv.length > 0) {
      lines.push("- 通用纪律 (Invariant)：" + inv.map((g) => g.rule.trim()).join("；"));
    }
    if (dom.length > 0) {
      lines.push("- 领域护栏 (Domain)：" + dom.map((g) => g.rule.trim()).join("；"));
    }
  }
  return lines.join("\n");
}

/**
 * Formats conclusion reflecting both verification gaps AND reviewer findings.
 * Fixes P0 bug B1: if reviewer found high severity defects, conclusion must not claim success.
 */
export function formatConclusion(
  shortTask: string,
  workstreamCount: number,
  gaps: string[],
  findings: FindingLike[],
  lang: "zh" | "en" = "zh",
): string {
  const highFindings = findings.filter((f) => f.severity === "high");
  const hasGaps = gaps.length > 0;
  const hasHighDefects = highFindings.length > 0;

  if (lang === "en") {
    if (hasGaps && hasHighDefects) {
      return `Task "${shortTask}" completed with unresolved gaps: ${gaps.length} verification gap(s) and ${highFindings.length} high-severity defect(s) pending.`;
    }
    if (hasGaps) {
      return `Task "${shortTask}" implemented but verification incomplete: ${gaps.length} gap(s) remaining.`;
    }
    if (hasHighDefects) {
      return `Task "${shortTask}" executed across ${workstreamCount} workstream(s), but independent review identified ${highFindings.length} high-severity defect(s).`;
    }
    return `Task "${shortTask}" successfully completed and verified: ${workstreamCount} workstream(s) landed; review noted ${findings.length} feedback item(s).`;
  }

  // Chinese
  if (hasGaps && hasHighDefects) {
    return `任务「${shortTask}」实施完成但验收与复核未通过：存在 ${gaps.length} 个验证缺口及 ${highFindings.length} 项高危缺陷，详见报告。`;
  }
  if (hasGaps) {
    return `任务「${shortTask}」已实现但验收未全过：${gaps.length} 个缺口待处理，详见报告与 findings。`;
  }
  if (hasHighDefects) {
    return `任务「${shortTask}」各工作流已落地，但独立复核发现 ${highFindings.length} 项高危缺陷未解决，不能视为已完成。`;
  }
  return `任务「${shortTask}」已完成并通过验证：${workstreamCount} 条工作流落地，独立复核提出 ${findings.length} 条意见。`;
}

/**
 * Validates teamProfile enum value (B7, C7).
 */
export function validateTeamProfile(profile: string): "hybrid" | "quality" | "economy" {
  const p = (profile || "").trim().toLowerCase();
  if (p === "hybrid" || p === "quality" || p === "economy") {
    return p;
  }
  throw new Error(
    `Invalid teamProfile "${profile}". Expected one of: "hybrid", "quality", "economy".`,
  );
}

/**
 * Validates integrityMode enum value (C7).
 */
export function validateIntegrityMode(mode: string): "development" | "demo" | "benchmark" {
  const m = (mode || "").trim().toLowerCase();
  if (m === "development" || m === "demo" || m === "benchmark") {
    return m;
  }
  throw new Error(
    `Invalid integrityMode "${mode}". Expected one of: "development", "demo", "benchmark".`,
  );
}

/**
 * Evaluates whether an adversarial challenger report identifies a substantive issue (C4).
 * Distinguishes genuine evidence from statements indicating "no issues found".
 */
export function isSubstantiveChallenge(challenge: ChallengeLike | null | undefined): boolean {
  return Boolean(
    challenge &&
    challenge.foundIssue === true &&
    typeof challenge.evidence === "string" &&
    challenge.evidence.trim().length > 0,
  );
}

/**
 * Computes open gaps for Teamwork initiatives (C1, C2).
 * Excludes superseded milestones that were replaced by replanning.
 * Counts failed verifyCommand accurately.
 */
export function calculateTeamworkOpenGaps(
  milestoneOutcomes: MilestoneOutcomeLike[],
  auditPassed: boolean,
  verifyCommandRan: boolean,
  verifyPassed: boolean,
): number {
  const failedActiveMilestones = (milestoneOutcomes || []).filter(
    (o) => !o.passed && !o.superseded,
  ).length;

  return (
    failedActiveMilestones +
    (auditPassed ? 0 : 1) +
    (verifyCommandRan && !verifyPassed ? 1 : 0)
  );
}

/**
 * Formats teamwork conclusion text (C1, C2).
 * Strictly prevents claiming "终局验收命令通过" when verifyPassed is false.
 */
export function formatTeamworkConclusion(
  openGaps: number,
  verifyCommandRan: boolean,
  verifyPassed: boolean,
  replansUsed: number = 0,
  lang: "zh" | "en" = "zh",
): string {
  if (lang === "en") {
    if (openGaps === 0) {
      const verifyText = verifyCommandRan && verifyPassed ? ", final verification command passed" : "";
      const replanText = replansUsed > 0 ? ` (with ${replansUsed} ${replansUsed === 1 ? "replan" : "replans"})` : "";
      return `Initiative completed: all milestones passed acceptance${replanText}${verifyText}, audit passed.`;
    }
    const verifyFailText = verifyCommandRan && !verifyPassed ? ", final verification command failed" : "";
    const replanText = replansUsed > 0 ? ` (${replansUsed} ${replansUsed === 1 ? "replan" : "replans"} used)` : "";
    return `Initiative partially completed with ${openGaps} open gap(s)${verifyFailText}${replanText}. See findings and report.`;
  }

  // Chinese
  if (openGaps === 0) {
    const verifyText = verifyCommandRan && verifyPassed ? "，终局验收命令通过" : "";
    return `任务已完成：所有里程碑全部通过验收${replansUsed > 0 ? `（期间整体重规划 ${replansUsed} 次）` : ""}${verifyText}，总审计结论通过。`;
  }
  const verifyFailText = verifyCommandRan && !verifyPassed ? "，终局验收命令未通过" : "";
  return `任务主体完成，但有 ${openGaps} 处验收缺口待处理${verifyFailText}${replansUsed > 0 ? `（已用尽 ${replansUsed} 次整体重规划仍遗留）` : ""}（详见 findings 与报告）。`;
}

/**
 * Resolves model ID and tier from requested name and local models configuration (B11).
 */
export function resolveModelConfiguration(
  requestedName: string,
  localConfig: any = null,
): { modelId: string | null; tier: "light" | "heavy" | "default" } {
  const req = (requestedName || "").trim();
  if (req) {
    if (localConfig && localConfig.models) {
      if (localConfig.models[req]) {
        const m = localConfig.models[req];
        return { modelId: m.id || req, tier: m.tier || "light" };
      }
      const modelsList: any[] = Object.values(localConfig.models);
      for (const val of modelsList) {
        if (val && val.id === req) {
          return { modelId: val.id, tier: val.tier || "light" };
        }
      }
    }
    return { modelId: req, tier: "light" };
  }

  if (localConfig && localConfig.default_light_model) {
    const def = localConfig.default_light_model;
    const m = localConfig.models && localConfig.models[def];
    return { modelId: (m && m.id) || def, tier: "light" };
  }

  return { modelId: null, tier: "default" };
}

/**
 * Hybrid experience retrieval (BM25/Jaccard cue matching + confidence weighting).
 * Replaces naive slice(-6) by scoring relevant cues against task/query context.
 */
export function rankExperienceLibrary(
  library: ExperienceEntry[],
  queryContext: string = "",
  maxItems: number = 6,
): ExperienceEntry[] {
  if (!Array.isArray(library) || library.length === 0) {
    return [];
  }

  const valid = library.filter((e) => isValidExperienceEntry(e));
  if (valid.length === 0) {
    return [];
  }

  const cap = Math.max(1, typeof maxItems === "number" && !isNaN(maxItems) ? Math.floor(maxItems) : 6);
  const q = (queryContext || "").toLowerCase();
  const queryTokens = q.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu) || [];

  if (queryTokens.length === 0) {
    return valid.slice(-cap);
  }

  const queryTokenSet = new Set(queryTokens);

  const scored = valid.map((entry, index) => {
    const cueStr = (entry.cue || "").toLowerCase();
    const lessonStr = (entry.lesson || "").toLowerCase();
    const cueTokens = cueStr.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu) || [];
    const lessonTokens = lessonStr.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu) || [];

    let cueMatches = 0;
    for (const t of cueTokens) {
      if (queryTokenSet.has(t)) {
        cueMatches++;
      } else {
        for (const qt of queryTokenSet) {
          if (qt.length >= 4 && (t === qt + "s" || qt === t + "s" || t === qt + "es" || qt === t + "es")) {
            cueMatches++;
            break;
          }
        }
      }
    }

    let lessonMatches = 0;
    for (const t of lessonTokens) {
      if (queryTokenSet.has(t)) {
        lessonMatches++;
      } else {
        for (const qt of queryTokenSet) {
          if (qt.length >= 4 && (t === qt + "s" || qt === t + "s" || t === qt + "es" || qt === t + "es")) {
            lessonMatches++;
            break;
          }
        }
      }
    }

    const rawScore = cueMatches * 3 + lessonMatches * 1;
    const confWeight =
      entry.confidence === "high" ? 1.5 : entry.confidence === "low" ? 0.5 : 1.0;
    const score = rawScore * confWeight;

    return { entry, score, index };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.index - a.index;
  });

  const matched = scored.filter((s) => s.score > 0).map((s) => s.entry);
  if (matched.length >= cap) {
    return matched.slice(0, cap);
  }

  const result = [...matched];
  const matchedSet = new Set(matched);
  const remaining = valid.filter((e) => !matchedSet.has(e));
  const fillCount = cap - result.length;
  if (fillCount > 0 && remaining.length > 0) {
    result.push(...remaining.slice(-fillCount));
  }

  return result;
}

/**
 * Harness² Guardrail synthesis (deduplication, clustering, conflict resolution, context tax ceiling).
 * Balances invariant and domain guardrails under a strict context ceiling.
 */
export function composeHarnessGuardrails(
  existing: HarnessGuardrail[],
  proposed: HarnessGuardrail[],
  maxItems: number = 6,
): HarnessGuardrail[] {
  const cap = Math.max(1, typeof maxItems === "number" && !isNaN(maxItems) ? Math.floor(maxItems) : 6);
  const all = [...(existing || []), ...(proposed || [])];

  const valid = all.filter(
    (g) => g && typeof g.rule === "string" && g.rule.trim().length > 0,
  );
  if (valid.length === 0) {
    return [];
  }

  const ruleMap = new Map();

  for (const g of valid) {
    const rawRule = g.rule.trim();
    const scope = g.scope === "invariant" ? "invariant" : "domain";
    const evidence = typeof g.evidence === "string" ? g.evidence.trim() : "";
    const normKey = rawRule.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() || rawRule.toLowerCase().trim();

    if (!normKey) continue;

    if (ruleMap.has(normKey)) {
      const prev = ruleMap.get(normKey);
      ruleMap.set(normKey, {
        scope: prev.scope === "invariant" || scope === "invariant" ? "invariant" : "domain",
        rule: prev.scope === "invariant" && scope !== "invariant" ? prev.rule : rawRule,
        evidence: evidence || prev.evidence || "",
      });
    } else {
      ruleMap.set(normKey, {
        scope,
        rule: rawRule,
        evidence,
      });
    }
  }

  const deduplicated = Array.from(ruleMap.values());
  if (deduplicated.length <= cap) {
    return deduplicated;
  }

  const invariants = deduplicated.filter((g) => g.scope === "invariant");
  const domains = deduplicated.filter((g) => g.scope === "domain");

  const invariantSlots = Math.min(invariants.length, Math.max(1, cap - 2));
  const domainSlots = Math.max(0, cap - invariantSlots);

  const resultInvariants = invariantSlots > 0 ? invariants.slice(-invariantSlots) : [];
  const resultDomains = domainSlots > 0 ? domains.slice(-domainSlots) : [];

  const combined = [...resultInvariants, ...resultDomains];
  if (combined.length < cap && invariants.length > resultInvariants.length) {
    const extraNeeded = cap - combined.length;
    combined.unshift(...invariants.slice(-invariantSlots - extraNeeded, -invariantSlots));
  }

  return combined.slice(-cap);
}

/**
 * Dynamic topology routing helper (DyLAN/MacNet multi-agent dynamic topology).
 * Routes Low/Medium/High/Critical risks to appropriate worker, critic, and challenger paths.
 */
export function resolveMilestoneTopology(
  milestone: any = null,
  teamProfile: string = "hybrid",
): MilestoneTopology {
  const ms = milestone && typeof milestone === "object" ? milestone : {};
  const rawRisk = typeof ms.risk === "string" ? ms.risk.trim().toLowerCase() : "";
  const title = typeof ms.title === "string" ? ms.title : "";
  const done = typeof ms.done === "string" ? ms.done : "";
  const items = Array.isArray(ms.items) ? ms.items : [];
  const itemDetails = items
    .map((it) => `${(it && it.detail) || ""} ${Array.isArray(it && it.allowedPaths) ? it.allowedPaths.join(" ") : ""}`)
    .join(" ");

  let risk = "low";
  if (rawRisk === "critical" || rawRisk === "high" || rawRisk === "medium" || rawRisk === "low") {
    risk = rawRisk;
  } else {
    const text = `${title} ${done} ${itemDetails}`.toLowerCase();
    if (/(security|auth|crypto|migration|breaking|kernel|root|database|payment|破坏性|安全|认证|密码|鉴权)/i.test(text)) {
      risk = "critical";
    } else if (/(core|refactor|redesign|protocol|concurrency|race|重构|协议|并发|接口变更)/i.test(text)) {
      risk = "high";
    } else if (items.length > 2 || /(integrate|feature|workflow|集成|新功能|工作流)/i.test(text)) {
      risk = "medium";
    } else {
      risk = "low";
    }
  }

  const prof = (teamProfile || "").trim().toLowerCase();

  let workerTier = "adaptive";
  if (prof === "quality") {
    workerTier = "heavy";
  } else if (prof === "economy") {
    workerTier = "light";
  } else {
    if (risk === "critical" || risk === "high") {
      workerTier = "heavy";
    } else if (risk === "medium") {
      workerTier = "adaptive";
    } else {
      workerTier = "light";
    }
  }

  let hasPathOverlap = false;
  for (let i = 0; i < items.length && !hasPathOverlap; i++) {
    const pathsA = Array.isArray(items[i] && items[i].allowedPaths) ? items[i].allowedPaths : [];
    for (let j = i + 1; j < items.length && !hasPathOverlap; j++) {
      const pathsB = Array.isArray(items[j] && items[j].allowedPaths) ? items[j].allowedPaths : [];
      for (const pA of pathsA) {
        for (const pB of pathsB) {
          if (isPathAllowed(pA, [pB]) || isPathAllowed(pB, [pA])) {
            hasPathOverlap = true;
            break;
          }
        }
        if (hasPathOverlap) break;
      }
    }
  }

  const parallelism = (risk === "critical" || items.length <= 1 || hasPathOverlap) ? "sequential" : "concurrent";

  const adversarialChallenger =
    risk === "critical" || risk === "high" || prof === "quality" || (risk === "medium" && prof !== "economy");

  let criticStrictness = "standard";
  if (risk === "critical") {
    criticStrictness = "exhaustive";
  } else if (risk === "high") {
    criticStrictness = "strict";
  }

  const requireMicroTest = risk === "critical" || risk === "high" || prof === "quality";

  return {
    risk,
    parallelism,
    adversarialChallenger,
    criticStrictness,
    workerTier,
    requireMicroTest,
  };
}

/**
 * Micro-test synthesizer / validation helper for empirical verification without user-supplied verifyCommand.
 * Synthesizes test plans, syntax checks, or deliverable shape lock checks.
 */
export function synthesizeMicroTestPlan(
  deliverablePath: string = "",
  milestoneDone: string = "",
  contextSnippet: string = "",
): MicroTestPlan {
  const normPath = normalizeRelPath(deliverablePath);
  const target = normPath || ".";
  const ext = normPath.includes(".") ? (normPath.split(".").pop() || "").toLowerCase() : "";

  let testType = "smoke";
  let suggestedCommand = "test -s " + target;
  let shapeValidationRule = "File existence and non-empty byte size";
  let synthesizedAssertionSnippet = "assert.ok(fs.existsSync(\"" + target + "\") && fs.statSync(\"" + target + "\").size > 0);";

  if (ext === "ts") {
    testType = "syntax";
    suggestedCommand = "node --check " + normPath;
    shapeValidationRule = "Syntax validity and export symbol contract integrity for " + normPath;
    synthesizedAssertionSnippet = "import(\"./" + normPath + "\").then(mod => { if (!mod) throw new Error(\"Module empty: " + normPath + "\"); });";
  } else if (ext === "js" || ext === "mjs" || ext === "cjs") {
    testType = "syntax";
    suggestedCommand = "node --check " + normPath;
    shapeValidationRule = "Syntax check and export shape conformance for " + normPath;
    synthesizedAssertionSnippet = "import(\"./" + normPath + "\").then(mod => { if (typeof mod !== \"object\") throw new Error(\"Export mismatch: " + normPath + "\"); });";
  } else if (ext === "json") {
    testType = "smoke";
    suggestedCommand = "node -e 'JSON.parse(fs.readFileSync(\"" + normPath + "\", \"utf8\"))'";
    shapeValidationRule = "Strict JSON schema syntax and non-empty root object for " + normPath;
    synthesizedAssertionSnippet = "const data = JSON.parse(fs.readFileSync(\"" + normPath + "\", \"utf8\")); if (!data) throw new Error(\"Empty JSON: " + normPath + "\");";
  } else if (ext === "py") {
    testType = "syntax";
    suggestedCommand = "python3 -m py_compile " + normPath;
    shapeValidationRule = "Python syntax compilation and module import check for " + normPath;
    synthesizedAssertionSnippet = "import py_compile; py_compile.compile(\"" + normPath + "\", doraise=True)";
  } else if (ext === "sh" || ext === "bash") {
    testType = "syntax";
    suggestedCommand = "bash -n " + normPath;
    shapeValidationRule = "Shell script syntax dry-run verification for " + normPath;
    synthesizedAssertionSnippet = "bash -n " + normPath;
  } else if (ext === "go") {
    testType = "syntax";
    suggestedCommand = "go vet ./" + (normPath ? (normPath.endsWith(".go") ? normPath : normPath + "/...") : "...");
    shapeValidationRule = "Go vet static compilation and package integrity for " + normPath;
    synthesizedAssertionSnippet = "go vet ./" + normPath;
  } else if (ext === "rs") {
    testType = "syntax";
    suggestedCommand = "cargo check";
    shapeValidationRule = "Rust cargo type check and compilation integrity";
    synthesizedAssertionSnippet = "cargo check";
  } else if (ext === "md" || ext === "markdown" || ext === "txt") {
    testType = "ast_shape";
    suggestedCommand = "test -s " + (normPath || "README.md");
    shapeValidationRule = "Markdown heading structure and non-empty deliverable shape for " + (normPath || "document");
    synthesizedAssertionSnippet = "const content = fs.readFileSync(\"" + (normPath || "README.md") + "\", \"utf8\"); if (!content.trim()) throw new Error(\"Deliverable empty\");";
  }

  if (milestoneDone && milestoneDone.trim()) {
    shapeValidationRule += " (Must satisfy: " + milestoneDone.trim().slice(0, 100) + ")";
  }

  return {
    testType,
    suggestedCommand,
    shapeValidationRule,
    synthesizedAssertionSnippet,
  };
}
