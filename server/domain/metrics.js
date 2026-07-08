"use strict";

function computePhase1Metrics(state) {
  const tasks = state.tasks || [];
  const decisions = state.decisions || [];
  const completed = tasks.filter((task) => task.status === "done");
  const finished = tasks.filter((task) => ["done", "failed", "stopped"].includes(task.status));
  const channelCompleted = completed.filter((task) => task.channel?.id || task.slack);
  const resolvedDecisions = decisions.filter((decision) => decision.createdAt && decision.decidedAt);
  const latencies = resolvedDecisions
    .map((decision) => Date.parse(decision.decidedAt) - Date.parse(decision.createdAt))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const decisionsByTask = decisions.filter((decision) => decision.taskId);
  const resumeEligible = decisions.filter((decision) => {
    const task = tasks.find((item) => item.id === decision.taskId);
    return task?.codexSessionId && decision.status !== "pending";
  });
  const resumeCompleted = resumeEligible.filter((decision) => {
    const task = tasks.find((item) => item.id === decision.taskId);
    return task?.status === "done";
  });

  return {
    zeroHandoffRate: percent(channelCompleted.length, completed.length),
    zeroHandoffTasks: channelCompleted.length,
    decisionLatencyMsMedian: median(latencies),
    medianDecisionLatency: formatDuration(median(latencies)),
    decisionInterruptionDensity: tasks.length ? round(decisionsByTask.length / tasks.length, 2) : 0,
    taskSuccessRate: percent(completed.length, finished.length),
    resumeCorrectnessRate: percent(resumeCompleted.length, resumeEligible.length),
    resolvedDecisions: resolvedDecisions.length,
  };
}

function median(values) {
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  if (values.length % 2) return values[mid];
  return Math.round((values[mid - 1] + values[mid]) / 2);
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatDuration(ms) {
  if (ms == null) return "暂无数据";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

module.exports = {
  computePhase1Metrics,
  formatDuration,
  median,
  percent,
  round,
};
