"use strict";

async function handleTaskRoutes(req, res, url, ctx) {
  const {
    archiveTask,
    broadcast,
    createTask,
    decorateState,
    isTaskRunning,
    loadState,
    pauseTask,
    readBody,
    resumeLatestTaskRun,
    runCodexTask,
    sendJson,
    stopTask,
  } = ctx;

  if (req.method === "POST" && url.pathname === "/api/tasks") {
    const body = await readBody(req);
    const state = loadState();
    const task = createTask(state, body);
    if (body.run) runCodexTask(state, task.id);
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 201, { task: loadState().tasks.find((item) => item.id === task.id) });
    return true;
  }

  const taskRunMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
  if (req.method === "POST" && taskRunMatch) {
    const state = loadState();
    const result = runCodexTask(state, decodeURIComponent(taskRunMatch[1]));
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, result);
    return true;
  }

  const taskResumeMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/resume$/);
  if (req.method === "POST" && taskResumeMatch) {
    try {
      const result = resumeLatestTaskRun(loadState(), decodeURIComponent(taskResumeMatch[1]));
      broadcast({ type: "state", state: decorateState(loadState()) });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message });
    }
    return true;
  }

  const taskStopMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/stop$/);
  if (req.method === "POST" && taskStopMatch) {
    const state = loadState();
    const ok = stopTask(state, decodeURIComponent(taskStopMatch[1]));
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, ok ? 200 : 404, ok ? { ok } : { error: "Task not found" });
    return true;
  }

  const taskPauseMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/pause$/);
  if (req.method === "POST" && taskPauseMatch) {
    const body = await readBody(req);
    const state = loadState();
    const taskId = decodeURIComponent(taskPauseMatch[1]);
    if (body.paused === false && !isTaskRunning(taskId)) {
      try {
        const result = resumeLatestTaskRun(state, taskId);
        broadcast({ type: "state", state: decorateState(loadState()) });
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message });
      }
      return true;
    }
    const ok = pauseTask(state, taskId, Boolean(body.paused));
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, ok ? 200 : 404, ok ? { ok } : { error: "Task not found" });
    return true;
  }

  const taskArchiveMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/archive$/);
  if (req.method === "POST" && taskArchiveMatch) {
    const state = loadState();
    const result = archiveTask(state, decodeURIComponent(taskArchiveMatch[1]));
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, result);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/tasks/stop-all") {
    const state = loadState();
    for (const task of state.tasks.filter((item) => ["running", "needs_human", "paused", "pending_resume", "resuming"].includes(item.status))) {
      stopTask(state, task.id);
    }
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

module.exports = {
  handleTaskRoutes,
};
