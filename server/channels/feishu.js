"use strict";

const { createMessagePlatformAdapter, millisecondsToIso, postJson } = require("./platform-message");
const { getChannelConfig } = require("../channel-config");

const FEISHU_CHANNEL_ID = "feishu";

function feishuConfig() {
  return getChannelConfig(FEISHU_CHANNEL_ID);
}

function parseIncoming({ req, pathname, body }) {
  if (req.method !== "POST") return { kind: "response", status: 405, body: { error: "Method not allowed" } };
  if (pathname !== "/feishu/webhook") return { kind: "response", status: 404, body: { error: "Feishu endpoint not found" } };
  if (body.type === "url_verification" && body.challenge) {
    return { kind: "response", status: 200, body: { challenge: body.challenge } };
  }

  const event = body.event || body;
  const message = event.message || {};
  const sender = event.sender?.sender_id || event.sender || {};
  const content = parseContent(message.content);
  const text = content.text || content.title || body.text || "";
  return {
    text,
    channel: message.chat_id || event.chat_id || "",
    channelName: message.chat_type || "",
    channelLabel: message.chat_id || event.chat_id || "",
    threadTs: message.root_id || message.parent_id || message.message_id || message.chat_id || event.chat_id || "",
    messageId: message.message_id || "",
    user: sender.user_id || sender.open_id || sender.union_id || "",
    userName: event.sender?.sender_type || "",
    eventTs: message.create_time ? millisecondsToIso(message.create_time) : "",
  };
}

async function sendText({ text, config = {} }) {
  if (!config.webhookUrl) return { ok: false, skipped: true, reason: "FEISHU_WEBHOOK_URL is not set" };
  return postJson(config.webhookUrl, {
    msg_type: "text",
    content: { text: String(text || "").slice(0, 3900) },
  });
}

function parseContent(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return { text: String(value || "") };
  }
}

module.exports = createMessagePlatformAdapter({
  id: FEISHU_CHANNEL_ID,
  name: "Feishu",
  httpPrefix: "/feishu/",
  description: "Feishu/Lark event webhook task intake and bot webhook result replies.",
  chunkSize: 3600,
  config: feishuConfig,
  configured: (config) => Boolean(config.webhookUrl),
  meta: (config) => config.webhookUrl ? "机器人 webhook 已配置 · webhook 入口 /feishu/webhook" : "缺少 FEISHU_WEBHOOK_URL · webhook 入口 /feishu/webhook",
  parseIncoming,
  sendText,
});
