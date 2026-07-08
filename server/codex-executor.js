"use strict";

const { appendEvent, loadState, makeId, nowIso, saveState } = require("./state");
const { notifyTaskResult } = require("./channels");
const { handleCodexJsonLine } = require("./codex/events");
const { createCodexProcessCloseHandler } = require("./codex/process-close");
const { createTask } = require("./codex/tasks");
const { createRuntimeManager } = require("./runtime-manager");
const { createRuntimeTaskExecutor } = require("./runtime/task-executor");
const { codexRuntimeAdapter } = require("./runtimes/codex");
const { runtimeEngineAdapters } = require("./runtimes");

const PRODUCT_NAME = "Second";
const runtimeManager = createRuntimeManager({
  appendEvent,
  nowIso,
  runtimeAdapters: runtimeEngineAdapters(),
  saveState,
});

const codexExecutor = createRuntimeTaskExecutor({
  PRODUCT_NAME,
  adapter: codexRuntimeAdapter,
  appendEvent,
  createProcessCloseHandler: ({ resumeTask }) => createCodexProcessCloseHandler({
    PRODUCT_NAME,
    appendEvent,
    loadState,
    makeId,
    notifyTaskResult,
    nowIso,
    resumeCodexTask: resumeTask,
    saveStateAndEmit: runtimeManager.saveStateAndEmit,
  }).handleCodexProcessClose,
  handleRuntimeLine: handleCodexJsonLine,
  loadState,
  makeId,
  nowIso,
  runtimeManager,
  saveState,
});

module.exports = {
  createTask,
  detectCommand: codexExecutor.detectCommand,
  detectEngines: codexExecutor.detectEngines,
  getRunningTasks: codexExecutor.getRunningTasks,
  isTaskRunning: codexExecutor.isTaskRunning,
  pauseTask: codexExecutor.pauseTask,
  resumeCodexTask: codexExecutor.resumeTask,
  runCodexTask: codexExecutor.runTask,
  setStateChangeListener: codexExecutor.setStateChangeListener,
  stopTask: codexExecutor.stopTask,
};
