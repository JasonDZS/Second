"use strict";

const { truthy } = require("./system");

async function handleIntegrationRoutes(req, res, url, ctx) {
  const {
    appendEvent,
    broadcast,
    decorateState,
    getChannelAdapter,
    getPublicSlackConfig,
    loadState,
    nowIso,
    processChannelEnvelope,
    readBody,
    restartChannelTransports,
    saveSlackConfig,
    saveState,
    sendJson,
  } = ctx;

  if (req.method === "GET" && url.pathname === "/api/integrations/slack/config") {
    sendJson(res, 200, { slack: getPublicSlackConfig() });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/slack/config") {
    const body = await readBody(req);
    const slack = saveSlackConfig(body);
    const state = loadState();
    appendEvent(state, {
      type: "channel.slack.config_saved",
      text: `channel.slack.config_saved mode=${slack.mode}`,
      channelId: "slack",
    });
    saveState(state);
    restartChannelTransports();
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, { slack });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/slack/reconnect") {
    restartChannelTransports();
    const state = loadState();
    appendEvent(state, {
      type: "channel.slack.reconnect_requested",
      text: "channel.slack.reconnect_requested",
      channelId: "slack",
    });
    saveState(state);
    broadcast({ type: "state", state: decorateState(state) });
    sendJson(res, 200, { ok: true, slack: getPublicSlackConfig() });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/slack/test-message") {
    const body = await readBody(req);
    const result = await getChannelAdapter("slack").sendTestMessage({
      channel: body.channel,
      text: body.text,
    });
    sendJson(res, result.ok === false && !result.skipped ? 502 : 200, { result });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/slack/simulate-task") {
    const body = await readBody(req);
    if (!processChannelEnvelope) {
      sendJson(res, 500, { error: "Channel processor is unavailable" });
      return true;
    }
    const adapter = getChannelAdapter("slack");
    const publicSlack = getPublicSlackConfig();
    const now = nowIso ? nowIso() : new Date().toISOString();
    const eventTs = body.ts || String(Date.now() / 1000);
    const channel = body.channel || publicSlack.decisionChannel || firstCsv(publicSlack.allowedChannels) || "CSECONDLOCAL";
    const event = {
      type: "app_mention",
      channel,
      channelName: body.channelName || "second-local-test",
      user: body.user || "USECONDLOCAL",
      text: body.text || "帮我检查当前 Second daemon 是否可以处理来自 Slack 的任务",
      ts: eventTs,
      thread_ts: body.threadTs || eventTs,
      team: body.team || "TSECONDLOCAL",
    };
    const state = loadState();
    const taskInput = adapter.slackEventToTaskInput(event, state.profile || {});
    taskInput.sourceMessage = {
      type: "slack",
      label: "Slack",
      actor: event.user,
      text: taskInput.messageText,
      createdAt: now,
      external: taskInput.channel.external,
    };
    const result = processChannelEnvelope(adapter, {
      kind: "task.requested",
      channelId: "slack",
      taskInput,
    });
    sendJson(res, 201, { ok: true, task: result.task, simulated: true });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/slack/manifest") {
    const socketMode = truthy(url.searchParams.get("socket_mode"));
    const customizeProfileMessages = truthy(url.searchParams.get("customize_profile"));
    sendJson(res, 200, {
      manifest: getChannelAdapter("slack").manifest({ socketMode, customizeProfileMessages }),
    });
    return true;
  }

  return false;
}

function firstCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .find(Boolean);
}

module.exports = {
  handleIntegrationRoutes,
};
