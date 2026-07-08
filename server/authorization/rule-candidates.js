"use strict";

const crypto = require("crypto");
const { intentScope } = require("./grants");

const DEFAULT_MIN_APPROVALS = 3;

function extractAuthorizationRuleCandidates(state, options = {}) {
  const minApprovals = Number(options.minApprovals || DEFAULT_MIN_APPROVALS);
  const groups = new Map();
  const rejectedKeys = new Set();
  const decisions = state.decisions || [];
  for (const decision of decisions) {
    if (!decision.authorization?.intent) continue;
    const candidate = candidateFromDecision(decision);
    if (!candidate) continue;
    const key = candidate.key;
    if (decision.status === "rejected") {
      rejectedKeys.add(key);
      continue;
    }
    if (decision.status !== "approved") continue;
    const current = groups.get(key) || { ...candidate, decisionIds: [] };
    current.decisionIds.push(decision.id);
    groups.set(key, current);
  }

  const existingIds = new Set((state.candidates || []).map((item) => item.id));
  return [...groups.values()]
    .filter((candidate) => candidate.decisionIds.length >= minApprovals)
    .filter((candidate) => !rejectedKeys.has(candidate.key))
    .filter((candidate) => !existingIds.has(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      confidence: confidence(candidate.decisionIds.length),
      status: "pending",
      text: candidateText(candidate),
      source: `从 ${candidate.decisionIds.length} 次授权批准提取 · ${candidate.decisionIds.join("/")}`,
      rule: candidate.rule,
      decisionIds: candidate.decisionIds,
      kind: "authorization_rule_candidate",
    }));
}

function applyExtractedCandidates(state, options = {}) {
  const candidates = extractAuthorizationRuleCandidates(state, options);
  if (!Array.isArray(state.candidates)) state.candidates = [];
  for (const candidate of candidates) state.candidates.unshift(candidate);
  return candidates;
}

function candidateFromDecision(decision = {}) {
  const intent = decision.authorization?.intent || {};
  if (unsafeForGreenRule(intent, decision.authorization?.ruleId)) return null;
  const scope = intentScope(intent);
  const hash = stableHash(scope);
  const id = `RC-AUTH-${hash.slice(0, 8).toUpperCase()}`;
  return {
    id,
    key: JSON.stringify(scope),
    scope,
    rule: {
      id: `allow.learned.${hash.slice(0, 12)}`,
      action: scope.action,
      scope: scope.target.scope,
      env: [scope.environment],
      target: scope.target.value || scope.target.scope,
      reason: `Learned from repeated approved authorization decisions (${id}).`,
    },
  };
}

function unsafeForGreenRule(intent = {}, ruleId = "") {
  if ((intent.riskTags || []).some((tag) => ["expose_credentials", "self_protection", "irreversible_delete", "bypass_gate"].includes(tag))) return true;
  if (["prod"].includes(intent.environment)) return true;
  if (/deny|quota|prod|credential|secret|self_protection/i.test(ruleId || "")) return true;
  return false;
}

function candidateText(candidate = {}) {
  const scope = candidate.scope || {};
  return `允许 ${scope.action} · ${scope.target?.type || "target"}:${scope.target?.value || scope.target?.scope || "unknown"} · ${scope.environment}`;
}

function confidence(count) {
  return `${Math.min(98, 70 + count * 6)}%`;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

module.exports = {
  applyExtractedCandidates,
  candidateFromDecision,
  extractAuthorizationRuleCandidates,
};
