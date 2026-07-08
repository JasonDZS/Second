"use strict";

const { cleanReplyMessage } = require("../domain/decisions");

function createChannelProcessor(deps = {}) {
  const {
    appendDecisionReply,
    appendEvent,
    broadcast = () => {},
    createTask,
    decorateState = (state) => state,
    isTaskRunning,
    loadState,
    makeId,
    markClarificationDecisionApproved,
    notifyTaskAccepted = async () => {},
    nowIso,
    resolveDecision,
    resumeCodexTask,
    runCodexTask,
    saveState,
    shouldCompleteClarificationDecision,
  } = deps;

  function processChannelEnvelope(adapter, envelope) {
    if (envelope.kind === "task.requested") {
      const state = loadState();
      if (!channelProcessingEnabled(state, adapter.id)) return skipDisabledChannelEnvelope(state, adapter);
      const continuation = processChannelThreadContinuation(adapter, envelope, state);
      if (continuation) {
        broadcast({ type: "state", state: decorateState(loadState()) });
        return continuation;
      }
      const task = createTask(state, envelope.taskInput);
      try {
        runCodexTask(loadState(), task.id);
      } catch (error) {
        const failed = loadState();
        const freshTask = failed.tasks.find((item) => item.id === task.id);
        if (freshTask) {
          freshTask.status = "failed";
          freshTask.summary = `${adapter.name} 任务已创建,但派发 Codex 失败: ${error.message}`;
        }
        appendEvent(failed, {
          type: "channel.task.dispatch_failed",
          text: `channel.task.dispatch_failed ${adapter.id} ${task.id}: ${error.message}`,
          taskId: task.id,
          channelId: adapter.id,
        });
        saveState(failed);
      }
      notifyTaskAccepted(task).catch(() => {});
      broadcast({ type: "state", state: decorateState(loadState()) });
      return { task };
    }

    if (envelope.kind === "decision.resolved") {
      const state = loadState();
      const result = resolveDecision(state, envelope.decisionId, {
        verdict: envelope.verdict,
        optionId: envelope.optionId,
      });
      if (result.shouldResumeCodex) {
        try {
          resumeCodexTask(loadState(), result.task.id, result.decision.id);
        } catch (error) {
          const failed = loadState();
          appendEvent(failed, {
            type: "channel.codex.resume_failed",
            text: `channel.codex.resume_failed ${adapter.id} ${result.task.id}: ${error.message}`,
            taskId: result.task.id,
            decisionId: result.decision.id,
            channelId: adapter.id,
          });
          saveState(failed);
        }
      }
      broadcast({ type: "state", state: decorateState(loadState()) });
      return { result };
    }

    const error = new Error(`Unsupported ${adapter.id} channel envelope: ${envelope.kind}`);
    error.statusCode = 400;
    throw error;
  }

  function processChannelThreadContinuation(adapter, envelope, state) {
    const task = findChannelThreadTask(state, envelope.taskInput);
    if (!task || !task.codexSessionId) return null;

    const external = channelExternal(envelope.taskInput);
    const message = cleanReplyMessage(channelFollowupMessage(envelope.taskInput), 4000);
    if (!message) return null;

    const pendingDecision = state.decisions.find(
      (decision) => !decision.archivedAt && decision.taskId === task.id && decision.status === "pending",
    );

    if (pendingDecision?.type === "补充") {
      const result = appendDecisionReply(state, pendingDecision.id, {
        role: "human",
        actor: external.user || adapter.name,
        message,
      });
      const completesClarification = shouldCompleteClarificationDecision(result, {});
      if (completesClarification) {
        markClarificationDecisionApproved(state, result, {
          optionId: pendingDecision.selectedOption,
        });
      }
      if (result.shouldResumeCodex) {
        try {
          const resume = resumeCodexTask(loadState(), result.task.id, result.decision.id);
          result.resume = resume.alreadyRunning ? "already_running" : "started";
        } catch (error) {
          recordChannelResumeFailure(result.task.id, result.decision.id, adapter.id, error);
          result.resume = "failed";
          result.resumeError = error.message;
        }
      }
      return {
        task: loadState().tasks.find((item) => item.id === task.id) || task,
        decision: result.decision,
        continuation: "decision_reply",
      };
    }

    if (isTaskRunning(task.id) || ["running", "resuming", "pending_resume", "needs_human"].includes(task.status)) {
      queueChannelFollowup(state, task, message, external, adapter);
      saveState(state);
      return { task, continuation: "queued" };
    }

    const label = channelLabel(adapter);
    task.completedAt = null;
    task.summary = `${label} 收到新消息,准备恢复 ${task.agent} 的同一 Codex session。`;
    task.trace.push({
      kind: "entry",
      actor: adapter.name,
      time: "刚刚",
      title: "会话新消息",
      description: message.slice(0, 700),
      meta: `conversation · ${external.channel || ""}:${external.threadTs || ""}`,
    });
    appendEvent(state, {
      type: "channel.thread.continuation",
      text: `channel.thread.continuation ${adapter.id} ${task.id}`,
      taskId: task.id,
      channelId: adapter.id,
    });
    saveState(state);

    try {
      const resume = resumeCodexTask(loadState(), task.id, null, {
        mode: "channel",
        message,
        external,
      });
      return {
        task: loadState().tasks.find((item) => item.id === task.id) || task,
        continuation: resume.alreadyRunning ? "already_running" : "resumed",
      };
    } catch (error) {
      recordChannelResumeFailure(task.id, null, adapter.id, error);
      return {
        task: loadState().tasks.find((item) => item.id === task.id) || task,
        continuation: "failed",
        error: error.message,
      };
    }
  }

  function skipDisabledChannelEnvelope(state, adapter) {
    appendEvent(state, {
      type: "channel.message.skipped",
      text: `channel.message.skipped ${adapter.id} disabled`,
      channelId: adapter.id,
    });
    saveState(state);
    broadcast({ type: "state", state: decorateState(loadState()) });
    return { skipped: true, reason: "channel_disabled", task: null };
  }

  function queueChannelFollowup(state, task, message, external, adapter) {
    const followup = {
      id: makeId("F"),
      at: nowIso(),
      source: adapter.id,
      message,
      external,
    };
    task.channelFollowups = [...(task.channelFollowups || []), followup].slice(-20);
    task.summary = `${channelLabel(adapter)} 收到新消息,已排队等待同一 Codex session 可恢复。`;
    task.trace.push({
      kind: "entry",
      actor: adapter.name,
      time: "刚刚",
      title: "会话新消息已排队",
      description: message.slice(0, 700),
      meta: `queue · ${task.channelFollowups.length}`,
    });
    appendEvent(state, {
      type: "channel.thread.queued",
      text: `channel.thread.queued ${adapter.id} ${task.id} queue=${task.channelFollowups.length}`,
      taskId: task.id,
      channelId: adapter.id,
    });
  }

  function recordChannelResumeFailure(taskId, decisionId, channelId, error) {
    const failed = loadState();
    const task = failed.tasks.find((item) => item.id === taskId);
    if (task) {
      task.status = "paused";
      const adapterName = channelId === "assistant" ? "对话助手" : channelId;
      task.summary = `${adapterName} 消息已记录,但恢复同一 Codex session 失败: ${error.message}`;
    }
    appendEvent(failed, {
      type: "channel.thread.resume_failed",
      text: `channel.thread.resume_failed ${channelId} ${taskId}: ${error.message}`,
      taskId,
      decisionId,
      channelId,
    });
    saveState(failed);
  }

  function isKnownChannelThread(event = {}) {
    const channel = event.channel;
    const threadTs = event.thread_ts;
    if (!channel || !threadTs) return false;
    const state = loadState();
    return Boolean(findChannelThreadTask(state, { external: { channel, threadTs } }));
  }

  return {
    processChannelEnvelope,
    processChannelThreadContinuation,
    queueChannelFollowup,
    recordChannelResumeFailure,
    isKnownChannelThread,
    findChannelThreadTask,
  };
}

function channelProcessingEnabled(state = {}, channelId = "") {
  const channel = (state.channels || []).find((item) => item.id === channelId);
  if (!channel) return true;
  return channel.notify !== false;
}

function findChannelThreadTask(state, input = {}) {
  const external = channelExternal(input);
  if (!external.channel || !external.threadTs) return null;
  const matches = (state.tasks || []).filter((task) => {
    if (task.archivedAt) return false;
    const taskExternal = task.channel?.external || task.slack || {};
    return taskExternal.channel === external.channel && taskExternal.threadTs === external.threadTs;
  });
  return matches.find((task) => task.codexSessionId) || matches[0] || null;
}

function channelExternal(input = {}) {
  return input.channel?.external || input.slack || input.external || {};
}

function channelFollowupMessage(input = {}) {
  return input.messageText || input.message || input.text || String(input.prompt || "").split(/\n\n/).pop() || "";
}

function channelLabel(adapter = {}) {
  return adapter.name || adapter.id || "外部会话";
}

module.exports = {
  channelProcessingEnabled,
  channelExternal,
  channelFollowupMessage,
  createChannelProcessor,
  findChannelThreadTask,
};
