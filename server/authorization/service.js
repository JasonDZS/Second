"use strict";

const { evaluateAuthorization } = require("./engine");
const { intentScope } = require("./grants");
const { parseAuthorizationIntent, payloadText, toolNameFromPayload } = require("./intent-parser");
const {
  consumeGrant,
  ensureAuthorizationState,
  expireStaleGrants,
  findMatchingGrant,
  publicGrantSummary,
} = require("./grants");
const { loadAuthorizationPolicy } = require("./policy-loader");
const { quotaGateEvaluation, recordAuthorizationQuota } = require("./quota");
const { redactAuthorizationText, redactAuthorizationValue } = require("./redaction");

const PRODUCT_NAME = "Second";

function authorizeToolUse(body = {}, deps = {}) {
  const {
    appendAuthorizationAudit,
    appendDecisionLog,
    appendEvent,
    loadState,
    makeId,
    nowIso,
    notifyDecisionRequested = async () => {},
    quotaLimits,
    saveState,
  } = deps;
  const dryRun = body.dryRun === true || body.mode === "dry_run";
  const state = loadState();
  ensureAuthorizationState(state);
  const now = nowIso();
  const expiredGrants = dryRun ? [] : expireStaleGrants(state, { now, nowIso });
  const taskId = taskIdFromBody(body);
  const task = taskId ? (state.tasks || []).find((item) => item.id === taskId) : null;
  const intent = parseAuthorizationIntent({
    ...body,
    task_ctx: {
      ...(body.task_ctx || body.taskContext || {}),
      workspace: body.task_ctx?.workspace || body.taskContext?.workspace || task?.workspace || body.workspace,
    },
  });
  const grant = findMatchingGrant(state, intent, { taskId, now });
  const policyResult = loadAuthorizationPolicy();
  let evaluation = evaluateAuthorization(body, {
    intent,
    policyResult,
    grant,
  });
  const quotaTrip = dryRun
    ? null
    : recordAuthorizationQuota(state, intent, evaluation, {
        limits: quotaLimits,
        now,
        taskId,
      });
  evaluation = quotaGateEvaluation(evaluation, quotaTrip);

  const base = responsePayload(evaluation, {
    dryRun,
    grant,
    taskId,
    task,
    state,
    wouldConsumeGrant: Boolean(grant && evaluation.action === "allow"),
  });
  if (dryRun) return base;
  for (const expiredGrant of expiredGrants) {
    auditAuthorization(state, appendAuthorizationAudit, {
      event: "authorization.grant.expire",
      taskId: expiredGrant.taskId,
      decisionId: expiredGrant.decisionId,
      grantId: expiredGrant.id,
      fingerprint: expiredGrant.fingerprint,
      ruleId: expiredGrant.ruleId,
      reason: "Grant expired before authorization check.",
    });
  }
  if (quotaTrip) {
    auditAuthorization(state, appendAuthorizationAudit, {
      event: "authorization.quota.trip",
      action: evaluation.action,
      taskId,
      fingerprint: evaluation.fingerprint,
      ruleId: `quota.${quotaTrip.kind}`,
      intent,
      quota: quotaTrip,
      reason: evaluation.reason,
    });
    appendEvent(state, {
      type: "authorization.quota.trip",
      text: `authorization.quota.trip ${taskId || ""} ${quotaTrip.kind} ${quotaTrip.count}/${quotaTrip.limit}`,
      taskId,
    });
  }

  if (evaluation.action === "allow") {
    if (grant) consumeGrant(grant, { nowIso });
    auditAuthorization(state, appendAuthorizationAudit, {
      event: grant ? "authorization.grant.consume" : "authorization.allow",
      action: evaluation.action,
      taskId,
      fingerprint: evaluation.fingerprint,
      ruleId: evaluation.ruleId,
      decisionId: grant?.decisionId || null,
      grantId: grant?.id || null,
      intent,
      reason: evaluation.reason,
    });
    appendEvent(state, {
      type: grant ? "authorization.grant.consume" : "authorization.allow",
      text: `${grant ? "authorization.grant.consume" : "authorization.allow"} ${evaluation.fingerprint} ${evaluation.ruleId}`,
      taskId,
      decisionId: grant?.decisionId || undefined,
    });
    appendAuthorizationTrace(task, evaluation, grant ? "grant.consume" : "allow");
    saveState(state);
    return {
      ...base,
      grantPreview: grant
        ? {
            id: grant.id,
            type: grant.type,
            status: grant.status,
            decisionId: grant.decisionId,
          }
        : base.grantPreview,
    };
  }

  if (evaluation.action === "deny") {
    auditAuthorization(state, appendAuthorizationAudit, {
      event: "authorization.deny",
      action: evaluation.action,
      taskId,
      fingerprint: evaluation.fingerprint,
      ruleId: evaluation.ruleId,
      intent,
      reason: evaluation.reason,
    });
    appendEvent(state, {
      type: "authorization.deny",
      text: `authorization.deny ${evaluation.fingerprint} ${evaluation.ruleId}: ${evaluation.reason}`,
      taskId,
    });
    appendAuthorizationTrace(task, evaluation, "deny");
    if (task && isTaskContentDeny(body)) {
      task.status = "needs_human";
      appendEvent(state, {
        type: "authorization.suspected_prompt_injection",
        text: `authorization.suspected_prompt_injection ${taskId || ""} ${evaluation.fingerprint}`,
        taskId,
      });
    }
    appendDecisionLog({
      event: "authorization.deny",
      taskId,
      fingerprint: evaluation.fingerprint,
      ruleId: evaluation.ruleId,
      reason: evaluation.reason,
    });
    saveState(state);
    return base;
  }

  const decision = createOrReuseAuthorizationDecision(state, body, evaluation, {
    appendDecisionLog,
    appendEvent,
    makeId,
    nowIso,
    task,
    taskId,
  });
  auditAuthorization(state, appendAuthorizationAudit, {
    event: decision.reused ? "authorization.gate.reuse" : "authorization.gate",
    action: evaluation.action,
    taskId,
    decisionId: decision.id,
    fingerprint: evaluation.fingerprint,
    ruleId: evaluation.ruleId,
    intent,
    reason: evaluation.reason,
  });
  saveState(state);
  notifyDecisionRequested(decision, task).catch(() => {});
  return {
    ...base,
    decisionId: decision.id,
    decision,
    instruction: `${PRODUCT_NAME} Human Gate created ${decision.id}. Stop this tool call and wait for approval.`,
  };
}

function responsePayload(evaluation, context = {}) {
  return {
    ok: evaluation.action === "allow",
    action: evaluation.action,
    decision: evaluation.decision,
    risk: evaluation.risk,
    reason: evaluation.reason,
    ruleId: evaluation.ruleId,
    matchedRule: redactAuthorizationValue(evaluation.matchedRule),
    intent: redactAuthorizationValue(evaluation.intent),
    fingerprint: evaluation.fingerprint,
    policySource: evaluation.policySource,
    policyError: evaluation.policyError,
    dryRun: Boolean(context.dryRun),
    taskId: context.taskId || null,
    wouldCreateDecision: Boolean(context.dryRun && evaluation.action === "gate"),
    wouldConsumeGrant: Boolean(context.dryRun && context.wouldConsumeGrant),
    grantPreview: context.grant
      ? {
          id: context.grant.id,
          type: context.grant.type,
          status: context.grant.status,
          taskId: context.grant.taskId || null,
          decisionId: context.grant.decisionId || null,
          fingerprint: context.grant.fingerprint || null,
        }
      : context.wouldConsumeGrant
      ? {
          type: "once",
          fingerprint: evaluation.fingerprint,
          taskId: context.taskId || null,
        }
      : evaluation.grantPreview,
    grants: context.dryRun ? redactAuthorizationValue(publicGrantSummary(context.state || {})) : undefined,
  };
}

function createOrReuseAuthorizationDecision(state, payload, evaluation, deps = {}) {
  const { appendDecisionLog, appendEvent, makeId, nowIso, task, taskId } = deps;
  const pending = (state.decisions || []).find((decision) => (
    decision.status === "pending" &&
    decision.taskId === (taskId || null) &&
    decision.authorization?.fingerprint === evaluation.fingerprint
  ));
  if (pending) {
    pending.reused = true;
    if (task) markTaskNeedsHuman(task, pending, evaluation);
    appendEvent(state, {
      type: "authorization.gate.reuse",
      text: `authorization.gate.reuse ${pending.id} ${evaluation.fingerprint}`,
      taskId,
      decisionId: pending.id,
    });
    appendDecisionLog({
      event: "authorization.gate.reuse",
      decisionId: pending.id,
      taskId,
      fingerprint: evaluation.fingerprint,
      ruleId: evaluation.ruleId,
    });
    return pending;
  }

  const id = makeId("D");
  const toolName = toolNameFromPayload(payload);
  const title = authorizationTitle(evaluation, toolName);
  const decision = {
    id,
    type: "授权",
    risk: evaluation.risk || "高",
    title,
    taskId: taskId || null,
    taskTitle: task?.title || payload.prompt || title,
    source: payload.source || "Second authorization hook",
    agent: task?.agent || state.profile?.agentName || "Second agent",
    engine: task?.engine || payload.engine || "Codex CLI",
    status: "pending",
    selectedOption: "approve",
    createdAt: nowIso(),
    summary: authorizationSummary(evaluation, payload),
    impact: authorizationImpact(evaluation, toolName),
    options: authorizationOptions(evaluation, payload, task),
    artifacts: [],
    authorization: {
      intent: redactAuthorizationValue(evaluation.intent),
      fingerprint: evaluation.fingerprint,
      ruleId: evaluation.ruleId,
      matchedRule: redactAuthorizationValue(evaluation.matchedRule),
      granularityAllowed: evaluation.matchedRule?.granularity || ["once"],
      planItems: authorizationPlanItems(payload, task),
      toolName,
      payloadText: redactAuthorizationText(payloadText(payload)).slice(0, 4000),
    },
  };
  if (task?.channel) decision.channel = task.channel;
  if (task?.slack) decision.slack = task.slack;
  state.decisions.unshift(decision);
  if (task) markTaskNeedsHuman(task, decision, evaluation);
  appendEvent(state, {
    type: "authorization.gate",
    text: `authorization.gate ${id} ${evaluation.fingerprint} ${evaluation.ruleId}`,
    taskId,
    decisionId: id,
  });
  appendDecisionLog({
    event: "authorization.gate",
    decisionId: id,
    taskId,
    fingerprint: evaluation.fingerprint,
    ruleId: evaluation.ruleId,
    title,
  });
  return decision;
}

function markTaskNeedsHuman(task, decision, evaluation) {
  task.status = "needs_human";
  task.decisionId = decision.id;
  task.summary = `授权策略已拦截动作,等待 Human Gate 决策 ${decision.id}。`;
  if (!Array.isArray(task.trace)) task.trace = [];
  task.trace.push({
    kind: "gate",
    actor: `${PRODUCT_NAME} authorization`,
    time: "刚刚",
    title: `授权拦截 · ${decision.id}`,
    description: `${evaluation.reason} fingerprint=${evaluation.fingerprint}`,
    decisionId: decision.id,
  });
}

function authorizationTitle(evaluation, toolName) {
  const target = evaluation.intent.target?.value || evaluation.intent.target?.scope || "unknown";
  return `${toolName} 请求 ${evaluation.intent.action} · ${target}`;
}

function authorizationSummary(evaluation, payload) {
  return [
    "Second daemon 在工具执行前完成授权判定。",
    `判定: ${evaluation.action}`,
    `原因: ${evaluation.reason}`,
    `规则: ${evaluation.ruleId}`,
    `fingerprint: ${evaluation.fingerprint}`,
    "",
    "Intent:",
    JSON.stringify(redactAuthorizationValue(evaluation.intent), null, 2),
    "",
    "Tool payload:",
    redactAuthorizationText(payloadText(payload)).slice(0, 1200),
  ].join("\n");
}

function authorizationImpact(evaluation, toolName) {
  const intent = evaluation.intent;
  return [
    `tool · ${toolName}`,
    `intent · ${intent.action}/${intent.target?.scope || "unknown"}/${intent.environment}`,
    `rule · ${evaluation.ruleId}`,
    `fingerprint · ${evaluation.fingerprint}`,
  ];
}

function authorizationOptions(evaluation, payload, task) {
  const granularity = new Set((evaluation.matchedRule?.granularity || ["once"]).map((item) => String(item)));
  const options = [
    {
      id: "approve",
      label: "批准本次动作",
      description: "仅放行同一 task 与同一 fingerprint 的下一次工具调用。",
      recommended: true,
    },
  ];
  if (granularity.has("session")) {
    options.push({
      id: "approve_session",
      label: "本任务内同类不再问",
      description: "仅放行本 task 内 action/target/environment/identity 完全一致的动作。",
    });
  }
  if (granularity.has("plan") && authorizationPlanItems(payload, task).length) {
    options.push({
      id: "approve_plan",
      label: "批准此计划",
      description: "仅放行结构化计划中列出的动作范围,计划外动作继续进入 Human Gate。",
    });
  }
  options.push({
    id: "reject",
    label: "拒绝并要求替代方案",
    description: "阻止当前动作,让分身改用更安全路径或输出人工操作清单。",
  });
  return options;
}

function authorizationPlanItems(payload = {}, task = null) {
  const rawItems =
    payload.authorizationPlan?.items ||
    payload.plan?.items ||
    payload.planItems ||
    [];
  if (!Array.isArray(rawItems)) return [];
  return rawItems.slice(0, 20).map((item) => {
    const intent = parseAuthorizationIntent({
      ...item,
      task_ctx: {
        ...(item.task_ctx || item.taskContext || {}),
        workspace: item.task_ctx?.workspace || item.taskContext?.workspace || task?.workspace || payload.workspace,
      },
    });
    return {
      fingerprint: intent.fingerprint,
      scope: intentScope(intent),
      intent: redactAuthorizationValue(intent),
    };
  });
}

function auditAuthorization(state, appendAuthorizationAudit, entry) {
  if (appendAuthorizationAudit) appendAuthorizationAudit(state, redactAuthorizationValue(entry));
}

function appendAuthorizationTrace(task, evaluation, event) {
  if (!task) return;
  if (!Array.isArray(task.trace)) task.trace = [];
  task.trace.push({
    kind: event === "allow" || event === "grant.consume" ? "runtime" : "gate",
    actor: `${PRODUCT_NAME} authorization`,
    time: "刚刚",
    title: `授权 ${event}`,
    description: `${evaluation.ruleId} · ${evaluation.fingerprint}`,
  });
  if (task.trace.length > 500) task.trace = task.trace.slice(-500);
}

function isTaskContentDeny(body = {}) {
  return Boolean(
    body.fromTaskContent ||
      body.promptInjectionCandidate ||
      body.source === "task_content" ||
      body.task_ctx?.source === "task_content" ||
      body.taskContext?.source === "task_content",
  );
}

function taskIdFromBody(body = {}) {
  return (
    body.taskId ||
    body.task_id ||
    body.secondTaskId ||
    body.second_task_id ||
    body.task_ctx?.taskId ||
    body.taskContext?.taskId ||
    null
  );
}

module.exports = {
  authorizeToolUse,
  createOrReuseAuthorizationDecision,
  responsePayload,
  taskIdFromBody,
};
