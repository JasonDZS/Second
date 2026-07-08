"use strict";

const { parseAuthorizationIntent } = require("./intent-parser");
const { loadAuthorizationPolicy } = require("./policy-loader");

function evaluateAuthorization(payload = {}, options = {}) {
  const policyResult = options.policyResult || loadAuthorizationPolicy(options);
  const policy = policyResult.policy;
  const intent = options.intent || parseAuthorizationIntent(payload);
  if (policyResult.failedClosed) {
    const rule = policy.deny[0];
    return result("deny", intent, rule, rule.reason, {
      policySource: policyResult.source,
      policyError: policyResult.error,
      risk: "高",
    });
  }

  const denyRule = firstMatchingRule(policy.deny, intent);
  if (denyRule) {
    return result("deny", intent, denyRule, denyRule.reason || `Denied by ${denyRule.id}`, {
      policySource: policyResult.source,
      risk: "高",
    });
  }

  if (options.grant) {
    return result("allow", intent, {
      id: `grant.${options.grant.id}`,
      reason: `Allowed by ${options.grant.type} grant ${options.grant.id}`,
    }, `Allowed by ${options.grant.type} grant ${options.grant.id}`, {
      policySource: policyResult.source,
      grant: options.grant,
      risk: "低",
    });
  }

  const gateRule = firstMatchingRule(policy.gate, intent);
  if (gateRule) {
    return result("gate", intent, gateRule, gateRule.reason || `Human Gate required by ${gateRule.id}`, {
      policySource: policyResult.source,
      risk: gateRisk(intent),
    });
  }

  const greenRule = firstMatchingRule(policy.green, intent);
  if (greenRule) {
    return result("allow", intent, greenRule, greenRule.reason || `Allowed by ${greenRule.id}`, {
      policySource: policyResult.source,
      risk: "低",
    });
  }

  const unknownAction = policy.defaults?.unknown_action === "deny" ? "deny" : "gate";
  const fallbackRule = {
    id: `${unknownAction}.unknown_action`,
    action: "unknown",
    reason: `No authorization rule matched; defaults.unknown_action=${policy.defaults?.unknown_action || "gate"}`,
  };
  return result(unknownAction, intent, fallbackRule, fallbackRule.reason, {
    policySource: policyResult.source,
    risk: unknownAction === "deny" ? "高" : "中",
  });
}

function result(action, intent, rule, reason, extra = {}) {
  return {
    action,
    decision: action === "gate" ? "human_gate" : action,
    ok: action === "allow",
    risk: extra.risk || (action === "allow" ? "低" : "高"),
    reason,
    ruleId: rule?.id || "",
    matchedRule: rule || null,
    intent,
    fingerprint: intent.fingerprint,
    policySource: extra.policySource || "",
    policyError: extra.policyError || "",
    grant: extra.grant || null,
    grantPreview: extra.grant
      ? {
          id: extra.grant.id,
          type: extra.grant.type,
          status: extra.grant.status,
          decisionId: extra.grant.decisionId,
        }
      : null,
  };
}

function firstMatchingRule(rules = [], intent = {}) {
  return rules.find((rule) => ruleMatches(rule, intent)) || null;
}

function ruleMatches(rule = {}, intent = {}) {
  if (rule.risk_tag && !matchesList(rule.risk_tag, intent.riskTags || [])) return false;
  if (rule.action && !matchesList(rule.action, [intent.action])) return false;
  if (rule.scope && !matchesList(rule.scope, [intent.target?.scope])) return false;
  if (rule.env && !matchesList(rule.env, [intent.environment])) return false;
  if (rule.environment && !matchesList(rule.environment, [intent.environment])) return false;
  if (rule.target && !targetMatches(rule.target, intent.target || {}, intent)) return false;
  if (rule.label && !matchesList(rule.label, [...(intent.labels || []), ...(intent.riskTags || [])])) return false;
  return true;
}

function targetMatches(expected, target = {}, intent = {}) {
  const values = list(expected).map((item) => String(item || "").toLowerCase());
  const actual = [
    target.value,
    target.scope,
    target.type,
    ...(target.labels || []),
    ...(intent.labels || []),
  ].map((item) => String(item || "").toLowerCase());
  return values.some((value) => actual.some((item) => item === value || item.includes(value)));
}

function matchesList(expected, actualValues) {
  const actual = new Set((actualValues || []).map((item) => String(item || "").toLowerCase()));
  return list(expected).some((item) => actual.has(String(item || "").toLowerCase()));
}

function list(value) {
  return Array.isArray(value) ? value : [value];
}

function gateRisk(intent = {}) {
  if (["prod", "staging", "external"].includes(intent.environment)) return "高";
  if (["push", "deploy", "install_package", "communicate"].includes(intent.action)) return "高";
  return "中";
}

module.exports = {
  evaluateAuthorization,
  firstMatchingRule,
  ruleMatches,
};
