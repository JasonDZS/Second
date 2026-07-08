"use strict";

function createRuntimeResumeController(deps = {}) {
  const {
    PRODUCT_NAME = "Second",
    appendEvent,
    isTaskRunning = () => false,
    loadState,
    resumeCodexTask,
    saveState,
  } = deps;

  function resumeLatestTaskRun(state, taskId) {
    const task = (state.tasks || []).find((item) => item.id === taskId);
    if (!task) {
      const error = new Error(`Task not found: ${taskId}`);
      error.statusCode = 404;
      throw error;
    }
    if (isTaskRunning(taskId)) return { alreadyRunning: true, task };
    if (!task.codexSessionId) {
      const error = new Error(`Task ${taskId} has no captured Codex session id; cannot resume.`);
      error.statusCode = 409;
      throw error;
    }

    const request = task.lastResumeRequest || inferResumeRequestFromTask(state, task);
    if (!Array.isArray(task.trace)) task.trace = [];
    task.trace.push({
      kind: "runtime",
      actor: `${PRODUCT_NAME} daemon`,
      time: "刚刚",
      title: "从最近恢复点重新执行",
      description: resumeRequestDescription(request),
    });
    appendEvent(state, {
      type: "task.resume_retry",
      text: `task.resume_retry ${task.id} mode=${request.mode || "decision"}`,
      taskId: task.id,
      decisionId: request.decisionId || task.decisionId || null,
    });
    saveState(state);

    return resumeCodexTask(
      loadState(),
      task.id,
      request.decisionId || task.decisionId || null,
      resumeOptionsFromRequest(request),
    );
  }

  return {
    resumeLatestTaskRun,
  };
}

function inferResumeRequestFromTask(state, task) {
  const decision =
    (state.decisions || []).find((item) => item.id === task.decisionId && item.status !== "pending") ||
    (state.decisions || []).find((item) => item.taskId === task.id && item.status !== "pending");
  if (decision) {
    return {
      mode: "decision",
      decisionId: decision.id,
      message: "",
      external: null,
    };
  }
  const external = task.channel?.external || task.slack || null;
  return {
    mode: external ? "channel" : "decision",
    decisionId: task.decisionId || null,
    message: task.messageText || task.sourceMessage?.text || task.title || "",
    external,
  };
}

function resumeOptionsFromRequest(request = {}) {
  if (request.mode === "channel") {
    return {
      mode: "channel",
      message: request.message || "",
      external: request.external || null,
      followupId: request.followupId || null,
    };
  }
  if (request.mode === "reply") {
    return {
      mode: "reply",
      replyId: request.replyId || null,
      message: request.message || "",
    };
  }
  return {};
}

function resumeRequestDescription(request = {}) {
  if (request.mode === "channel") return "daemon 将沿用最近一次 Slack 线程消息上下文重新发起 codex exec resume。";
  if (request.mode === "reply") return "daemon 将沿用最近一次补充信息上下文重新发起 codex exec resume。";
  return "daemon 将沿用最近一次 Human Gate 决策结果重新发起 codex exec resume。";
}

module.exports = {
  createRuntimeResumeController,
  inferResumeRequestFromTask,
  resumeOptionsFromRequest,
  resumeRequestDescription,
};
