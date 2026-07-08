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

module.exports = {
  handleIntegrationRoutes,
};
