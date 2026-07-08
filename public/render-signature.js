(function initSecondRenderSignature(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root || {};
  if (target) target.SecondRenderSignature = api;
  if (typeof window === "object") window.SecondRenderSignature = api;
  if (typeof globalThis === "object") globalThis.SecondRenderSignature = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondRenderSignature() {
  function renderSignature(nextState, ui = {}, currentProfileForm = () => ({})) {
    if (!nextState) return "empty";
    const sidebar = {
      view: ui.view,
      profile: profileSignature(nextState.profile),
      rules: nextState.rules?.length || 0,
      pending: nextState.metrics?.pendingDecisions || 0,
    };
    if (ui.profilePanel) {
      return stableJson({
        ...sidebar,
        panel: "profile",
        profileForm: currentProfileForm(),
      });
    }
    if (ui.view === "inbox") {
      return stableJson({
        ...sidebar,
        selectedDecision: ui.selectedDecision,
        decisions: (nextState.decisions || []).map(decisionSignature),
      });
    }
    if (ui.view === "tasks") {
      return stableJson({
        ...sidebar,
        selectedTask: ui.selectedTask,
        selectedDecision: ui.selectedDecision,
        tasks: (nextState.tasks || []).map(taskSignature),
      });
    }
    if (ui.view === "auth") {
      return stableJson({
        ...sidebar,
        preferences: nextState.preferences,
        candidates: nextState.candidates,
        rules: nextState.rules,
      });
    }
    if (ui.view === "mobile") {
      return stableJson({
        ...sidebar,
        decisions: (nextState.decisions || []).map(decisionSignature),
        metrics: mobileMetricsSignature(nextState.metrics),
      });
    }
    return stableJson({
      ...sidebar,
      selectedTask: ui.selectedTask,
      daemon: nextState.daemon,
      engines: nextState.engines,
      channels: nextState.channels,
      integrations: nextState.integrations,
      metrics: nextState.metrics,
      events: (nextState.events || []).slice(0, 20),
      tasks: (nextState.tasks || []).map(taskSignature),
    });
  }

  function profileSignature(profile = {}) {
    return {
      name: profile.name,
      avatar: profile.avatar,
      avatarUrl: profile.avatarUrl,
      agentName: profile.agentName,
      tagline: profile.tagline,
      roleIntro: profile.roleIntro,
    };
  }

  function decisionSignature(decision = {}) {
    return {
      id: decision.id,
      type: decision.type,
      risk: decision.risk,
      title: decision.title,
      taskId: decision.taskId,
      taskTitle: decision.taskTitle,
      source: decision.source,
      agent: decision.agent,
      engine: decision.engine,
      status: decision.status,
      selectedOption: decision.selectedOption,
      createdAt: decision.createdAt,
      decidedAt: decision.decidedAt,
      summary: decision.summary,
      impact: decision.impact,
      options: decision.options,
      artifacts: decision.artifacts,
      replies: decision.replies,
    };
  }

  function taskSignature(task = {}) {
    return {
      id: task.id,
      title: task.title,
      source: task.source,
      agent: task.agent,
      engine: task.engine,
      status: task.status,
      decisionId: task.decisionId,
      summary: task.summary,
      fileDelta: task.fileDelta,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      trace: task.trace,
      artifacts: task.artifacts,
    };
  }

  function mobileMetricsSignature(metrics = {}) {
    return {
      completedTasks: metrics.completedTasks,
      highRiskBlocks: metrics.highRiskBlocks,
      zeroHandoffRate: metrics.zeroHandoffRate,
      pendingDecisions: metrics.pendingDecisions,
    };
  }

  function stableJson(value) {
    return JSON.stringify(value);
  }

  return {
    decisionSignature,
    mobileMetricsSignature,
    profileSignature,
    renderSignature,
    stableJson,
    taskSignature,
  };
});
