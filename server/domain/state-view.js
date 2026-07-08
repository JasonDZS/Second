"use strict";

function createStateDecorator(deps = {}) {
  const {
    DATA_DIR = "",
    DEFAULT_PORT = 7317,
    computePhase1Metrics,
    getPublicSlackConfig = () => ({}),
    getRunningTasks = () => [],
  } = deps;

  return function decorateState(state) {
    const visibleTasks = (state.tasks || []).filter((item) => !item.archivedAt);
    const visibleDecisions = (state.decisions || []).filter((item) => !item.archivedAt);
    const pendingDecisions = visibleDecisions.filter((item) => item.status === "pending").length;
    const runningTasks = getRunningTasks();
    const activeStatuses = ["running", "needs_human", "paused", "pending_resume", "resuming"];
    const metrics = computePhase1Metrics
      ? computePhase1Metrics({ ...state, tasks: visibleTasks, decisions: visibleDecisions })
      : {};
    return {
      ...state,
      tasks: visibleTasks,
      decisions: visibleDecisions,
      archived: {
        tasks: (state.tasks || []).filter((item) => item.archivedAt).length,
        decisions: (state.decisions || []).filter((item) => item.archivedAt).length,
      },
      metrics: {
        ...metrics,
        pendingDecisions,
        runningTasks: visibleTasks.filter((task) => activeStatuses.includes(task.status)).length,
        completedTasks: visibleTasks.filter((task) => task.status === "done").length,
        highRiskBlocks: visibleDecisions.filter((item) => item.risk === "高").length,
      },
      runtime: {
        runningTaskIds: runningTasks,
        port: state.daemon?.port || DEFAULT_PORT,
        dataDir: DATA_DIR,
      },
      integrations: {
        ...(state.integrations || {}),
        slack: {
          ...getPublicSlackConfig(),
          recentEvents: (state.events || [])
            .filter((event) => String(event.type || "").startsWith("channel.socket") || String(event.type || "").startsWith("channel.slack"))
            .slice(0, 8),
        },
      },
    };
  };
}

module.exports = {
  createStateDecorator,
};
