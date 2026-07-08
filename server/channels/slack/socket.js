"use strict";

const { getSlackConfig } = require("../../slack-config");
const { WebSocketClient } = require("../ws-client");
const { receiveSocketEnvelope } = require("./events");
const { slackFormApi } = require("./web-api");

const SLACK_CHANNEL_ID = "slack";
const SOCKET_RECONNECT_MIN_MS = 1000;
const SOCKET_RECONNECT_MAX_MS = 30000;

function startSocketTransport(options = {}, adapter = null) {
  if (!socketModeEnabled()) return null;
  const appToken = getSlackConfig().appToken;
  if (!appToken) {
    options.onStatus?.({
      channelId: SLACK_CHANNEL_ID,
      type: "socket.skipped",
      text: "slack.socket.skipped SLACK_APP_TOKEN is not set",
    });
    return null;
  }

  let stopped = false;
  let reconnectTimer = null;
  let reconnectDelay = SOCKET_RECONNECT_MIN_MS;
  let socket = null;

  async function connect() {
    if (stopped) return;
    try {
      options.onStatus?.({
        channelId: SLACK_CHANNEL_ID,
        type: "socket.connecting",
        text: "slack.socket.connecting",
      });
      const connection = await openSocketConnection(appToken);
      socket = new WebSocketClient(connection.url).connect();
      socket.on("open", () => {
        reconnectDelay = SOCKET_RECONNECT_MIN_MS;
        options.onStatus?.({
          channelId: SLACK_CHANNEL_ID,
          type: "socket.open",
          text: "slack.socket.open",
        });
      });
      socket.on("message", (text) => handleSocketMessage(text, socket, options, adapter));
      socket.on("error", (error) => {
        options.onStatus?.({
          channelId: SLACK_CHANNEL_ID,
          type: "socket.error",
          text: `slack.socket.error ${error.message}`,
        });
      });
      socket.on("close", () => {
        options.onStatus?.({
          channelId: SLACK_CHANNEL_ID,
          type: "socket.close",
          text: "slack.socket.close",
        });
        scheduleReconnect();
      });
    } catch (error) {
      options.onStatus?.({
        channelId: SLACK_CHANNEL_ID,
        type: "socket.connect_failed",
        text: `slack.socket.connect_failed ${error.message}`,
      });
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, SOCKET_RECONNECT_MAX_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  connect();

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (socket) socket.close();
    },
  };
}

function socketModeEnabled() {
  const config = getSlackConfig();
  return Boolean(config.socketMode || config.appToken);
}

async function openSocketConnection(appToken) {
  const response = await slackFormApi("apps.connections.open", {}, appToken);
  if (!response.ok || !response.url) {
    throw new Error(response.error || "apps.connections.open did not return a WebSocket URL");
  }
  return response;
}

function handleSocketMessage(text, socket, options = {}, adapter = null) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (error) {
    options.onStatus?.({
      channelId: SLACK_CHANNEL_ID,
      type: "socket.invalid_json",
      text: `slack.socket.invalid_json ${error.message}`,
    });
    return;
  }

  if (envelope.type === "hello") {
    options.onStatus?.({
      channelId: SLACK_CHANNEL_ID,
      type: "socket.hello",
      text: "slack.socket.hello",
    });
    return;
  }

  if (envelope.type === "disconnect") {
    options.onStatus?.({
      channelId: SLACK_CHANNEL_ID,
      type: "socket.disconnect",
      text: `slack.socket.disconnect ${envelope.reason || "unknown"}`,
    });
    socket.close();
    return;
  }

  if (!envelope.envelope_id) return;
  socket.sendJson({ envelope_id: envelope.envelope_id });

  Promise.resolve(receiveSocketEnvelope(envelope, {
    profile: options.getProfile?.(),
    isKnownThread: options.isKnownThread,
  }))
    .then((normalized) => {
      if (!normalized || normalized.kind === "response") {
        const reason = normalized?.response?.body?.reason;
        if (reason) {
          options.onStatus?.({
            channelId: SLACK_CHANNEL_ID,
            type: "socket.ignored",
            text: `slack.socket.ignored ${reason}`,
          });
        }
        return;
      }

      Promise.resolve(options.processEnvelope?.(adapter, normalized)).catch((error) => {
        options.onStatus?.({
          channelId: SLACK_CHANNEL_ID,
          type: "socket.process_failed",
          text: `slack.socket.process_failed ${error.message}`,
        });
      });
    })
    .catch((error) => {
      options.onStatus?.({
        channelId: SLACK_CHANNEL_ID,
        type: "socket.process_failed",
        text: `slack.socket.process_failed ${error.message}`,
      });
    });
}

module.exports = {
  handleSocketMessage,
  openSocketConnection,
  socketModeEnabled,
  startSocketTransport,
};
