"use strict";

async function handleDecisionRoutes(req, res, url, ctx) {
  const {
    appendDecisionReply,
    appendEvent,
    broadcast,
    createDecisionTestTask,
    createMcpDecisionRequest,
    decorateState,
    loadState,
    markClarificationDecisionApproved,
    readBody,
    resolveDecision,
    resumeCodexTask,
    saveState,
    sendJson,
    shouldCompleteClarificationDecision,
  } = ctx;

  if (req.method === "POST" && url.pathname === "/api/test/decision-task") {
    const body = await readBody(req);
    const state = loadState();
    const result = createDecisionTestTask(state, body);
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 201, result);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/mcp/decision-request") {
    const body = await readBody(req);
    const state = loadState();
    const result = createMcpDecisionRequest(state, body);
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 201, result);
    return true;
  }

  const decisionMatch = url.pathname.match(/^\/api\/decisions\/([^/]+)\/resolve$/);
  if (req.method === "POST" && decisionMatch) {
    const body = await readBody(req);
    const state = loadState();
    const result = resolveDecision(state, decodeURIComponent(decisionMatch[1]), body);
    if (result.shouldResumeCodex) {
      try {
        resumeCodexTask(loadState(), result.task.id, result.decision.id);
      } catch (error) {
        const failed = loadState();
        const task = failed.tasks.find((item) => item.id === result.task.id);
        if (task) {
          task.status = "paused";
          task.summary = `Human Gate 已处理,但恢复 Codex session 失败: ${error.message}`;
          task.trace.push({
            kind: "runtime",
            actor: "Second daemon",
            time: "刚刚",
            title: "恢复 Codex session 失败",
            description: error.message,
          });
        }
        appendEvent(failed, {
          type: "codex.resume.failed_to_start",
          text: `codex.resume.failed_to_start ${result.task.id}: ${error.message}`,
          taskId: result.task.id,
          decisionId: result.decision.id,
        });
        saveState(failed);
      }
    }
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, result);
    return true;
  }

  const replyMatch = url.pathname.match(/^\/api\/decisions\/([^/]+)\/reply$/);
  if (req.method === "POST" && replyMatch) {
    const body = await readBody(req);
    const state = loadState();
    const result = appendDecisionReply(state, decodeURIComponent(replyMatch[1]), {
      ...body,
      role: body.role === "agent" ? "agent" : "human",
      actor: body.actor || (body.role === "agent" ? "agent" : "你"),
    });
    const completesClarification = shouldCompleteClarificationDecision(result, body);
    if (completesClarification) markClarificationDecisionApproved(state, result, body);
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
          task.summary = `补充信息已记录,但恢复 ${task.agent} 失败: ${error.message}`;
          task.trace.push({
            kind: "runtime",
            actor: "Second daemon",
            time: "刚刚",
            title: "补充信息恢复失败",
            description: error.message,
            decisionId: result.decision.id,
          });
        }
        appendEvent(failed, {
          type: "decision.reply.resume_failed",
          text: `decision.reply.resume_failed ${result.decision.id}: ${error.message}`,
          taskId: result.task.id,
          decisionId: result.decision.id,
        });
        saveState(failed);
        result.resume = "failed";
        result.resumeError = error.message;
      }
    }
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, result);
    return true;
  }

  const selectMatch = url.pathname.match(/^\/api\/decisions\/([^/]+)\/option$/);
  if (req.method === "POST" && selectMatch) {
    const body = await readBody(req);
    const state = loadState();
    const decision = state.decisions.find((item) => item.id === decodeURIComponent(selectMatch[1]));
    if (!decision) {
      sendJson(res, 404, { error: "Decision not found" });
      return true;
    }
    if (decision.archivedAt) {
      sendJson(res, 409, { error: "Decision is archived" });
      return true;
    }
    decision.selectedOption = body.optionId;
    saveState(state);
    broadcast({ type: "state", state: decorateState(state) });
    sendJson(res, 200, { decision });
    return true;
  }

  return false;
}

module.exports = {
  handleDecisionRoutes,
};
