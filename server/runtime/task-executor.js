"use strict";

function createRuntimeTaskExecutor(deps = {}) {
  const {
    PRODUCT_NAME = "Second",
    adapter,
    appendEvent,
    createProcessCloseHandler,
    handleRuntimeLine,
    loadState,
    makeId,
    nowIso,
    runtimeManager,
    saveState,
  } = deps;
  if (!adapter) throw new Error("runtime task executor requires an adapter");
  if (!runtimeManager) throw new Error("runtime task executor requires a runtime manager");

  const {
    detectCommand,
    detectEngines,
    getRunningTasks,
    isTaskRunning,
    runningProcess,
    saveStateAndEmit,
    setStateChangeListener,
    startInvocation,
    untrackProcess,
  } = runtimeManager;
  const eventPrefix = adapter.eventPrefix || adapter.id || "runtime";
  const sessionIdField = adapter.sessionIdField || "codexSessionId";
  const sessionLabel = adapter.sessionLabel || `${adapter.name || adapter.id} session`;

  let handleProcessClose = () => {};
  const api = {
    detectCommand,
    detectEngines,
    getRunningTasks,
    isTaskRunning,
    pauseTask,
    resumeTask,
    runningProcess,
    runTask,
    setStateChangeListener,
    stopTask,
  };
  handleProcessClose = createProcessCloseHandler?.({ resumeTask, runtimeApi: api }) || (() => {});
  return api;

  function runTask(state, taskId) {
    const task = findTaskOrThrow(state, taskId);
    if (isTaskRunning(taskId)) return { alreadyRunning: true, task };
    ensureEngineAvailable(state);

    const invocation = adapter.prepareRun(task, state);
    task.status = "running";
    task.startedAt = task.startedAt || nowIso();
    task.summary = `${task.agent}正在执行本地任务。`;
    task.trace.push({
      kind: "runtime",
      actor: task.agent,
      time: "刚刚",
      title: "分身开始执行",
      description: `${task.agent}已接管任务。`,
    });
    appendEvent(state, {
      type: `${eventPrefix}.start`,
      text: `${eventPrefix}.start ${taskId}`,
      taskId,
    });
    saveState(state);

    attachRuntimeProcess({
      invocation,
      taskId,
      phase: invocation.phase,
      runId: makeId("RUN"),
      outputFile: invocation.outputFile,
      rawLogFile: invocation.rawLogFile,
    });

    return { alreadyRunning: false, task };
  }

  function resumeTask(state, taskId, decisionId = null, options = {}) {
    const task = findTaskOrThrow(state, taskId);
    if (isTaskRunning(taskId)) return { alreadyRunning: true, task };
    ensureEngineAvailable(state);
    if (!task[sessionIdField]) {
      const error = new Error(`Task ${taskId} has no captured ${sessionLabel} id; cannot resume safely.`);
      error.statusCode = 409;
      throw error;
    }

    const decision =
      options.mode === "channel"
        ? null
        : state.decisions.find((item) => item.id === (decisionId || task.decisionId)) ||
          state.decisions.find((item) => item.taskId === taskId && item.status !== "pending");
    const invocation = adapter.prepareResume(task, state, decision, options);
    const mode = invocation.mode;
    task.status = "resuming";
    task.resumeOutputFile = invocation.outputFile;
    task.resumeRawLogFile = invocation.rawLogFile;
    task.lastResumeRequest = {
      at: nowIso(),
      mode,
      decisionId: decision?.id || task.decisionId || null,
      replyId: options.replyId || null,
      message: options.message || "",
      external: options.external || null,
      followupId: options.followupId || null,
    };
    task.summary =
      mode === "reply"
        ? `你已补充信息,daemon 正在恢复${task.agent}补证据。`
        : mode === "channel"
          ? `Slack 线程有新消息,daemon 正在恢复${task.agent}的同一会话。`
          : `Human Gate 已处理,daemon 正在恢复${task.agent}的同一会话。`;
    task.trace.push({
      kind: "runtime",
      actor: task.agent,
      time: "刚刚",
      title: mode === "reply" ? "分身补充证据" : mode === "channel" ? "线程消息继续执行" : "分身继续执行",
      description:
        mode === "reply"
          ? `${task.agent}正在读取你的补充信息并准备回复。`
          : mode === "channel"
            ? `${task.agent}正在读取 Slack 线程的新消息,并沿用同一 Codex session。`
            : `${task.agent}正在恢复同一会话。`,
    });
    appendEvent(state, {
      type: mode === "reply" ? `${eventPrefix}.reply.start` : mode === "channel" ? `${eventPrefix}.channel.start` : `${eventPrefix}.resume.start`,
      text: `${mode === "reply" ? `${eventPrefix}.reply.start` : mode === "channel" ? `${eventPrefix}.channel.start` : `${eventPrefix}.resume.start`} ${taskId}`,
      taskId,
      decisionId: decision?.id || task.decisionId || null,
    });
    saveState(state);

    attachRuntimeProcess({
      invocation,
      taskId,
      phase: invocation.phase,
      runId: invocation.runId,
      outputFile: invocation.outputFile,
      rawLogFile: invocation.rawLogFile,
      resumeContext: {
        decisionId: decision?.id || task.decisionId || null,
        replyId: options.replyId || null,
        message: options.message || "",
      },
    });

    return { alreadyRunning: false, task };
  }

  function attachRuntimeProcess({ invocation, taskId, phase, runId = null, outputFile, rawLogFile, resumeContext = {} }) {
    let stderr = "";
    startInvocation(invocation, {
      taskId,
      rawLogFile,
      onStdoutLine: (line) => {
        const fresh = loadState();
        const freshTask = fresh.tasks.find((item) => item.id === taskId);
        if (!freshTask) return;
        handleRuntimeLine(fresh, freshTask, line, phase, runId);
        saveStateAndEmit(fresh);
      },
      onStderr: (text) => {
        stderr += text;
      },
      onClose: ({ code, signal }) => handleProcessClose({
        code,
        outputFile,
        phase,
        resumeContext,
        signal,
        stderr,
        taskId,
      }),
    });
  }

  function stopTask(state, taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return false;
    const child = runningProcess(taskId);
    if (child) {
      child.kill("SIGTERM");
      untrackProcess(taskId);
    }
    task.status = "stopped";
    task.completedAt = nowIso();
    task.trace.push({
      kind: "runtime",
      actor: `${PRODUCT_NAME} daemon`,
      time: "刚刚",
      title: "任务已停止",
      description: "进程已终止,workspace 快照与 trace 已保留。",
    });
    appendEvent(state, {
      type: "task.stop",
      text: `task.stop ${taskId}`,
      taskId,
    });
    saveState(state);
    return true;
  }

  function pauseTask(state, taskId, paused) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return false;
    const child = runningProcess(taskId);
    if (child && process.platform !== "win32") {
      try {
        process.kill(child.pid, paused ? "SIGSTOP" : "SIGCONT");
      } catch {
        // UI state still records the requested transition.
      }
    }
    task.status = paused ? "paused" : "running";
    task.trace.push({
      kind: "runtime",
      actor: `${PRODUCT_NAME} daemon`,
      time: "刚刚",
      title: paused ? "任务已暂停" : "任务已继续",
      description: paused ? "lease 保留,状态可恢复。" : "runtime session 继续执行。",
    });
    appendEvent(state, {
      type: paused ? "task.pause" : "task.resume",
      text: `${paused ? "task.pause" : "task.resume"} ${taskId}`,
      taskId,
    });
    saveState(state);
    return true;
  }

  function findTaskOrThrow(state, taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) {
      const error = new Error(`Task not found: ${taskId}`);
      error.statusCode = 404;
      throw error;
    }
    return task;
  }

  function ensureEngineAvailable(state) {
    const engineId = adapter.engineId || adapter.id;
    const engine = state.engines.find((item) => item.id === engineId);
    if (!engine || engine.status !== "ok") {
      const error = new Error(`${adapter.name || engineId} is not available. Run engine detection first.`);
      error.statusCode = 409;
      throw error;
    }
  }
}

module.exports = {
  createRuntimeTaskExecutor,
};
