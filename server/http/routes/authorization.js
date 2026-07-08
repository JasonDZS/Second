"use strict";

const { authorizeToolUse } = require("../../authorization/service");

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

  return false;
}

module.exports = {
  handleAuthorizationRoutes,
};
