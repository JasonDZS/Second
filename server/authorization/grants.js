"use strict";

function ensureAuthorizationState(state) {
  if (!state.authorization) state.authorization = {};
  if (!Array.isArray(state.authorization.grants)) state.authorization.grants = [];
  if (!Array.isArray(state.authorization.audit)) state.authorization.audit = [];
  if (!state.authorization.quotas || typeof state.authorization.quotas !== "object") state.authorization.quotas = {};
  return state.authorization;
}

function findMatchingGrant(state, intent, options = {}) {
  const taskId = options.taskId || null;
  const now = Date.parse(options.now || new Date().toISOString());
  const authorization = ensureAuthorizationState(state || {});
  return authorization.grants.find((grant) => {
    if (grant.status !== "active") return false;
    if (grant.taskId && grant.taskId !== taskId) return false;
    if (grant.taskId && taskIsTerminal(state, grant.taskId)) return false;
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= now) return false;
    if (grant.type === "once") return grant.fingerprint === intent.fingerprint;
    if (grant.type === "session") return scopeMatches(grant.scope, intentScope(intent));
    if (grant.type === "plan") {
      if ((grant.fingerprints || []).includes(intent.fingerprint)) return true;
      return (grant.planItems || []).some((item) => scopeMatches(item.scope || item, intentScope(intent)));
    }
    return true;
  }) || null;
}

function createOnceGrantFromDecision(state, decision, deps = {}) {
  return createAuthorizationGrantFromDecision(state, decision, { ...deps, type: "once" });
}

function createAuthorizationGrantFromDecision(state, decision, deps = {}) {
  if (!decision?.authorization?.fingerprint) return null;
  const nowIso = deps.nowIso || (() => new Date().toISOString());
  const makeId = deps.makeId || ((prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}`);
  const requestedType = deps.type || grantTypeFromDecision(decision);
  const type = allowedGrantType(requestedType, decision.authorization.granularityAllowed || ["once"]);
  const authorization = ensureAuthorizationState(state);
  const existing = authorization.grants.find((grant) => (
    grant.status === "active" &&
    grant.type === type &&
    grant.taskId === decision.taskId &&
    grant.fingerprint === decision.authorization.fingerprint &&
    JSON.stringify(grant.planItems || []) === JSON.stringify(planItemsForDecision(decision, type))
  ));
  if (existing) return existing;
  const grant = {
    id: makeId("G"),
    type,
    status: "active",
    taskId: decision.taskId || null,
    decisionId: decision.id,
    fingerprint: decision.authorization.fingerprint,
    fingerprints: type === "plan" ? planItemsForDecision(decision, type).map((item) => item.fingerprint).filter(Boolean) : [],
    ruleId: decision.authorization.ruleId || "",
    intent: decision.authorization.intent || null,
    scope: intentScope(decision.authorization.intent),
    planItems: planItemsForDecision(decision, type),
    createdAt: nowIso(),
    expiresAt: null,
    consumedAt: null,
  };
  authorization.grants.unshift(grant);
  authorization.grants = authorization.grants.slice(0, 500);
  return grant;
}

function consumeGrant(grant, deps = {}) {
  if (!grant || grant.status !== "active") return null;
  if (grant.type !== "once") return grant;
  const nowIso = deps.nowIso || (() => new Date().toISOString());
  grant.status = "consumed";
  grant.consumedAt = nowIso();
  return grant;
}

function expireStaleGrants(state, deps = {}) {
  const now = Date.parse(deps.now || new Date().toISOString());
  const nowIso = deps.nowIso || (() => new Date().toISOString());
  const authorization = ensureAuthorizationState(state || {});
  const expired = [];
  for (const grant of authorization.grants) {
    if (grant.status === "active" && grant.expiresAt && Date.parse(grant.expiresAt) <= now) {
      grant.status = "expired";
      grant.expiredAt = nowIso();
      expired.push(grant);
    } else if (grant.status === "active" && ["session", "plan"].includes(grant.type) && taskIsTerminal(state, grant.taskId)) {
      grant.status = "expired";
      grant.expiredAt = nowIso();
      expired.push(grant);
    }
  }
  return expired;
}

function publicGrantSummary(state) {
  const authorization = ensureAuthorizationState(state || {});
  return authorization.grants.map((grant) => ({
    id: grant.id,
    type: grant.type,
    status: grant.status,
    taskId: grant.taskId,
    decisionId: grant.decisionId,
    fingerprint: grant.fingerprint,
    fingerprints: grant.fingerprints || [],
    ruleId: grant.ruleId,
    scope: grant.scope || null,
    planItems: grant.planItems || [],
    createdAt: grant.createdAt,
    consumedAt: grant.consumedAt,
    expiresAt: grant.expiresAt,
  }));
}

function grantTypeFromDecision(decision = {}) {
  const option = String(decision.selectedOption || "").toLowerCase();
  if (option.includes("session")) return "session";
  if (option.includes("plan")) return "plan";
  return "once";
}

function allowedGrantType(type, granularityAllowed = []) {
  const allowed = new Set((granularityAllowed || []).map((item) => String(item).toLowerCase()));
  if (type === "plan" && allowed.has("plan")) return "plan";
  if (type === "session" && allowed.has("session")) return "session";
  return "once";
}

function planItemsForDecision(decision = {}, type = "once") {
  if (type !== "plan") return [];
  return (decision.authorization?.planItems || []).map((item) => ({
    fingerprint: item.fingerprint || "",
    scope: item.scope || intentScope(item.intent || item),
    intent: item.intent || null,
  }));
}

function intentScope(intent = {}) {
  return {
    action: intent.action || "unknown",
    target: {
      type: intent.target?.type || "unknown",
      value: intent.target?.value || "",
      scope: intent.target?.scope || "unknown",
    },
    environment: intent.environment || "unknown",
    identity: intent.identity || "unknown",
  };
}

function scopeMatches(grantScope = {}, candidateScope = {}) {
  return (
    String(grantScope.action || "") === String(candidateScope.action || "") &&
    String(grantScope.environment || "") === String(candidateScope.environment || "") &&
    String(grantScope.identity || "") === String(candidateScope.identity || "") &&
    String(grantScope.target?.type || "") === String(candidateScope.target?.type || "") &&
    String(grantScope.target?.scope || "") === String(candidateScope.target?.scope || "") &&
    String(grantScope.target?.value || "") === String(candidateScope.target?.value || "")
  );
}

function taskIsTerminal(state = {}, taskId) {
  if (!taskId) return false;
  const task = (state.tasks || []).find((item) => item.id === taskId);
  return Boolean(task && (task.archivedAt || ["done", "failed", "archived"].includes(task.status)));
}

module.exports = {
  consumeGrant,
  createAuthorizationGrantFromDecision,
  createOnceGrantFromDecision,
  ensureAuthorizationState,
  expireStaleGrants,
  findMatchingGrant,
  intentScope,
  publicGrantSummary,
  scopeMatches,
};
