"use strict";

function createStateDecorator(deps = {}) {
  const {
    DATA_DIR = "",
    DEFAULT_PORT = 7317,
    computePhase1Metrics,
    getPublicChannelConfigs = () => ({}),
    getPublicAccessConfig = () => ({}),
    getPublicMobilePushConfig = () => ({}),
    getPublicSlackConfig = () => ({}),
    getRunningTasks = () => [],
    listChannelAdapters = () => [],
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
    const slackRecentEvents = (state.events || [])
      .filter((event) => String(event.type || "").startsWith("channel.socket") || String(event.type || "").startsWith("channel.slack"))
      .slice(0, 8);
    const slack = {
      ...getPublicSlackConfig(),
      recentEvents: slackRecentEvents,
    };
    const channelConfigs = withChannelRecentEvents(getPublicChannelConfigs(), state.events || []);
    return {
      ...state,
      channels: decorateChannels(state.channels || [], {
        adapters: listChannelAdapters(),
        slack,
      }),
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
        channelConfigs,
        ...channelConfigs,
        slack,
        mobilePwa: {
          ...getPublicMobilePushConfig(),
          recentEvents: (state.events || [])
            .filter((event) => String(event.type || "").startsWith("mobile.push"))
            .slice(0, 8),
        },
        publicAccess: {
          ...getPublicAccessConfig(state),
          recentEvents: (state.events || [])
            .filter((event) => String(event.type || "").startsWith("public_access"))
            .slice(0, 8),
        },
      },
    };
  };
}

function withChannelRecentEvents(configs = {}, events = []) {
  return Object.fromEntries(
    Object.entries(configs || {}).map(([id, config]) => [
      id,
      {
        ...config,
        recentEvents: events
          .filter((event) => event.channelId === id || String(event.type || "").startsWith(`channel.${id}`))
          .slice(0, 8),
      },
    ]),
  );
}

function decorateChannels(channels = [], context = {}) {
  const adaptersById = new Map((context.adapters || []).map((adapter) => [adapter.id, adapter]));
  return channels.map((channel) => decorateChannel(channel, adaptersById.get(channel.id), context));
}

function decorateChannel(channel = {}, adapter = null, context = {}) {
  if (channel.id === "assistant") {
    return {
      ...channel,
      status: "connected",
      notify: channel.notify !== false,
    };
  }
  if (channel.id === "slack") return decorateSlackChannel(channel, context.slack || {});
  if (adapter && adapter.status === "implemented") return decorateImplementedChannel(channel, adapter);
  if (adapter && (adapter.kind === "placeholder" || adapter.status === "not_implemented")) {
    return {
      ...channel,
      status: "not_configured",
      notify: false,
      meta: placeholderChannelMeta(channel),
    };
  }
  return channel;
}

function decorateImplementedChannel(channel = {}, adapter = {}) {
  const connected = Boolean(adapter.configured || channel.status === "connected");
  return {
    ...channel,
    status: connected ? "connected" : "disconnected",
    notify: connected ? channel.notify !== false : false,
    meta: adapter.meta || channel.meta || `${channel.name || adapter.name} webhook adapter`,
  };
}

function placeholderChannelMeta(channel = {}) {
  const map = {
    linear: "适配层未接入 · 连接后支持指派 issue 与状态自动同步",
    clickup: "适配层未接入 · 连接后支持指派任务与定时任务触发",
  };
  return map[channel.id] || "适配层未接入";
}

function decorateSlackChannel(channel = {}, slack = {}) {
  const connected = slackConnected(slack);
  return {
    ...channel,
    status: connected ? "connected" : "disconnected",
    notify: connected ? channel.notify !== false : false,
  };
}

function slackConnected(slack = {}) {
  if (slack.socketMode) {
    if (!slack.botTokenConfigured || !slack.appTokenConfigured) return false;
    return (slack.recentEvents || []).some((event) => (
      event.type === "channel.socket.hello" ||
      event.type === "channel.socket.open" ||
      event.type === "channel.socket.connected"
    ));
  }
  return Boolean(slack.botTokenConfigured && slack.signingSecretConfigured);
}

module.exports = {
  createStateDecorator,
  decorateChannels,
};
