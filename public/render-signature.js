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
      activeTasks: activeTaskCount(nextState),
      assistantOpen: Boolean(ui.assistantOpen),
      assistant: assistantSignature(nextState),
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
        authorization: nextState.authorization,
        authLab: ui.authLab,
      });
    }
    if (ui.view === "mobile") {
      return stableJson({
        ...sidebar,
        decisions: (nextState.decisions || []).map(decisionSignature),
        metrics: mobileMetricsSignature(nextState.metrics),
        mobilePwa: mobilePwaSignature(nextState.integrations?.mobilePwa),
        publicAccess: publicAccessSignature(nextState.integrations?.publicAccess),
      });
    }
    if (ui.view === "onboarding") {
      return stableJson({
        ...sidebar,
        onboardingStep: ui.onboardingStep,
        onboardingAuthLevel: ui.onboardingAuthLevel,
        onboardingMobileSkipped: Boolean(ui.onboardingMobileSkipped),
        onboardingPushEnabled: ui.onboardingPushEnabled,
        onboardingDemoText: ui.onboardingDemoText,
        mobilePairingUrl: ui.mobilePairingUrl,
        mobilePairingLoading: Boolean(ui.mobilePairingLoading),
        mobileMockStatus: ui.mobileMockStatus,
        daemon: nextState.daemon,
        engines: nextState.engines,
        integrations: nextState.integrations,
        profile: profileSignature(nextState.profile),
        rules: nextState.rules,
        settings: nextState.settings,
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
      settingsChannelConfig: ui.settingsChannelConfig || null,
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

  function assistantSignature(state = {}) {
    return {
      activeConversationId: state.assistant?.activeConversationId || "local-assistant",
      messages: (state.assistant?.messages || []).map((message) => ({
        id: message.id,
        role: message.role,
        at: message.at,
        text: message.text,
        status: message.status,
        taskId: message.taskId,
        inReplyTo: message.inReplyTo,
        conversationId: message.conversationId,
      })),
      tasks: (state.tasks || [])
        .filter((task) => task.channel?.id === "assistant")
        .map((task) => ({
          id: task.id,
          status: task.status,
          summary: task.summary,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          messageId: task.channel?.external?.messageId,
          resumeMessageId: task.lastResumeRequest?.external?.messageId,
          followups: (task.channelFollowups || []).map((followup) => followup.external?.messageId),
        })),
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

  function mobilePwaSignature(push = {}) {
    return {
      paired: Boolean(push.paired),
      publicUrl: push.publicUrl,
      subscriptionCount: push.subscriptionCount || 0,
      supported: Boolean(push.supported),
      subscriptions: (push.subscriptions || []).map((subscription) => ({
        id: subscription.id,
        label: subscription.label,
        endpointHost: subscription.endpointHost,
        createdAt: subscription.createdAt,
        lastSeenAt: subscription.lastSeenAt,
      })),
    };
  }

  function publicAccessSignature(access = {}) {
    return {
      enabled: Boolean(access.enabled),
      provider: access.provider,
      activeUrl: access.activeUrl,
      manualUrl: access.manualUrl,
      status: access.status,
      lastCheck: access.lastCheck,
      lastError: access.lastError,
    };
  }

  function activeTaskCount(state = {}) {
    if (Array.isArray(state.tasks)) {
      return state.tasks.filter((task) => (
        !task.archivedAt && ["running", "needs_human", "pending_resume", "resuming"].includes(task.status)
      )).length;
    }
    return Number(state.metrics?.runningTasks || 0);
  }

  function stableJson(value) {
    return JSON.stringify(value);
  }

  return {
    activeTaskCount,
    decisionSignature,
    assistantSignature,
    mobilePwaSignature,
    publicAccessSignature,
    mobileMetricsSignature,
    profileSignature,
    renderSignature,
    stableJson,
    taskSignature,
  };
});
