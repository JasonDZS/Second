"use strict";

const { isConfigurableChannel, normalizeChannelConfigId } = require("../../channel-config");
const { truthy } = require("./system");

async function handleIntegrationRoutes(req, res, url, ctx) {
  const {
    appendEvent,
    broadcast,
    decorateState,
    getChannelAdapter,
    getPublicChannelConfig,
    getPublicSlackConfig,
    loadState,
    nowIso,
    processChannelEnvelope,
    readBody,
    restartChannelTransports,
    saveChannelConfig,
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
    const result = await sendAdapterTestMessage(getChannelAdapter("slack"), {
      channel: body.channel,
      text: body.text,
    });
    sendJson(res, 200, { result });
    return true;
  }

  const configMatch = url.pathname.match(/^\/api\/integrations\/([^/]+)\/config$/);
  if (configMatch && req.method === "GET") {
    const channelId = normalizeChannelConfigId(configMatch[1]);
    if (!isConfigurableChannel(channelId)) {
      sendJson(res, 404, { error: "Channel integration is not configurable" });
      return true;
    }
    sendJson(res, 200, { channel: getPublicChannelConfig(channelId) });
    return true;
  }

  if (configMatch && req.method === "POST") {
    const channelId = normalizeChannelConfigId(configMatch[1]);
    if (!isConfigurableChannel(channelId)) {
      sendJson(res, 404, { error: "Channel integration is not configurable" });
      return true;
    }
    const body = await readBody(req);
    const channel = saveChannelConfig(channelId, body);
    const state = loadState();
    appendEvent(state, {
      type: `channel.${channelId}.config_saved`,
      text: `channel.${channelId}.config_saved`,
      channelId,
    });
    saveState(state);
    restartChannelTransports();
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, { channel });
    return true;
  }

  const testMatch = url.pathname.match(/^\/api\/integrations\/([^/]+)\/test-message$/);
  if (testMatch && req.method === "POST") {
    const channelId = normalizeChannelConfigId(testMatch[1]);
    if (!isConfigurableChannel(channelId)) {
      sendJson(res, 404, { error: "Channel integration is not configurable" });
      return true;
    }
    const adapter = getChannelAdapter(channelId);
    if (!adapter?.sendTestMessage) {
      sendJson(res, 404, { error: "Channel adapter is unavailable" });
      return true;
    }
    const body = await readBody(req);
    const result = await sendAdapterTestMessage(adapter, {
      channel: body.channel || body.testTarget,
      text: body.text,
    });
    sendJson(res, 200, { result });
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

async function sendAdapterTestMessage(adapter, input = {}) {
  try {
    const result = await adapter.sendTestMessage(input);
    return result || { ok: false, skipped: true, reason: "No test message result" };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "Test message failed",
    };
  }
}

module.exports = {
  handleIntegrationRoutes,
  sendAdapterTestMessage,
};
