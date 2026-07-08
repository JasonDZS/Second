"use strict";

const http = require("http");
const path = require("path");
const { URL } = require("url");
const {
  DATA_DIR,
  RUNS_DIR,
  ROOT_DIR,
  appendDecisionLog,
  appendEvent,
  loadState,
  makeId,
  nowIso,
  saveState,
  traceT2087,
} = require("./state");
const {
  createTask,
  detectEngines,
  getRunningTasks,
  isTaskRunning,
  pauseTask,
  resumeCodexTask,
  runCodexTask,
  setStateChangeListener,
  stopTask,
} = require("./codex-executor");
const {
  findHttpChannelAdapter,
  getChannelAdapter,
  listChannelAdapters,
  notifyDecisionRequested,
  notifyDecisionResolved,
  notifyTaskAccepted,
  notifyTaskResult,
  startChannelTransports,
} = require("./channels");
const { createChannelController } = require("./channels/controller");
const { createChannelProcessor } = require("./channels/processor");
const { getPublicSlackConfig, saveSlackConfig } = require("./slack-config");
const { createDecisionDomain } = require("./domain/decisions");
const { computePhase1Metrics } = require("./domain/metrics");
const { updateProfile } = require("./domain/profile");
const { createStateDecorator } = require("./domain/state-view");
const { createApiHandler } = require("./http/api");
const { readBody, readRawBody, sendJson } = require("./http/json");
const { createSseHub } = require("./http/sse");
const { createStaticHandler } = require("./http/static");
const { createRuntimeRecovery } = require("./runtime/recovery");
const { createRuntimeResumeController } = require("./runtime/resume");

const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DEFAULT_PORT = Number(process.env.PORT || process.env.SECOND_PORT || 7317);
const PRODUCT_NAME = "Second";

const {
  appendDecisionReply,
  archiveTask,
  createDecisionTestTask,
  createMcpDecisionRequest,
  markClarificationDecisionApproved,
  resolveDecision,
  shouldCompleteClarificationDecision,
} = createDecisionDomain({
  PRODUCT_NAME,
  RUNS_DIR,
  appendDecisionLog,
  appendEvent,
  makeId,
  nowIso,
  notifyDecisionRequested,
  notifyDecisionResolved,
  saveState,
  stopTask,
  traceT2087,
});

const { reconcileInterruptedRuntimeTasks } = createRuntimeRecovery({
  PRODUCT_NAME,
  appendEvent,
  getRunningTasks,
  nowIso,
});
const decorateState = createStateDecorator({
  DATA_DIR,
  DEFAULT_PORT,
  computePhase1Metrics,
  getPublicSlackConfig,
  getRunningTasks,
});
const { resumeLatestTaskRun } = createRuntimeResumeController({
  PRODUCT_NAME,
  appendEvent,
  isTaskRunning,
  loadState,
  resumeCodexTask,
  saveState,
});
const { broadcast, handleEvents } = createSseHub({ decorateState, loadState });
const serveStatic = createStaticHandler({ publicDir: PUBLIC_DIR });

const channelProcessor = createChannelProcessor({
  appendDecisionReply,
  appendEvent,
  broadcast,
  createTask,
  decorateState,
  isTaskRunning,
  loadState,
  makeId,
  markClarificationDecisionApproved,
  notifyTaskAccepted,
  nowIso,
  resolveDecision,
  resumeCodexTask,
  runCodexTask,
  saveState,
  shouldCompleteClarificationDecision,
});
const {
  findChannelThreadTask,
  handleChannel,
  isKnownChannelThread,
  refreshSlackChannelNames,
  restartChannelTransports,
  stopChannelTransports,
} = createChannelController({
  appendEvent,
  broadcast,
  channelProcessor,
  decorateState,
  getChannelAdapter,
  loadState,
  readRawBody,
  saveState,
  sendJson,
  startChannelTransports,
});

const handleApi = createApiHandler({
  appendDecisionReply,
  appendEvent,
  archiveTask,
  broadcast,
  createDecisionTestTask,
  createMcpDecisionRequest,
  createTask,
  decorateState,
  detectEngines,
  getChannelAdapter,
  getPublicSlackConfig,
  getRunningTasks,
  isTaskRunning,
  listChannelAdapters,
  loadState,
  markClarificationDecisionApproved,
  nowIso,
  pauseTask,
  readBody,
  resolveDecision,
  restartChannelTransports,
  resumeCodexTask,
  resumeLatestTaskRun,
  runCodexTask,
  saveSlackConfig,
  saveState,
  sendJson,
  shouldCompleteClarificationDecision,
  stopTask,
  updateProfile,
});

setStateChangeListener(() => {
  broadcast({ type: "state", state: decorateState(loadState()) });
});

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (url.pathname === "/api/events") return handleEvents(req, res);
      const channelAdapter = findHttpChannelAdapter(url.pathname);
      if (channelAdapter) return await handleChannel(req, res, url, channelAdapter);
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
      return serveStatic(req, res, url);
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error.message || "Internal server error",
      });
    }
  });
}

function startServer({ port = DEFAULT_PORT, host = "127.0.0.1" } = {}) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const actualPort = server.address().port;
      const state = loadState();
      state.daemon.status = "online";
      state.daemon.port = actualPort;
      state.daemon.heartbeatAt = nowIso();
      const recoveredResults = reconcileInterruptedRuntimeTasks(state);
      appendEvent(state, {
        type: "daemon.start",
        text: `daemon.start localhost:${actualPort}`,
      });
      saveState(state);
      for (const recovered of recoveredResults) {
        notifyTaskResult(recovered.task, recovered.result).catch(() => {});
      }
      restartChannelTransports();
      refreshSlackChannelNames().catch(() => {});
      server.on("close", () => stopChannelTransports());
      resolve({ server, port: actualPort, host, url: `http://${host}:${actualPort}` });
    });
  });
}

module.exports = {
  appendDecisionReply,
  computePhase1Metrics,
  createMcpDecisionRequest,
  createDecisionTestTask,
  createServer,
  decorateState,
  findChannelThreadTask,
  resolveDecision,
  startServer,
  updateProfile,
};
