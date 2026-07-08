"use strict";

const fs = require("fs");
const path = require("path");

function createRuntimeRecovery(deps = {}) {
  const {
    PRODUCT_NAME = "Second",
    appendEvent,
    getRunningTasks,
    nowIso,
  } = deps;

  function reconcileInterruptedRuntimeTasks(state) {
    const tracked = new Set(getRunningTasks());
    const recoveredResults = [];
    for (const task of state.tasks || []) {
      if (!["running", "resuming"].includes(task.status) || tracked.has(task.id)) continue;
      const outputFile = task.resumeOutputFile || task.outputFile;
      const finalText = readTextIfPresent(outputFile);
      if (finalText && !/^SECOND_WAITING_FOR_DECISION:/m.test(finalText.trim())) {
        task.status = "done";
        task.completedAt = nowIso();
        task.summary = firstLine(finalText) || `${task.agent}执行已恢复为完成状态。`;
        task.trace.push({
          kind: "out",
          actor: task.agent,
          time: "刚刚",
          title: "恢复遗留结果",
          description: `daemon 重启后发现已写入的结果文件 ${path.basename(outputFile)},已校正任务状态。`,
        });
        appendEvent(state, {
          type: "codex.recovered.done",
          text: `codex.recovered.done ${task.id}`,
          taskId: task.id,
        });
        recoveredResults.push({ task, result: { success: true, phase: "recovered", finalText, outputFile } });
        continue;
      }

      task.status = task.codexSessionId ? "paused" : "failed";
      task.completedAt = null;
      task.summary = task.codexSessionId
        ? "daemon 重启后失去对上一次 Codex 子进程的跟踪,已取消运行中标记;可通过同一 Slack 线程的新消息继续恢复。"
        : "daemon 重启后失去对上一次 Codex 子进程的跟踪,且没有可恢复 session。";
      task.trace.push({
        kind: "runtime",
        actor: `${PRODUCT_NAME} daemon`,
        time: "刚刚",
        title: "运行状态已校正",
        description: "本地 daemon 重启后无法再接收旧 Codex 子进程的退出事件,已停止显示为运行中。",
      });
      appendEvent(state, {
        type: "codex.recovered.paused",
        text: `codex.recovered.paused ${task.id}`,
        taskId: task.id,
      });
    }
    return recoveredResults;
  }

  return {
    reconcileInterruptedRuntimeTasks,
  };
}

function readTextIfPresent(file) {
  if (!file) return "";
  try {
    if (!fs.existsSync(file)) return "";
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function firstLine(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

module.exports = {
  createRuntimeRecovery,
  firstLine,
  readTextIfPresent,
};
