"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

function createRuntimeManager(deps = {}) {
  const {
    appendEvent = () => {},
    nowIso = () => new Date().toISOString(),
    runtimeAdapters = [],
    saveState = () => {},
  } = deps;

  const running = new Map();
  let stateChangeListener = null;

  function setStateChangeListener(listener) {
    stateChangeListener = typeof listener === "function" ? listener : null;
  }

  function emitStateChange() {
    if (!stateChangeListener) return;
    try {
      stateChangeListener();
    } catch {
      // Runtime state persistence must not depend on UI clients being connected.
    }
  }

  function saveStateAndEmit(state) {
    saveState(state);
    emitStateChange();
  }

  function commandExists(command) {
    try {
      const bin = execFileSync("which", [command], { encoding: "utf8" }).trim();
      return bin || null;
    } catch {
      return null;
    }
  }

  function detectCommand(command, versionArgs = ["--version"]) {
    const bin = commandExists(command);
    if (!bin) {
      return {
        status: "missing",
        path: null,
        version: null,
        reason: `PATH 中未找到 ${command}`,
        detectedAt: nowIso(),
      };
    }

    try {
      const stdout = execFileSync(command, versionArgs, {
        encoding: "utf8",
        timeout: 10000,
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      return {
        status: "ok",
        path: bin,
        version: stdout.split(/\r?\n/).filter(Boolean).pop() || stdout,
        reason: "探针通过",
        detectedAt: nowIso(),
      };
    } catch (error) {
      return {
        status: "error",
        path: bin,
        version: null,
        reason: error.stderr?.toString().trim() || error.message,
        detectedAt: nowIso(),
      };
    }
  }

  function detectEngines(state = {}) {
    const probes = new Map();
    for (const adapter of runtimeAdapters) {
      if (!adapter?.engineId || !adapter.command) continue;
      probes.set(adapter.engineId, detectCommand(adapter.command, adapter.versionArgs || ["--version"]));
    }

    state.engines = (state.engines || []).map((engine) => {
      const probe = probes.get(engine.id);
      if (!probe) return engine;
      return {
        ...engine,
        ...probe,
        isDefault: state.settings?.defaultEngine === engine.id,
      };
    });
    if (state.settings) state.settings.lastScan = nowIso();
    appendEvent(state, {
      type: "engine.detect",
      text: `engine.detect ${Array.from(probes.entries()).map(([id, probe]) => `${id}=${probe.status}`).join(" ")}`,
    });
    saveState(state);
    return state.engines;
  }

  function attachProcess({ child, taskId, rawLogFile, onStdoutLine, onStderr, onClose }) {
    const rawStream = createRawStream(rawLogFile);
    let stdoutBuffer = "";

    trackProcess(taskId, child);

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      rawStream.write(text);
      stdoutBuffer += text;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) onStdoutLine?.(line);
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      rawStream.write(text);
      onStderr?.(text);
    });

    child.on("close", (code, signal) => {
      untrackProcess(taskId);
      rawStream.end();
      onClose?.({ code, signal, trailingStdout: stdoutBuffer });
    });

    return {
      child,
      rawLogFile,
      taskId,
    };
  }

  function startInvocation(invocation = {}, handlers = {}) {
    const child = spawn(invocation.command, invocation.args || [], {
      cwd: invocation.cwd,
      env: invocation.env,
      stdio: invocation.stdio || ["ignore", "pipe", "pipe"],
    });
    attachProcess({
      child,
      taskId: handlers.taskId,
      rawLogFile: handlers.rawLogFile || invocation.rawLogFile,
      onStdoutLine: handlers.onStdoutLine,
      onStderr: handlers.onStderr,
      onClose: handlers.onClose,
    });
    return child;
  }

  function createRawStream(rawLogFile) {
    if (!rawLogFile) {
      return {
        write() {},
        end() {},
      };
    }
    fs.mkdirSync(path.dirname(rawLogFile), { recursive: true });
    return fs.createWriteStream(rawLogFile, { flags: "a" });
  }

  function trackProcess(taskId, child) {
    if (taskId) running.set(taskId, child);
  }

  function untrackProcess(taskId) {
    if (taskId) running.delete(taskId);
  }

  function runningProcess(taskId) {
    return running.get(taskId) || null;
  }

  function isTaskRunning(taskId) {
    return running.has(taskId);
  }

  function getRunningTasks() {
    return Array.from(running.keys());
  }

  return {
    attachProcess,
    commandExists,
    detectCommand,
    detectEngines,
    emitStateChange,
    getRunningTasks,
    isTaskRunning,
    runningProcess,
    saveStateAndEmit,
    setStateChangeListener,
    startInvocation,
    trackProcess,
    untrackProcess,
  };
}

module.exports = {
  createRuntimeManager,
};
