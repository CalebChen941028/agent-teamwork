/* zcode-workflow
description: Teamwork 多智能体团队（混合编队 + 高度/广度增强）：范围访谈追问目标背后的目标，编排者先做名词转动词改写、跨域借方法，再拆里程碑并行施工（强/轻模型分层、文件互不重叠，allSettled容错）→ 逐里程碑质检验收与结构化对抗挑战（每里程碑独立上下文）→ 事实账本 + 停滞重规划（失效里程碑标记为 superseded）→ 终局验收命令驱动修复与端到端审计。
whenToUse: 用户输入 /teamwork，或要求以多智能体团队方式推进大型多步骤任务时。单点小任务不要用。启动前必须先与用户完成范围访谈。
args:
  task:
    type: string
    description: 与用户确认过的任务范围说明全文（含目标背后的目标）：目标、验收标准、范围边界、涉及模块
    required: true
  verifyCommand:
    type: string
    description: 终局验收命令（如 npm test）；收尾统一运行并驱动修复，最多 3 轮。留空则依赖各里程碑的验收证据
    required: false
    default: ""
  integrityMode:
    type: string
    description: 诚信模式：development（质检验收把关）/ demo（另加对抗挑战员二次攻击，防夸大）/ benchmark（最严，每条结论要求亲自运行命令或读代码的证据）
    required: false
    default: development
  teamProfile:
    type: string
    description: 编队档位：hybrid（编排者按难度分层，机械/文档/配置类用轻量模型）/ quality（全强模型）/ economy（全部施工下沉轻量模型）；把关角色永不降级
    required: false
    default: hybrid
  lightModel:
    type: string
    description: 轻量模型 id 或别名（仅 hybrid/economy 档生效）；留空则默认继承强模型或本地配置
    required: false
    default: ""
  lang:
    type: string
    description: 语言偏好：auto / zh / en
    required: false
    default: auto
*/

interface MilestoneItem {
  id: string;
  detail: string;
  allowedPaths: string[];
  tier: "heavy" | "light";
}

interface Milestone {
  title: string;
  done: string;
  items: MilestoneItem[];
}

interface TeamPlan {
  understanding: string;
  restatedGoal: string;
  milestones: Milestone[];
}

interface WorkerResult {
  id: string;
  summary: string;
  paths: string[];
  notes: string;
}

interface GateVerdict {
  passed: boolean;
  evidence: string;
  gaps: string[];
}

interface ChallengeResult {
  foundIssue: boolean;
  evidence: string;
}

interface MilestoneOutcome {
  milestone: string;
  passed: boolean;
  evidence: string;
  gaps: string[];
  reworkRounds: number;
  superseded?: boolean; // C2: Flag for superseded failed milestones after replanning
}

interface Finding {
  what: string;
  evidence: string;
  severity: "low" | "medium" | "high";
  status: "verified" | "unconfirmed";
}

interface WorkflowReport {
  conclusion: string;
  findings: Finding[];
  verified: string[];
  notCovered: string[];
}

// C7: Validate integrityMode and teamProfile enums
const rawIntegrity = String(args.integrityMode ?? "development").trim().toLowerCase();
if (rawIntegrity !== "development" && rawIntegrity !== "demo" && rawIntegrity !== "benchmark") {
  throw new Error(`非法 integrityMode「${args.integrityMode}」：仅支持 development、demo、benchmark`);
}
const integrityMode: "development" | "demo" | "benchmark" = rawIntegrity;
const adversarial = integrityMode === "demo" || integrityMode === "benchmark";
const strictEvidence = integrityMode === "benchmark";

const rawTeamProfile = String(args.teamProfile ?? "hybrid").trim().toLowerCase();
if (rawTeamProfile !== "hybrid" && rawTeamProfile !== "quality" && rawTeamProfile !== "economy") {
  throw new Error(`非法 teamProfile「${args.teamProfile}」：仅支持 hybrid、quality、economy`);
}
const teamProfile: "hybrid" | "quality" | "economy" = rawTeamProfile;

const task = String(args.task ?? "").trim();
if (!task) throw new Error("缺少 task 参数：请传入与用户确认过的任务范围说明");

const verifyCommand = String(args.verifyCommand ?? "").trim();
const MAX_REWORK = 3;

// Language determination
const rawLang = String(args.lang ?? "auto").trim().toLowerCase();
const isEn = rawLang === "en" || (rawLang === "auto" && !/[\u4e00-\u9fff]/.test(task));

// Pure helper: combine stdout+stderr and preserve TAIL (C3)
function formatFailureOutput(out: string = "", err: string = "", maxLen: number = 2000): string {
  const o = (out || "").trim();
  const e = (err || "").trim();
  const combined = o && e ? `${o}\n--- stderr ---\n${e}` : (o || e);
  if (combined.length <= maxLen) return combined;
  return combined.slice(-maxLen);
}

// Model configuration: clean, support models.local.json (B11, C7)
let localModelConfig: any = null;
try {
  const cfgRes = await world.run("sh", [
    "-c",
    "cat models.local.json 2>/dev/null || cat ~/.config/agent-boost/models.local.json 2>/dev/null || true",
  ]);
  if (cfgRes.exitCode === 0 && cfgRes.stdout.trim()) {
    localModelConfig = JSON.parse(cfgRes.stdout.trim());
  }
} catch {
  // Ignore config reading errors, fall back to args
}

const lightModelArg = String(args.lightModel ?? "").trim();
let pickedLightId = "";
if (lightModelArg) {
  if (localModelConfig?.models?.[lightModelArg]?.id) {
    pickedLightId = localModelConfig.models[lightModelArg].id;
  } else {
    pickedLightId = lightModelArg;
  }
} else if (localModelConfig?.default_light_model) {
  const def = localModelConfig.default_light_model;
  pickedLightId = localModelConfig.models?.[def]?.id ?? def;
}

const lightTier: AgentOptions = pickedLightId ? { model: model(pickedLightId) } : {};

const factsLedger: string[] = [];
let replansLeft = 1;
const notCovered: string[] = [];

artifact.board("milestones", {
  title: isEn ? "Milestone Board" : "里程碑进展",
  key: "milestone",
  status: "status",
  columns: isEn ? ["In Progress", "Submitted", "Passed", "Has Issues"] : ["施工中", "已提交", "通过", "有遗留"],
  cardTitle: "milestone",
});

phase(isEn ? "Assemble team & plan milestones" : "组建团队并规划里程碑");

const orchestrator = agent(isEn ? "Project Orchestrator" : "项目编排", {
  system: isEn
    ? "You are the project orchestrator. Inspect workspace, convert nominal tasks to action verbs, and decompose into sequential milestones. Assign mutually exclusive allowedPaths for parallel items within each milestone."
    : "你是项目编排者。先勘察工作区，再把任务拆成依赖清晰的里程碑；每个里程碑拆成可并行、文件互不重叠的工作项，并写明允许改动的文件。拆解前先做动词化改写（restatedGoal），积极借用现成工程方法。",
});

const teamPlan = await orchestrator.ask<TeamPlan>(
  `${isEn ? "Initiative scope (user-confirmed)" : "任务范围（已与用户确认）"}：\n${task}\n${
    verifyCommand
      ? (isEn ? `Final verification command: ${verifyCommand}` : `最终验收命令：${verifyCommand}`)
      : (isEn ? "No final verification command provided; plan actionable acceptance per milestone." : "未提供统一验收命令，请在计划中为每个里程碑写明可操作的验收方式。")
  }\n${isEn ? "Inspect workspace (read-only), complete verb restatement (restatedGoal), then split into milestones." : "请先勘察工作区（只读），再给出团队计划：先完成动词化改写（restatedGoal），再拆里程碑。为每个工作项标 tier（light / heavy）。"}`,
);

log(isEn ? `Team assembled: ${teamPlan.milestones.length} milestones planned` : `团队组建完成：${teamPlan.milestones.length} 个里程碑`);

const milestoneOutcomes: MilestoneOutcome[] = [];
let queue: Milestone[] = [...teamPlan.milestones];
const MAX_TOTAL_MILESTONES = teamPlan.milestones.length + 3;
let executed = 0;

while (queue.length > 0 && executed < MAX_TOTAL_MILESTONES) {
  executed += 1;
  const ms = queue[0];
  queue = queue.slice(1);

  log(`第 ${executed} 个里程碑开工：${ms.title}`);
  report({ milestone: ms.title, status: isEn ? "In Progress" : "施工中" }, "milestones");
  const priorFacts = factsLedger.slice(-8).join("\n");

  phase(isEn ? `Milestone ${executed}: Parallel Construction` : `并行施工里程碑 ${executed}：${ms.title}`);

  // C7: Promise.allSettled with single retry on failure
  const settledWorkers = await Promise.allSettled(
    ms.items.map(async (item, i) => {
      const useLight = teamProfile === "economy" || (teamProfile === "hybrid" && item.tier === "light");
      const workerName = `施工-${executed}-${i + 1}-${item.id}`;
      const workerAgent = agent(workerName, useLight ? lightTier : {});
      const prompt = `整体任务范围：${task}\n团队前情账本：\n${priorFacts || "（首个里程碑，无前情）"}\n当前里程碑「${ms.title}」，完成标准：${ms.done}\n你的工作项（只允许改动这些路径，列表外一律不碰：${item.allowedPaths.join("、")}）：\n${item.detail}\n完成后重读自查。`;

      try {
        return await workerAgent.ask<WorkerResult>(prompt);
      } catch (err: any) {
        log(`工作项「${item.id}」执行异常，升级强模型重试一次...`);
        const retryWorker = agent(`${workerName}-retry`);
        return await retryWorker.ask<WorkerResult>(`重试执行工作项。\n${prompt}`);
      }
    }),
  );

  const workerResults: WorkerResult[] = settledWorkers.map((w, idx) => {
    if (w.status === "fulfilled") {
      report({ milestone: ms.title, item: w.value.id, summary: w.value.summary, paths: w.value.paths, notes: w.value.notes });
      return w.value;
    }
    const fallback: WorkerResult = {
      id: ms.items[idx].id,
      summary: `Failed to construct item: ${String(w.reason)}`,
      paths: [],
      notes: "Worker failed after retry",
    };
    report({ milestone: ms.title, item: fallback.id, summary: fallback.summary, paths: [], notes: fallback.notes });
    return fallback;
  });

  phase(isEn ? `Milestone ${executed}: Acceptance & Adversarial Gate` : `里程碑 ${executed} 对抗验收：${ms.title}`);

  // C5: Fresh context per milestone for critic, challenger, and reworker
  const critic = agent(`质检验收-${executed}`, {
    system: "你是里程碑验收员。亲自检查施工结果对应的真实文件与运行状态（不要修改文件），只依据亲眼所见下结论。证据不足就判未通过。",
  });

  let gate = await critic.ask<GateVerdict>(
    `验收里程碑「${ms.title}」。\n完成标准：${ms.done}\n团队前情账本：${priorFacts || "无"}\n施工结果：${JSON.stringify(workerResults)}\n请亲自核对工作区真实状态后给结论。${
      strictEvidence ? "诚信模式为 benchmark：每条结论都要有你亲自运行命令或亲自读代码的证据。" : ""
    }`,
  );

  // C4: Structured challenge output so "找不到" does not falsely trigger rework
  if (adversarial) {
    const challenger = agent(`对抗挑战-${executed}`, {
      system: "你的唯一任务是设法证明里程碑没有真正完成。严格输出 JSON 结构：{\"foundIssue\": boolean, \"evidence\": string}。若找不到确凿实证，foundIssue 必须为 false。",
    });

    const challenge = await challenger.ask<ChallengeResult>(
      `设法证明里程碑「${ms.title}」（完成标准：${ms.done}）未真正完成。施工结果：${JSON.stringify(workerResults)}\n质检结论：${JSON.stringify(gate)}\n以 JSON 结构输出判定：{\"foundIssue\": boolean, \"evidence\": string}。`,
    );

    if (challenge && challenge.foundIssue && challenge.evidence && challenge.evidence.trim().length > 0) {
      log(`对抗挑战员发现疑点，请质检验收员复核`);
      gate = await critic.ask<GateVerdict>(
        `挑战者提出以下实证疑点，请复核并更新验收结论（仍是同一里程碑）：\n${challenge.evidence}`,
      );
    }
  }

  // C6: Rework with fresh agent and explicit allowedPaths
  let reworkRounds = 0;
  const reworker = agent(`返工-${executed}`, {
    system: "你负责修复验收提出的缺口。改动尽量小、不绕过检查；只在分配给该工作项的 allowedPaths 范围内修改，严禁越界修改其他文件。",
  });

  const msAllowedPathsSummary = ms.items.map((it) => `${it.id} 路径: ${it.allowedPaths.join("、")}`).join("；");

  while (!gate.passed && reworkRounds < MAX_REWORK) {
    reworkRounds += 1;
    report({ milestone: ms.title, status: isEn ? "In Progress" : "施工中" }, "milestones");
    await reworker.ask(
      `里程碑「${ms.title}」验收未通过，请修复以下缺口。\n注意允许修改的文件路径范围（严禁越界）：\n${msAllowedPathsSummary}\n缺口清单：\n${gate.gaps.join("\n")}`,
    );
    gate = await critic.ask<GateVerdict>(
      `返工后请重新验收里程碑「${ms.title}」。完成标准：${ms.done}${
        reworkRounds > 1 ? `（第 ${reworkRounds} 轮复验）` : ""
      }`,
    );
  // C6: Check git diff against milestone allowedPaths
  try {
    const diffRes = await world.run("sh", ["-c", "git diff --name-only 2>/dev/null || true"]);
    if (diffRes.exitCode === 0 && diffRes.stdout.trim()) {
      const changedFiles = diffRes.stdout.trim().split("\n").map((f) => f.trim()).filter(Boolean);
      const allAllowed = ms.items.flatMap((it) => it.allowedPaths);
      const outOfBounds = changedFiles.filter((f) => !allAllowed.some((ap) => f.startsWith(ap) || ap.includes(f)));
      if (outOfBounds.length > 0) {
        log(isEn
          ? `Warning: out-of-bounds file modifications detected for milestone "${ms.title}": ${outOfBounds.join(", ")}`
          : `警告：检测到文件越界修改（超出里程碑「${ms.title}」allowedPaths）：${outOfBounds.join("、")}`);
      }
    }
  } catch {
    // Non-git environment
  }

  const outcome: MilestoneOutcome = {
    milestone: ms.title,
    passed: gate.passed,
    evidence: gate.evidence,
    gaps: gate.gaps,
    reworkRounds,
  };
  milestoneOutcomes.push(outcome);

  report({ milestone: ms.title, status: gate.passed ? (isEn ? "Passed" : "通过") : (isEn ? "Has Issues" : "有遗留") }, "milestones");
  report(outcome);
  factsLedger.push(`「${ms.title}」${gate.passed ? "已通过验收" : "未通过验收"}：${gate.evidence.split("\n")[0]}`);

  // C2: When rework fails after MAX_REWORK rounds and replanning triggers, mark outcome as superseded
  if (!gate.passed && replansLeft > 0) {
    phase(isEn ? "Overall Replanning triggered by stall" : "停滞时整体重规划");
    replansLeft -= 1;
    outcome.superseded = true; // Mark as superseded so it is NOT counted as open gap in final audit!
    log(`里程碑「${ms.title}」返工 ${MAX_REWORK} 轮仍未通过，触发整体重规划（原失败记录标记为 superseded）`);

    const replanned = await orchestrator.ask<TeamPlan>(
      `里程碑「${ms.title}」在 ${MAX_REWORK} 轮返工后仍未通过验收。\n失败事实：${JSON.stringify(outcome)}\n团队前情账本：\n${factsLedger.join("\n")}\n原剩余里程碑计划：${JSON.stringify(queue)}\n请重新规划「尚未完成的全部工作」（含该里程碑的残留缺口）。只输出新计划。`,
    );
    queue = [...replanned.milestones];
    teamPlan.milestones = [...teamPlan.milestones, ...replanned.milestones];
    log(`重规划完成：剩余工作重组为 ${queue.length} 个里程碑`);
  }
}

if (queue.length > 0) {
  notCovered.push(`执行上限（${MAX_TOTAL_MILESTONES} 个里程碑）触顶，${queue.length} 个重规划后的里程碑未执行：${queue.map((q) => q.title).join("、")}`);
}

phase(isEn ? "Final Acceptance & Comprehensive Audit" : "终局验收与全面审计");

// C1: verifyCommand failure must record verifyPassed = false and add to openGaps
let finalEvidence = "";
let verifyPassed = false;
let verifyCommandRan = false;

if (verifyCommand) {
  verifyCommandRan = true;
  const reworkerFinal = agent("终局修复", {
    system: "你负责修复终局验收命令暴露的问题。以最小改动解决问题并保持测试通过。",
  });

  for (let round = 1; round <= MAX_REWORK; round++) {
    const run = await world.run("sh", ["-c", verifyCommand]);
    if (run.exitCode === 0) {
      finalEvidence = `${verifyCommand} 通过（退出码 0）`;
      verifyPassed = true;
      break;
    }
    // C3: tail slice error outputs
    const failOut = formatFailureOutput(run.stdout, run.stderr, 2000);
    finalEvidence = `${verifyCommand} 退出码 ${run.exitCode}：\n${failOut}`;
    verifyPassed = false;

    if (round < MAX_REWORK) {
      log(`终局验收未通过（第 ${round} 轮），交修复同事处理`);
      await reworkerFinal.ask(`终局验收命令失败，请修复：\n${finalEvidence}\n修完即可，完整验证由脚本统一运行。`);
    }
  }
} else {
  finalEvidence = isEn ? "No final verification command provided" : "未提供统一验收命令";
  // C8: Deduplicate notCovered (only pushed once)
  notCovered.push("未提供 verifyCommand，未运行统一验收命令，完成度以各里程碑验收证据为准");
}

const auditor = agent(isEn ? "End-to-End Auditor" : "总审计", {
  system: "你是终局审计员，代表用户做端到端把关。对照任务范围逐条核对各里程碑的验收记录与真实工作区状态。识别夸大与未解决缺口。",
});

const replansUsed = 1 - replansLeft;
const audit = await auditor.ask<GateVerdict>(
  `任务范围：${task}\n各里程碑验收记录（含重规划前后的完整历史，重规划 ${replansUsed} 次）：${JSON.stringify(milestoneOutcomes)}\n终局验收命令证据：${finalEvidence} (通过状态: ${verifyPassed})\n请做端到端审计并给结论。`,
);

phase(isEn ? "Synthesis & Deliverables" : "汇总并交付");

const scribe = agent(isEn ? "Report Scribe" : "报告撰写", {
  system: "汇总全过程产出 Markdown 交付报告。明确区分已验证与未验证内容。",
  ...(teamProfile === "quality" ? {} : lightTier),
});

const reportMd = await scribe.ask<string>(
  `撰写最终交付报告全文（直接返回 Markdown 文本，不要写文件）。\n任务范围：${task}\n团队计划：${JSON.stringify(teamPlan)}\n里程碑验收记录：${JSON.stringify(milestoneOutcomes)}\n终局验收证据：${finalEvidence} (通过状态: ${verifyPassed})\n总审计结论：${JSON.stringify(audit)}`,
);

await artifact.markdown("report", reportMd, {
  title: isEn ? "Teamwork Initiative Report" : "Teamwork 团队协作报告",
  description: isEn ? "Full audit of milestone construction, adversarial checks, and final verification." : "各里程碑施工、对抗验收与终局审计的完整记录。",
  primary: true,
});

// Findings assembly
const findings: Finding[] = audit.passed
  ? []
  : audit.gaps.map(
      (g): Finding => ({
        what: `终局审计缺口：${g.split("\n")[0]}`,
        evidence: g,
        severity: "high",
        status: "verified",
      }),
    );

// C2: Only active, non-superseded failed milestones add to findings!
for (const o of milestoneOutcomes) {
  if (!o.passed && !o.superseded) {
    findings.push({
      what: `里程碑「${o.milestone}」未完全通过验收`,
      evidence: o.gaps.join("；"),
      severity: "high",
      status: "verified",
    });
  }
}

// C1: If verifyCommand ran and failed, add finding
if (verifyCommandRan && !verifyPassed) {
  findings.push({
    what: `终局验收命令执行失败：${verifyCommand}`,
    evidence: finalEvidence,
    severity: "high",
    status: "verified",
  });
}

const verified: string[] = [
  `每个里程碑经质检验收员独立核对${adversarial ? "，并经对抗挑战员二次攻击" : ""}`,
  `总审计员端到端审查（结论：${audit.passed ? "通过" : "未全过"}）`,
];
if (verifyCommandRan && verifyPassed) {
  verified.push(`终局命令验收：${finalEvidence}`);
}

// C1 & C2: Calculate openGaps accurately
// Exclude superseded milestones, and include failed verifyCommand
const failedActiveMilestones = milestoneOutcomes.filter((o) => !o.passed && !o.superseded).length;
const openGaps =
  failedActiveMilestones +
  (audit.passed ? 0 : 1) +
  (verifyCommandRan && !verifyPassed ? 1 : 0);

// C1: Fix conclusion text: ONLY say "终局验收命令通过" if verifyPassed === true
let conclusion = "";
if (openGaps === 0) {
  const verifyText = verifyCommandRan && verifyPassed ? "，终局验收命令通过" : "";
  conclusion = isEn
    ? `Initiative completed: all milestones passed acceptance${replansUsed > 0 ? ` (with ${replansUsed} replan)` : ""}${verifyText}, audit passed.`
    : `任务已完成：所有里程碑全部通过验收${replansUsed > 0 ? `（期间整体重规划 ${replansUsed} 次）` : ""}${verifyText}，总审计结论通过。`;
} else {
  const verifyFailText = verifyCommandRan && !verifyPassed ? "，终局验收命令未通过" : "";
  conclusion = isEn
    ? `Initiative partially completed with ${openGaps} open gap(s)${verifyFailText}${replansUsed > 0 ? ` (${replansUsed} replans used)` : ""}. See findings and report.`
    : `任务主体完成，但有 ${openGaps} 处验收缺口待处理${verifyFailText}${replansUsed > 0 ? `（已用尽 ${replansUsed} 次整体重规划仍遗留）` : ""}（详见 findings 与报告）。`;
}

return { conclusion, findings, verified, notCovered };
