"use strict";

const { createMessagePlatformAdapter, postJson } = require("./platform-message");
const { WebSocketClient } = require("./ws-client");
const { getChannelConfig } = require("../channel-config");

const DISCORD_CHANNEL_ID = "discord";
const DISCORD_RECONNECT_MIN_MS = 5000;
const DISCORD_RECONNECT_MAX_MS = 120000;
const DISCORD_MAX_CONNECT_FAILURES = 3;
const DISCORD_CLOSE_REASONS = {
  4004: { type: "gateway.auth_failed", text: "discord.gateway.auth_failed invalid bot token", retry: false },
  4010: { type: "gateway.invalid_shard", text: "discord.gateway.invalid_shard", retry: false },
  4011: { type: "gateway.sharding_required", text: "discord.gateway.sharding_required", retry: false },
  4012: { type: "gateway.invalid_api_version", text: "discord.gateway.invalid_api_version", retry: false },
  4013: { type: "gateway.invalid_intents", text: "discord.gateway.invalid_intents", retry: false },
  4014: { type: "gateway.disallowed_intents", text: "discord.gateway.disallowed_intents privileged intent is not enabled", retry: false },
};

function discordConfig() {
  return getChannelConfig(DISCORD_CHANNEL_ID);
}

function parseIncoming({ req, pathname, body }) {
  if (req.method !== "POST") return { kind: "response", status: 405, body: { error: "Method not allowed" } };
  if (pathname !== "/discord/webhook") return { kind: "response", status: 404, body: { error: "Discord endpoint not found" } };
  if (body.type === 1) return { kind: "response", status: 200, body: { type: 1 } };

  const event = body.d || body.event || body.message || body;
  const author = event.author || event.member?.user || body.author || {};
  if (author.bot || event.webhook_id) return { ignored: true, reason: "bot_message" };
  return discordEventToMessage(event, body);
}

function startTransport(options = {}) {
  const config = discordConfig();
  if (!config.botToken) return null;

  let stopped = false;
  let reconnectTimer = null;
  let reconnectDelay = DISCORD_RECONNECT_MIN_MS;
  let heartbeatTimer = null;
  let socket = null;
  let sequence = null;
  let botUserId = null;
  let connectedOnce = false;
  let readyForCurrentSocket = false;
  let consecutiveFailures = 0;
  let lastErrorText = "";

  function connect() {
    if (stopped) return;
    readyForCurrentSocket = false;
    lastErrorText = "";
    options.onStatus?.({ channelId: DISCORD_CHANNEL_ID, type: "gateway.connecting", text: "discord.gateway.connecting" });
    socket = new WebSocketClient("wss://gateway.discord.gg/?v=10&encoding=json").connect();
    socket.on("open", () => {
      options.onStatus?.({ channelId: DISCORD_CHANNEL_ID, type: "gateway.open", text: "discord.gateway.open" });
    });
    socket.on("message", (text) => handleGatewayMessage(text));
    socket.on("error", (error) => {
      lastErrorText = error.message || String(error);
      options.onStatus?.({ channelId: DISCORD_CHANNEL_ID, type: "gateway.error", text: `discord.gateway.error ${lastErrorText}` });
    });
    socket.on("close", (info = {}) => {
      clearHeartbeat();
      if (stopped) return;
      const close = classifyGatewayClose(info);
      if (!readyForCurrentSocket) {
        consecutiveFailures += 1;
      }
      options.onStatus?.({
        channelId: DISCORD_CHANNEL_ID,
        type: close.type,
        text: close.text || lastErrorText || "discord.gateway.close",
      });
      if (!close.retry) {
        stopped = true;
        return;
      }
      if (!connectedOnce && consecutiveFailures >= DISCORD_MAX_CONNECT_FAILURES) {
        options.onStatus?.({
          channelId: DISCORD_CHANNEL_ID,
          type: "gateway.failed",
          text: `discord.gateway.failed attempts=${consecutiveFailures}${lastErrorText ? ` error=${lastErrorText}` : ""}`,
        });
        stopped = true;
        return;
      }
      scheduleReconnect();
    });
  }

  function handleGatewayMessage(text) {
    let packet;
    try {
      packet = JSON.parse(text);
    } catch (error) {
      options.onStatus?.({ channelId: DISCORD_CHANNEL_ID, type: "gateway.invalid_json", text: `discord.gateway.invalid_json ${error.message}` });
      return;
    }

    if (packet.s != null) sequence = packet.s;
    if (packet.op === 10) {
      startHeartbeat(packet.d?.heartbeat_interval || 45000);
      identify();
      return;
    }
    if (packet.op === 11) return;
    if (packet.op === 7 || packet.op === 9) {
      socket?.close();
      return;
    }
    if (packet.op !== 0) return;
    if (packet.t === "READY") {
      botUserId = packet.d?.user?.id || botUserId;
      connectedOnce = true;
      readyForCurrentSocket = true;
      consecutiveFailures = 0;
      reconnectDelay = DISCORD_RECONNECT_MIN_MS;
      options.onStatus?.({ channelId: DISCORD_CHANNEL_ID, type: "gateway.ready", text: "discord.gateway.ready" });
      return;
    }
    if (packet.t !== "MESSAGE_CREATE") return;
    if (!shouldHandleGatewayEvent(packet.d, botUserId, options)) return;
    const message = discordEventToMessage(packet.d, { botUserId });
    const normalized = {
      kind: "task.requested",
      channelId: DISCORD_CHANNEL_ID,
      taskInput: module.exports.platformMessageToTaskInput(message, options.getProfile?.()),
    };
    Promise.resolve(options.processEnvelope?.(module.exports, normalized)).catch((error) => {
      options.onStatus?.({ channelId: DISCORD_CHANNEL_ID, type: "gateway.process_failed", text: `discord.gateway.process_failed ${error.message}` });
    });
  }

  function identify() {
    socket?.sendJson({
      op: 2,
      d: {
        token: config.botToken,
        intents: discordGatewayIntents(config),
        properties: {
          os: process.platform,
          browser: "second",
          device: "second",
        },
      },
    });
  }

  function startHeartbeat(interval) {
    clearHeartbeat();
    heartbeatTimer = setInterval(() => {
      try {
        socket?.sendJson({ op: 1, d: sequence });
      } catch {
        socket?.close();
      }
    }, interval);
  }

  function clearHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, DISCORD_RECONNECT_MAX_MS);
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
      clearHeartbeat();
      if (socket) socket.close();
    },
  };
}

function discordGatewayIntents(config = {}) {
  const base = 1 | 512 | 4096;
  return config.messageContentIntent ? base | 32768 : base;
}

function classifyGatewayClose(info = {}) {
  const code = Number(info.code);
  const known = DISCORD_CLOSE_REASONS[code];
  if (known) return known;
  const suffix = code ? ` code=${code}${info.reason ? ` reason=${info.reason}` : ""}` : "";
  return {
    type: "gateway.close",
    text: `discord.gateway.close${suffix}`,
    retry: true,
  };
}

function shouldHandleGatewayEvent(event = {}, botUserId, options = {}) {
  if (event.author?.bot || event.webhook_id) return false;
  if (!event.guild_id) return true;
  const mentionsBot = Boolean(botUserId && (event.mentions || []).some((item) => item.id === botUserId));
  if (mentionsBot) return true;
  return Boolean(options.isKnownThread?.({ channel: event.channel_id, thread_ts: event.channel_id }));
}

function discordEventToMessage(event = {}, fallback = {}) {
  const author = event.author || event.member?.user || fallback.author || {};
  return {
    text: cleanDiscordText(event.content || fallback.content || fallback.text || "", fallback.botUserId),
    channel: event.channel_id || event.channelId || fallback.channel_id || fallback.channel,
    channelName: event.channel_name || fallback.channelName || "",
    threadTs: event.thread_id || event.threadId || event.channel_id || event.channelId || fallback.channel,
    messageId: event.id || event.message_id || fallback.messageId,
    user: author.id || event.user_id || fallback.user,
    userName: author.username || author.global_name || fallback.userName,
    team: event.guild_id || event.guildId || fallback.guildId,
    eventTs: event.timestamp || fallback.timestamp,
  };
}

function cleanDiscordText(text, botUserId) {
  let value = String(text || "");
  if (botUserId) value = value.replace(new RegExp(`<@!?${botUserId}>`, "g"), "");
  return value.trim();
}

async function sendText({ external = {}, text, config = {} }) {
  const token = config.botToken;
  const channel = external.threadTs || external.channel;
  if (!token) return { ok: false, skipped: true, reason: "DISCORD_BOT_TOKEN is not set" };
  if (!channel) return { ok: false, skipped: true, reason: "Discord channel is missing" };
  const result = await postJson(
    `https://discord.com/api/v10/channels/${encodeURIComponent(channel)}/messages`,
    { content: String(text || "").slice(0, 1900) },
    { headers: { Authorization: `Bot ${token}` } },
  );
  return annotateDiscordSendResult(result);
}

function annotateDiscordSendResult(result = {}) {
  if (result.ok !== false) return result;
  const code = Number(result.response?.code);
  const message = String(result.response?.message || result.error || "").trim();
  const hint = discordSendErrorHint({ code, message, statusCode: result.statusCode });
  if (!hint) return result;
  return {
    ...result,
    error: `${message || "Discord 发送失败"}: ${hint}`,
    hint,
  };
}

function discordSendErrorHint({ code, message = "", statusCode } = {}) {
  const lower = String(message || "").toLowerCase();
  if (code === 50001 || lower.includes("missing access")) {
    return "Bot 无法访问测试频道。请确认 Bot 已加入该服务器,测试频道 ID 正确,并在频道权限里允许 View Channel 和 Send Messages。私有频道需要把 Bot 或它的角色加入频道。";
  }
  if (code === 50013 || lower.includes("missing permissions")) {
    return "Bot 在该频道缺少发送权限。请允许 Send Messages;如果目标是 thread,还需要 Send Messages in Threads。";
  }
  if (statusCode === 401 || (code === 0 && lower.includes("unauthorized"))) {
    return "Bot token 无效或已重置,请在 Discord Developer Portal 重新复制 Bot Token 后保存。";
  }
  if (statusCode === 404 || lower.includes("unknown channel")) {
    return "频道 ID 不存在,或 Bot 对这个频道不可见。请开启开发者模式后右键复制文本频道或 thread ID。";
  }
  return "";
}

const adapter = createMessagePlatformAdapter({
  id: DISCORD_CHANNEL_ID,
  name: "Discord",
  httpPrefix: "/discord/",
  description: "Discord gateway/webhook task intake and Bot API result replies.",
  chunkSize: 1800,
  config: discordConfig,
  supports: { gateway: true },
  configured: (config) => Boolean(config.botToken),
  meta: (config) => config.botToken ? "Bot token 已配置 · webhook 入口 /discord/webhook" : "缺少 DISCORD_BOT_TOKEN · webhook 入口 /discord/webhook",
  parseIncoming,
  sendText,
  startTransport,
});

adapter.discordGatewayIntents = discordGatewayIntents;
adapter.classifyGatewayClose = classifyGatewayClose;
adapter.annotateDiscordSendResult = annotateDiscordSendResult;
adapter.discordSendErrorHint = discordSendErrorHint;

module.exports = adapter;
