"use strict";

const {
  appendDecisionLog,
  appendEvent,
  loadState,
  makeId,
  nowIso,
  readProfileContext,
  saveState,
} = require("./state");
const { notifyDecisionRequested } = require("./channels");
const { evaluateAuthorization } = require("./authorization/engine");
const { payloadText, toolNameFromPayload } = require("./authorization/intent-parser");

const PRODUCT_NAME = "Second";

function evaluateToolUse(payload = {}) {
  const evaluation = evaluateAuthorization(payload);
  return {
    decision: evaluation.decision,
    action: evaluation.action,
    ok: evaluation.ok,
    risk: evaluation.risk,
    reason: evaluation.reason,
    ruleId: evaluation.ruleId,
    matchedRule: evaluation.matchedRule,
    intent: evaluation.intent,
    fingerprint: evaluation.fingerprint,
    toolName: toolNameFromPayload(payload),
    text: payloadText(payload),
  };
}

function handleHookInvocation(eventName, payload = {}) {
  const evaluation = evaluateToolUse(payload);
  if (evaluation.decision === "allow") {
    return {
      ok: true,
      action: "allow",
      event: eventName,
      reason: evaluation.reason,
    };
  }
  if (evaluation.decision === "deny") {
    recordPolicyEvent(eventName, evaluation);
    return {
      ok: false,
      action: "deny",
      event: eventName,
      risk: evaluation.risk,
      reason: evaluation.reason,
    };
  }
  const decision = createPolicyDecision(eventName, payload, evaluation);
  return {
    ok: false,
    action: "human_gate",
    event: eventName,
    decisionId: decision.id,
    risk: evaluation.risk,
    reason: evaluation.reason,
    instruction: `${PRODUCT_NAME} Human Gate created ${decision.id}. Stop this tool call and wait for approval.`,
  };
}

function createPolicyDecision(eventName, payload, evaluation) {
  const state = loadState();
  const taskId = payload.taskId || payload.task_id || payload.secondTaskId || null;
  const task = taskId ? state.tasks.find((item) => item.id === taskId) : null;
  const id = makeId("D");
  const title = `${evaluation.toolName} 需要 Human Gate 审核`;
  const profile = readProfileContext();
  const decision = {
    id,
    type: eventName === "PermissionRequest" ? "授权" : "审批",
    risk: evaluation.risk,
    title,
    taskId,
    taskTitle: task?.title || payload.prompt || title,
    source: `Codex ${eventName} hook`,
    agent: task?.agent || state.profile.agentName,
    engine: "Codex CLI",
    status: "pending",
    selectedOption: "approve",
    createdAt: nowIso(),
    summary: [
      `${eventName} hook 拦截到高风险动作。`,
      evaluation.reason,
      "",
      "Tool payload:",
      evaluation.text.slice(0, 1000),
    ].join("\n"),
    impact: [
      `tool · ${evaluation.toolName}`,
      "policy · AUTHORIZATION.md",
      `authorization · ${profile.authorization.match(/# Second Authorization/) ? "loaded" : "custom"}`,
    ],
    options: [
      {
        id: "approve",
        label: "批准本次动作",
        description: "仅放行本次工具调用语义,后续同类动作仍会重新进入 Human Gate",
        recommended: true,
      },
      {
        id: "reject",
        label: "拒绝并要求替代方案",
        description: "阻止当前动作,让分身改用更安全路径或输出人工操作清单",
      },
    ],
    artifacts: [],
    authorization: {
      intent: evaluation.intent,
      fingerprint: evaluation.fingerprint,
      ruleId: evaluation.ruleId,
      matchedRule: evaluation.matchedRule,
      granularityAllowed: evaluation.matchedRule?.granularity || ["once"],
      toolName: evaluation.toolName,
      payloadText: evaluation.text.slice(0, 4000),
    },
  };
  if (task?.channel) decision.channel = task.channel;
  if (task?.slack) decision.slack = task.slack;
  state.decisions.unshift(decision);
  if (task) {
    task.status = "needs_human";
    task.decisionId = id;
    task.summary = `Codex hook 已拦截高风险动作,等待 Human Gate 决策 ${id}。`;
    task.trace.push({
      kind: "gate",
      actor: `${PRODUCT_NAME} hook`,
      time: "刚刚",
      title: `Hook 拦截 · ${id}`,
      description: evaluation.reason,
      decisionId: id,
    });
  }
  appendEvent(state, {
    type: "hook.human_gate",
    text: `hook.human_gate ${id} ${evaluation.toolName}`,
    taskId,
    decisionId: id,
  });
  appendDecisionLog({
    event: "hook.human_gate",
    decisionId: id,
    taskId,
    toolName: evaluation.toolName,
    reason: evaluation.reason,
    fingerprint: evaluation.fingerprint,
    ruleId: evaluation.ruleId,
  });
  saveState(state);
  notifyDecisionRequested(decision, task).catch(() => {});
  return decision;
}

function recordPolicyEvent(eventName, evaluation) {
  const state = loadState();
  appendEvent(state, {
    type: "hook.deny",
    text: `hook.deny ${eventName} ${evaluation.toolName}: ${evaluation.reason}`,
  });
  appendDecisionLog({
    event: "hook.deny",
    toolName: evaluation.toolName,
    reason: evaluation.reason,
    fingerprint: evaluation.fingerprint,
    ruleId: evaluation.ruleId,
  });
  saveState(state);
}

module.exports = {
  evaluateToolUse,
  handleHookInvocation,
};
