"use strict";

const { addGreenAuthorizationRule } = require("../../authorization/policy-loader");
const { applyExtractedCandidates } = require("../../authorization/rule-candidates");

async function handleAdminRoutes(req, res, url, ctx) {
  const {
    appendAuthorizationAudit,
    appendEvent,
    authorizationPolicyFile,
    authorizationSummaryFile,
    broadcast,
    decorateState,
    loadState,
    readBody,
    saveState,
    sendJson,
  } = ctx;

  if (req.method === "POST" && url.pathname === "/api/candidates/extract") {
    const body = await readBody(req);
    const state = loadState();
    const candidates = applyExtractedCandidates(state, {
      minApprovals: body.minApprovals,
    });
    appendEvent(state, {
      type: "rule.candidates.extracted",
      text: `rule.candidates.extracted count=${candidates.length}`,
    });
    saveState(state);
    broadcast({ type: "state", state: decorateState(state) });
    sendJson(res, 200, { candidates });
    return true;
  }

  const candidateMatch = url.pathname.match(/^\/api\/candidates\/([^/]+)$/);
  if (req.method === "POST" && candidateMatch) {
    const body = await readBody(req);
    const state = loadState();
    const candidate = state.candidates.find((item) => item.id === decodeURIComponent(candidateMatch[1]));
    if (!candidate) {
      sendJson(res, 404, { error: "Candidate not found" });
      return true;
    }
    candidate.status = body.status === "approved" ? "approved" : "ignored";
    if (candidate.status === "approved") {
      if (candidate.rule) {
        addGreenAuthorizationRule(candidate.rule, {
          candidate,
          policyFile: authorizationPolicyFile,
          summaryFile: authorizationSummaryFile,
        });
        appendAuthorizationAudit?.(state, {
          event: "authorization.rule.created",
          candidateId: candidate.id,
          ruleId: candidate.rule.id,
          rule: candidate.rule,
          decisionIds: candidate.decisionIds || [],
          reason: `Confirmed rule candidate ${candidate.id}.`,
        });
      }
      state.rules.unshift({
        id: candidate.rule?.id || candidate.id.replace("RC", "AR"),
        kind: "允许",
        text: candidate.text,
        source: `由你刚刚确认 · lineage: ${candidate.id} ← ${candidate.source}`,
        fresh: true,
      });
    }
    appendEvent(state, {
      type: "rule.candidate",
      text: `rule.candidate ${candidate.id} -> ${candidate.status}`,
    });
    saveState(state);
    broadcast({ type: "state", state: decorateState(state) });
    sendJson(res, 200, { candidate });
    return true;
  }

  const channelMatch = url.pathname.match(/^\/api\/channels\/([^/]+)$/);
  if (req.method === "POST" && channelMatch) {
    const body = await readBody(req);
    const state = loadState();
    const channel = state.channels.find((item) => item.id === decodeURIComponent(channelMatch[1]));
    if (!channel) {
      sendJson(res, 404, { error: "Channel not found" });
      return true;
    }
    Object.assign(channel, body);
    appendEvent(state, {
      type: "channel.update",
      text: `channel.update ${channel.id} status=${channel.status} notify=${channel.notify}`,
    });
    saveState(state);
    broadcast({ type: "state", state: decorateState(state) });
    sendJson(res, 200, { channel });
    return true;
  }

  return false;
}

module.exports = {
  handleAdminRoutes,
};
