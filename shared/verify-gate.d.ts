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

export interface HarnessGuardrail {
  scope: "invariant" | "domain";
  rule: string;
  evidence: string;
}

export interface ExperienceEntry {
  cue: string;
  lesson: string;
  evidence: string;
  verdict?: "helped" | "hurt" | "no_effect" | "confounded";
  confidence?: "high" | "medium" | "low";
}

export function formatFailureOutput(
  stdout?: string,
  stderr?: string,
  maxLength?: number,
): string;

export function computeFailureSignature(output: string): string;

export function computeGapSignature(gaps: string[]): string;

export function normalizeRelPath(p: string): string;

export function isPathAllowed(filePath: string, allowedPaths: string[]): boolean;

export function findOutOfBoundsFiles(
  currentFiles: string[],
  baselineFiles: string[],
  allowedPaths: string[],
): string[];

export function isValidExperienceEntry(entry: ExperienceEntry | null | undefined): boolean;

export function formatHarnessGuardrails(
  guardrails: HarnessGuardrail[],
  maxItems?: number,
  lang?: "zh" | "en",
): string;

export function formatConclusion(
  shortTask: string,
  workstreamCount: number,
  gaps: string[],
  findings: FindingLike[],
  lang?: "zh" | "en",
): string;

export function validateTeamProfile(profile: string): "hybrid" | "quality" | "economy";

export function validateIntegrityMode(mode: string): "development" | "demo" | "benchmark";

export function isSubstantiveChallenge(challenge: ChallengeLike | null | undefined): boolean;

export function calculateTeamworkOpenGaps(
  milestoneOutcomes: MilestoneOutcomeLike[],
  auditPassed: boolean,
  verifyCommandRan: boolean,
  verifyPassed: boolean,
): number;

export function formatTeamworkConclusion(
  openGaps: number,
  verifyCommandRan: boolean,
  verifyPassed: boolean,
  replansUsed?: number,
  lang?: "zh" | "en",
): string;

export function resolveModelConfiguration(
  requestedName: string,
  localConfig?: any,
): { modelId: string | null; tier: "light" | "heavy" | "default" };

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

export function rankExperienceLibrary(
  library: ExperienceEntry[],
  queryContext?: string,
  maxItems?: number,
): ExperienceEntry[];

export function composeHarnessGuardrails(
  existing: HarnessGuardrail[],
  proposed: HarnessGuardrail[],
  maxItems?: number,
): HarnessGuardrail[];

export function resolveMilestoneTopology(
  milestone?: any,
  teamProfile?: string,
): MilestoneTopology;

export function synthesizeMicroTestPlan(
  deliverablePath?: string,
  milestoneDone?: string,
  contextSnippet?: string,
): MicroTestPlan;
