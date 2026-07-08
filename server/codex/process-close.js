"use strict";

const path = require("path");
const {
  addArtifact,
  cleanAgentReplyText,
  extractWaitingDecisionId,
  findPendingTaskDecision,
  firstNonEmptyLine,
  isHookDecision,
  safeRead,
  takeNextChannelFollowup,
} = require("./result-helpers");

function createCodexProcessCloseHandler(deps = {}) {
  const {
    PRODUCT_NAME = "Second",
    appendEvent,
    loadState,
    makeId,
    notifyTaskResult,
    nowIso,
    resumeCodexTask,
    saveStateAndEmit,
  } = deps;

  function handleCodexProcessClose({ taskId, phase, outputFile, resumeContext = {}, code, signal, stderr = "" }) {
    const fresh = loadState();
    const freshTask = fresh.tasks.find((item) => item.id === taskId);
    if (!freshTask) return;

    const finalText = safeRead(outputFile);
    const waitingDecisionId = extractWaitingDecisionId(finalText);
    const pendingDecision = findPendingTaskDecision(fresh, freshTask, waitingDecisionId);
    const replyDecision =
      phase === "reply"
        ? pendingDecision ||
          fresh.decisions.find((item) => item.id === resumeContext.decisionId) ||
          findPendingTaskDecision(fresh, freshTask, null)
        : null;
    if (phase === "reply" && replyDecision) {
      handleReplyProcessClose({
        code,
        finalText,
        fresh,
        freshTask,
        outputFile,
        replyDecision,
        resumeContext,
        signal,
        stderr,
        taskId,
      });
      return;
    }
    if (pendingDecision && (code === 0 || freshTask.status === "needs_human" || isHookDecision(pendingDecision))) {
      markTaskWaitingForDecision({
        finalText,
        fresh,
        freshTask,
        outputFile,
        pendingDecision,
        phase,
        taskId,
      });
      return;
    }

    finishTaskFromProcess({
      code,
      finalText,
      fresh,
      freshTask,
      outputFile,
      phase,
      signal,
      stderr,
      taskId,
    });
  }

  function handleReplyProcessClose({
    code,
    finalText,
    fresh,
    freshTask,
    outputFile,
    replyDecision,
    resumeContext,
    signal,
    stderr,
    taskId,
  }) {
    const replyText =
      cleanAgentReplyText(finalText, replyDecision.id) ||
      (code === 0
        ? "分身已返回,但没有输出新的补充信息。"
        : `分身补充信息失败: ${stderr.trim() || signal || `exit ${code}`}`);
    replyDecision.replies = [
      ...(replyDecision.replies || []),
      {
        id: makeId("R"),
        at: nowIso(),
        role: code === 0 ? "agent" : "system",
        actor: code === 0 ? freshTask.agent : `${PRODUCT_NAME} daemon`,
        message: replyText,
        inReplyTo: resumeContext.replyId || null,
      },
    ];
    const decisionStillPending = replyDecision.status === "pending";
    freshTask.status = decisionStillPending
      ? "needs_human"
      : freshTask.codexSessionId && code === 0
        ? "pending_resume"
        : "paused";
    freshTask.completedAt = null;
    freshTask.decisionId = replyDecision.id;
    freshTask.summary =
      code === 0
        ? decisionStillPending
          ? "分身已补充信息,等待你继续决策。"
          : "分身已补充信息,决策已处理,准备继续执行。"
        : "分身补充信息失败,原决策仍在等待你处理。";
    if (finalText) addArtifact(freshTask, "Codex clarification response", outputFile);
    freshTask.trace.push({
      kind: code === 0 ? "agent" : "runtime",
      actor: code === 0 ? freshTask.agent : `${PRODUCT_NAME} daemon`,
      time: "刚刚",
      title: code === 0 ? "分身已补充信息" : "补充信息失败",
      description: replyText.slice(0, 700),
      decisionId: replyDecision.id,
    });
    appendEvent(fresh, {
      type: code === 0 ? "decision.reply.agent" : "decision.reply.failed",
      text: `${code === 0 ? "decision.reply.agent" : "decision.reply.failed"} ${replyDecision.id}`,
      taskId,
      decisionId: replyDecision.id,
    });
    saveStateAndEmit(fresh);
    if (!decisionStillPending && code === 0 && freshTask.codexSessionId) {
      resumeAfterReply(taskId, replyDecision.id);
    }
  }

  function resumeAfterReply(taskId, decisionId) {
    try {
      resumeCodexTask(loadState(), taskId, decisionId);
    } catch (error) {
      const failed = loadState();
      const failedTask = failed.tasks.find((item) => item.id === taskId);
      if (failedTask) {
        failedTask.status = "paused";
        failedTask.summary = `分身补充信息后继续执行失败: ${error.message}`;
      }
      appendEvent(failed, {
        type: "codex.resume.after_reply_failed",
        text: `codex.resume.after_reply_failed ${taskId}: ${error.message}`,
        taskId,
        decisionId,
      });
      saveStateAndEmit(failed);
    }
  }

  function markTaskWaitingForDecision({ finalText, fresh, freshTask, outputFile, pendingDecision, phase, taskId }) {
    freshTask.status = "needs_human";
    freshTask.completedAt = null;
    freshTask.decisionId = pendingDecision.id;
    freshTask.summary = freshTask.codexSessionId
      ? "Codex 已在 Human Gate 挂起,等待前端审核。"
      : "Codex 已在 Human Gate 挂起,但尚未建立可恢复会话;审核后可能无法安全恢复。";
    freshTask.trace.push({
      kind: "gate",
      actor: "Human Gate",
      time: "刚刚",
      title: `等待决策 · ${pendingDecision.id}`,
      description: freshTask.codexSessionId
        ? "Codex exec 已在决策点结束;daemon 将在审核后恢复同一会话。"
        : "Codex exec 已在决策点结束,但尚未建立可恢复会话。",
      decisionId: pendingDecision.id,
    });
    if (finalText) addArtifact(freshTask, phase === "resume" ? "Codex resume response" : "Codex final response", outputFile);
    appendEvent(fresh, {
      type: "codex.waiting_for_decision",
      text: `codex.waiting_for_decision ${taskId} decision=${pendingDecision.id}`,
      taskId,
      decisionId: pendingDecision.id,
    });
    saveStateAndEmit(fresh);
  }

  function finishTaskFromProcess({ code, finalText, fresh, freshTask, outputFile, phase, signal, stderr, taskId }) {
    freshTask.completedAt = nowIso();
    freshTask.status = code === 0 ? "done" : "failed";
    freshTask.summary =
      code === 0
        ? firstNonEmptyLine(finalText) || `${freshTask.agent}${phase === "resume" ? "恢复执行" : "执行"}已完成任务。`
        : `${freshTask.agent}${phase === "resume" ? "恢复执行" : "执行"}失败: ${signal || `exit ${code}`}`;
    if (finalText) {
      addArtifact(freshTask, phase === "resume" ? "Codex resume response" : "Codex final response", outputFile);
    }
    if (stderr && code !== 0) {
      freshTask.trace.push({
        kind: "runtime",
        actor: freshTask.agent,
        time: "刚刚",
        title: "执行失败",
        description: stderr.trim().slice(0, 600),
      });
    } else {
      freshTask.trace.push({
        kind: "out",
        actor: freshTask.agent,
        time: "刚刚",
        title: code === 0 ? "执行完成" : "执行结束",
        description:
          code === 0
            ? `${phase === "resume" ? "恢复结果" : "结果"}已写入 ${path.basename(outputFile)},trace 已保留。`
            : `进程退出: ${code}`,
      });
    }
    appendEvent(fresh, {
      type: code === 0 ? `codex.${phase}.done` : `codex.${phase}.failed`,
      text: `${code === 0 ? `codex.${phase}.done` : `codex.${phase}.failed`} ${taskId} code=${code} signal=${signal || ""}`,
      taskId,
    });
    const queuedFollowup = code === 0 ? takeNextChannelFollowup(freshTask) : null;
    saveStateAndEmit(fresh);
    notifyTaskResult(freshTask, { success: code === 0, phase, finalText, outputFile })
      .then((delivery) => recordTaskResultDelivery(taskId, freshTask.channel?.id, delivery))
      .catch((error) => recordTaskResultDelivery(taskId, freshTask.channel?.id, { ok: false, error: error.message }));
    if (queuedFollowup && freshTask.codexSessionId) {
      resumeQueuedChannelFollowup(taskId, queuedFollowup);
    }
  }

  function resumeQueuedChannelFollowup(taskId, queuedFollowup) {
    try {
      resumeCodexTask(loadState(), taskId, null, {
        mode: "channel",
        message: queuedFollowup.message,
        external: queuedFollowup.external,
        followupId: queuedFollowup.id,
      });
    } catch (error) {
      const failed = loadState();
      const failedTask = failed.tasks.find((item) => item.id === taskId);
      if (failedTask) {
        failedTask.status = "paused";
        failedTask.summary = `Slack 线程消息已排队,但恢复同一 Codex session 失败: ${error.message}`;
      }
      appendEvent(failed, {
        type: "codex.channel.resume_failed",
        text: `codex.channel.resume_failed ${taskId}: ${error.message}`,
        taskId,
      });
      saveStateAndEmit(failed);
    }
  }

  function recordTaskResultDelivery(taskId, channelId, delivery) {
    if (!channelId) return;
    const state = loadState();
    appendEvent(state, {
      type: delivery?.ok === false ? "channel.task.result_failed" : "channel.task.result_sent",
      text:
        delivery?.ok === false
          ? `channel.task.result_failed ${taskId} ${delivery.error || delivery.reason || "unknown"}`
          : `channel.task.result_sent ${taskId} chunks=${delivery?.chunks || 1}`,
      taskId,
      channelId,
    });
    saveStateAndEmit(state);
  }

  return {
    handleCodexProcessClose,
    recordTaskResultDelivery,
  };
}

module.exports = {
  createCodexProcessCloseHandler,
};
