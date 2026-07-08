"use strict";

const DEFAULT_QUOTA_LIMITS = Object.freeze({
  maxCommandsPerTask: 500,
  maxFileReadsPerTask: 2000,
  maxFileWritesPerTask: 300,
  maxGateDenyPerTask: 20,
  maxExternalRequestsPerTask: 80,
});

function recordAuthorizationQuota(state, intent = {}, evaluation = {}, options = {}) {
  const taskId = options.taskId || null;
  if (!taskId) return null;
  const limits = {
    ...DEFAULT_QUOTA_LIMITS,
    ...(state.settings?.authorizationQuotas || {}),
    ...(options.limits || {}),
  };
  const quota = quotaForTask(state, taskId);
  quota.total += 1;
  if (intent.toolName === "Bash" || intent.action === "exec") quota.commands += 1;
  if (intent.action === "read") quota.fileReads += 1;
  if (intent.action === "write") quota.fileWrites += 1;
  if (intent.action === "communicate" || intent.environment === "external") quota.externalRequests += 1;
  if (["gate", "deny"].includes(evaluation.action)) quota.gateDeny += 1;

  const trip =
    exceeded("command_count", quota.commands, limits.maxCommandsPerTask) ||
    exceeded("file_read_count", quota.fileReads, limits.maxFileReadsPerTask) ||
    exceeded("file_write_count", quota.fileWrites, limits.maxFileWritesPerTask) ||
    exceeded("gate_deny_spike", quota.gateDeny, limits.maxGateDenyPerTask) ||
    exceeded("external_request_count", quota.externalRequests, limits.maxExternalRequestsPerTask);
  if (!trip) return null;

  const existing = quota.tripped.find((item) => item.kind === trip.kind);
  if (existing) {
    existing.count = trip.count;
    existing.limit = trip.limit;
    return existing;
  }
  const entry = {
    ...trip,
    at: options.now || new Date().toISOString(),
    fingerprint: intent.fingerprint || "",
  };
  quota.tripped.push(entry);
  return entry;
}

function quotaForTask(state, taskId) {
  if (!state.authorization) state.authorization = {};
  if (!state.authorization.quotas) state.authorization.quotas = {};
  if (!state.authorization.quotas[taskId]) {
    state.authorization.quotas[taskId] = {
      total: 0,
      commands: 0,
      fileReads: 0,
      fileWrites: 0,
      gateDeny: 0,
      externalRequests: 0,
      tripped: [],
    };
  }
  return state.authorization.quotas[taskId];
}

function quotaGateEvaluation(evaluation, trip) {
  if (!trip || evaluation.action === "deny") return evaluation;
  return {
    ...evaluation,
    action: "gate",
    decision: "human_gate",
    ok: false,
    risk: "高",
    reason: `Authorization quota tripped: ${trip.kind} ${trip.count}/${trip.limit}`,
    ruleId: `quota.${trip.kind}`,
    matchedRule: {
      id: `quota.${trip.kind}`,
      action: evaluation.intent?.action || "unknown",
      reason: `Quota ${trip.kind} exceeded ${trip.limit}`,
      quota: trip,
    },
  };
}

function exceeded(kind, count, limit) {
  if (!Number.isFinite(Number(limit)) || Number(limit) < 1) return null;
  return count > Number(limit) ? { kind, count, limit: Number(limit) } : null;
}

module.exports = {
  DEFAULT_QUOTA_LIMITS,
  quotaGateEvaluation,
  quotaForTask,
  recordAuthorizationQuota,
};
