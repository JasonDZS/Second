"use strict";

const fs = require("fs");
const { publicGrantSummary } = require("../../authorization/grants");
const { loadAuthorizationPolicy } = require("../../authorization/policy-loader");
const { redactAuthorizationValue } = require("../../authorization/redaction");
const { authorizeToolUse } = require("../../authorization/service");
const { AUTHORIZATION_AUDIT_FILE } = require("../../state");

async function handleAuthorizationRoutes(req, res, url, ctx) {
  const {
    appendAuthorizationAudit,
    appendDecisionLog,
    appendEvent,
    broadcast,
    decorateState,
    loadState,
    makeId,
    notifyDecisionRequested,
    nowIso,
    readBody,
    saveState,
    sendJson,
  } = ctx;

  if (req.method === "GET" && url.pathname === "/api/authorization/overview") {
    const state = loadState();
    sendJson(res, 200, authorizationOverview(state, {
      auditFile: ctx.authorizationAuditFile,
    }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/authorization/audit") {
    const state = loadState();
    const limit = clampLimit(url.searchParams.get("limit"), 100);
    sendJson(res, 200, {
      audit: readAuthorizationAudit({
        auditFile: ctx.authorizationAuditFile,
        fallback: state.authorization?.audit || [],
        limit,
      }),
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/authorize") {
    const body = await readBody(req);
    const result = authorizeToolUse(body, {
      appendAuthorizationAudit,
      appendDecisionLog,
      appendEvent,
      loadState,
      makeId,
      nowIso,
      notifyDecisionRequested,
      saveState,
    });
    if (!result.dryRun) broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, result.action === "gate" ? 202 : 200, result);
    return true;
  }

  const revokeMatch = url.pathname.match(/^\/api\/authorization\/grants\/([^/]+)\/revoke$/);
  if (req.method === "POST" && revokeMatch) {
    const body = await readBody(req);
    const state = loadState();
    const grantId = decodeURIComponent(revokeMatch[1]);
    const grant = (state.authorization?.grants || []).find((item) => item.id === grantId);
    if (!grant) {
      sendJson(res, 404, { error: "Grant not found" });
      return true;
    }
    if (grant.status !== "active") {
      sendJson(res, 409, { error: `Grant is ${grant.status || "not active"}` });
      return true;
    }
    grant.status = "revoked";
    grant.revokedAt = nowIso();
    grant.revokedReason = String(body.reason || "Revoked from Authorization console.");
    appendAuthorizationAudit?.(state, {
      event: "authorization.grant.revoke",
      taskId: grant.taskId || null,
      decisionId: grant.decisionId || null,
      grantId: grant.id,
      fingerprint: grant.fingerprint || null,
      ruleId: grant.ruleId || "",
      reason: grant.revokedReason,
    });
    appendEvent(state, {
      type: "authorization.grant.revoke",
      text: `authorization.grant.revoke ${grant.id} ${grant.fingerprint || ""}`,
      taskId: grant.taskId || undefined,
      decisionId: grant.decisionId || undefined,
    });
    saveState(state);
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, { grant: redactAuthorizationValue(grant) });
    return true;
  }

  return false;
}

function authorizationOverview(state = {}, options = {}) {
  const policyResult = loadAuthorizationPolicy();
  const decisions = (state.decisions || []).filter((decision) => decision.authorization);
  const grants = publicGrantSummary(state);
  const audit = readAuthorizationAudit({
    auditFile: options.auditFile,
    fallback: state.authorization?.audit || [],
    limit: 50,
  });
  return {
    policy: {
      source: policyResult.source,
      failedClosed: Boolean(policyResult.failedClosed),
      error: policyResult.error || "",
      defaults: policyResult.policy?.defaults || {},
      counts: {
        allow: policyResult.policy?.green?.length || 0,
        gate: policyResult.policy?.gate?.length || 0,
        deny: policyResult.policy?.deny?.length || 0,
      },
      rules: redactAuthorizationValue({
        allow: policyResult.policy?.green || [],
        gate: policyResult.policy?.gate || [],
        deny: policyResult.policy?.deny || [],
      }),
    },
    decisions: {
      total: decisions.length,
      pending: decisions.filter((decision) => decision.status === "pending").length,
      recent: decisions.slice(0, 20).map((decision) => redactAuthorizationValue({
        id: decision.id,
        status: decision.status,
        title: decision.title,
        taskId: decision.taskId,
        ruleId: decision.authorization?.ruleId,
        fingerprint: decision.authorization?.fingerprint,
        intent: decision.authorization?.intent,
        createdAt: decision.createdAt,
        resolvedAt: decision.resolvedAt,
      })),
    },
    grants: {
      total: grants.length,
      active: grants.filter((grant) => grant.status === "active").length,
      consumed: grants.filter((grant) => grant.status === "consumed").length,
      expired: grants.filter((grant) => grant.status === "expired").length,
      revoked: grants.filter((grant) => grant.status === "revoked").length,
      items: redactAuthorizationValue(grants.slice(0, 100)),
    },
    audit,
  };
}

function readAuthorizationAudit(options = {}) {
  const limit = clampLimit(options.limit, 100);
  const auditFile = options.auditFile || AUTHORIZATION_AUDIT_FILE;
  const fallback = Array.isArray(options.fallback) ? options.fallback : [];
  try {
    if (!fs.existsSync(auditFile)) return redactAuthorizationValue(fallback.slice(0, limit));
    return fs
      .readFileSync(auditFile, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .reverse()
      .map((line) => JSON.parse(line))
      .map((entry) => redactAuthorizationValue(entry));
  } catch {
    return redactAuthorizationValue(fallback.slice(0, limit));
  }
}

function clampLimit(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(500, Math.round(number)));
}

module.exports = {
  authorizationOverview,
  handleAuthorizationRoutes,
  readAuthorizationAudit,
};
