"use strict";

async function handleMobileRoutes(req, res, url, ctx) {
  const {
    appendDecisionReply,
    broadcast,
    decorateState,
    loadState,
    markClarificationDecisionApproved,
    mobilePush,
    readBody,
    resolveDecision,
    resumeCodexTask,
    saveState,
    sendJson,
    shouldCompleteClarificationDecision,
  } = ctx;

  if (!mobilePush) return false;

  if (req.method === "GET" && url.pathname === "/api/mobile/manifest.webmanifest") {
    res.writeHead(200, { "Content-Type": "application/manifest+json; charset=utf-8" });
    res.end(JSON.stringify(mobilePush.manifest(url.searchParams.get("pair") || url.searchParams.get("token") || "")));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/mobile/push/config") {
    sendJson(res, 200, { push: mobilePush.publicConfig() });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/mobile/pairing") {
    sendJson(res, 200, mobilePush.pairingInfo(req));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/mobile/push/subscribe") {
    if (!isAuthorizedMobileRequest(req, url, mobilePush)) {
      sendJson(res, 401, { error: "Mobile device is not paired" });
      return true;
    }
    const body = await readBody(req);
    const state = loadState();
    const push = mobilePush.subscribe(state, body, { userAgent: req.headers["user-agent"] });
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 201, { push });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/mobile/push/unsubscribe") {
    if (!isAuthorizedMobileRequest(req, url, mobilePush)) {
      sendJson(res, 401, { error: "Mobile device is not paired" });
      return true;
    }
    const body = await readBody(req);
    const state = loadState();
    const push = mobilePush.unsubscribe(state, body);
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, { push });
    return true;
  }

  const subscriptionDeleteMatch = url.pathname.match(/^\/api\/mobile\/push\/subscriptions\/([^/]+)$/);
  if (req.method === "DELETE" && subscriptionDeleteMatch) {
    const state = loadState();
    const result = mobilePush.deleteSubscription(state, decodeURIComponent(subscriptionDeleteMatch[1]));
    broadcast({ type: "state", state: decorateState(loadState()) });
    if (!result.removed) {
      sendJson(res, 404, { error: "Mobile subscription not found", push: result.push });
      return true;
    }
    sendJson(res, 200, { push: result.push, removed: result.removed });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/mobile/push/test") {
    if (!isAuthorizedMobileRequest(req, url, mobilePush)) {
      sendJson(res, 401, { error: "Mobile device is not paired" });
      return true;
    }
    const result = await mobilePush.sendTestNotification();
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, result.ok ? 200 : 202, { result });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/mobile/push/notification") {
    if (!isAuthorizedMobileRequest(req, url, mobilePush)) {
      sendJson(res, 401, { error: "Mobile device is not paired" });
      return true;
    }
    sendJson(res, 200, mobilePush.latestNotification(loadState()));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/mobile/decisions") {
    if (!isAuthorizedMobileRequest(req, url, mobilePush)) {
      sendJson(res, 401, { error: "Mobile device is not paired" });
      return true;
    }
    const state = loadState();
    sendJson(res, 200, {
      decisions: (state.decisions || [])
        .filter((decision) => !decision.archivedAt)
        .slice(0, 50)
        .map(mobileDecisionPacket),
      push: mobilePush.publicConfig(),
    });
    return true;
  }

  const resolveMatch = url.pathname.match(/^\/api\/mobile\/decisions\/([^/]+)\/resolve$/);
  if (req.method === "POST" && resolveMatch) {
    if (!isAuthorizedMobileRequest(req, url, mobilePush)) {
      sendJson(res, 401, { error: "Mobile device is not paired" });
      return true;
    }
    const body = await readBody(req);
    const state = loadState();
    const result = resolveDecision(state, decodeURIComponent(resolveMatch[1]), body);
    if (result.shouldResumeCodex) {
      try {
        const resume = resumeCodexTask(loadState(), result.task.id, result.decision.id);
        result.resume = resume.alreadyRunning ? "already_running" : "started";
      } catch (error) {
        const failed = loadState();
        const task = failed.tasks.find((item) => item.id === result.task.id);
        if (task) {
          task.status = "paused";
          task.summary = `移动端已处理决策,但恢复 Codex session 失败: ${error.message}`;
        }
        saveState(failed);
        result.resume = "failed";
        result.resumeError = error.message;
      }
    }
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, { decision: mobileDecisionPacket(result.decision), resume: result.resume || null });
    return true;
  }

  const replyMatch = url.pathname.match(/^\/api\/mobile\/decisions\/([^/]+)\/reply$/);
  if (req.method === "POST" && replyMatch) {
    if (!isAuthorizedMobileRequest(req, url, mobilePush)) {
      sendJson(res, 401, { error: "Mobile device is not paired" });
      return true;
    }
    const body = await readBody(req);
    const state = loadState();
    const result = appendDecisionReply(state, decodeURIComponent(replyMatch[1]), {
      ...body,
      role: "human",
      actor: body.actor || "手机决策端",
    });
    const completesClarification = shouldCompleteClarificationDecision?.(result, body);
    if (completesClarification) markClarificationDecisionApproved?.(state, result, body);
    if (result.shouldResumeCodex && body.resume !== false) {
      try {
        const resume = completesClarification
          ? resumeCodexTask(loadState(), result.task.id, result.decision.id)
          : resumeCodexTask(loadState(), result.task.id, result.decision.id, {
              mode: "reply",
              replyId: result.reply.id,
              message: result.reply.message,
            });
        result.resume = resume.alreadyRunning ? "already_running" : "started";
      } catch (error) {
        const failed = loadState();
        const task = failed.tasks.find((item) => item.id === result.task.id);
        if (task) {
          task.status = "needs_human";
          task.summary = `移动端补充信息已记录,但恢复 Codex session 失败: ${error.message}`;
        }
        saveState(failed);
        result.resume = "failed";
        result.resumeError = error.message;
      }
    }
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, {
      decision: mobileDecisionPacket(result.decision),
      reply: result.reply ? { id: result.reply.id, at: result.reply.at, actor: result.reply.actor } : null,
      resume: result.resume || null,
    });
    return true;
  }

  return false;
}

function isAuthorizedMobileRequest(req, url, mobilePush) {
  return mobilePush.verifyToken(
    req.headers.authorization ||
      req.headers["x-second-mobile-token"] ||
      url.searchParams.get("token") ||
      url.searchParams.get("pair"),
  );
}

function mobileDecisionPacket(decision = {}) {
  return {
    id: decision.id,
    type: decision.type,
    risk: decision.risk,
    title: redactMobileText(decision.title),
    taskId: decision.taskId,
    taskTitle: redactMobileText(decision.taskTitle),
    source: redactMobileText(decision.source),
    agent: redactMobileText(decision.agent),
    status: decision.status,
    selectedOption: decision.selectedOption,
    createdAt: decision.createdAt,
    decidedAt: decision.decidedAt,
    summary: redactMobileText(decision.summary),
    impact: (decision.impact || []).map(redactMobileText),
    options: (decision.options || []).map((option) => ({
      ...option,
      label: redactMobileText(option.label),
      description: redactMobileText(option.description),
    })),
    artifacts: (decision.artifacts || []).slice(0, 6),
    replyCount: (decision.replies || []).length,
  };
}

function redactMobileText(value) {
  return String(value || "")
    .replace(/\bsk-or-v1-[A-Za-z0-9_-]{8,}\b/g, "sk-or-v1-...已隐藏")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "sk-...已隐藏")
    .replace(/(\bapi[_-]?key\b\s*[:=]\s*)[^\s,，。)]+/gi, "$1已隐藏")
    .replace(/\b(xoxb|xapp|xoxp)-[A-Za-z0-9-]{10,}\b/g, "$1-...已隐藏")
    .trim();
}

module.exports = {
  handleMobileRoutes,
  mobileDecisionPacket,
  redactMobileText,
};
