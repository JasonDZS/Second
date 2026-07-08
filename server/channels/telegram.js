"use strict";

const { createMessagePlatformAdapter, postJson, unixSecondsToIso } = require("./platform-message");
const { getChannelConfig } = require("../channel-config");

const TELEGRAM_CHANNEL_ID = "telegram";

function telegramConfig() {
  return getChannelConfig(TELEGRAM_CHANNEL_ID);
}

function parseIncoming({ req, pathname, body, config }) {
  if (req.method !== "POST") return { kind: "response", status: 405, body: { error: "Method not allowed" } };
  if (pathname !== "/telegram/webhook") return { kind: "response", status: 404, body: { error: "Telegram endpoint not found" } };
  if (config.webhookSecret && req.headers["x-telegram-bot-api-secret-token"] !== config.webhookSecret) {
    return { kind: "response", status: 401, body: { error: "Invalid Telegram webhook secret" } };
  }

  const message = body.message || body.edited_message || body.channel_post || body.edited_channel_post || {};
  const chat = message.chat || {};
  const from = message.from || {};
  const text = message.text || message.caption || "";
  return {
    text,
    channel: chat.id != null ? String(chat.id) : "",
    channelName: chat.title || chat.username || chat.first_name || "",
    channelLabel: chat.title || (chat.username ? `@${chat.username}` : chat.id != null ? String(chat.id) : ""),
    threadTs: message.message_thread_id != null ? String(message.message_thread_id) : chat.id != null ? String(chat.id) : "",
    messageId: message.message_id != null ? String(message.message_id) : "",
    user: from.id != null ? String(from.id) : "",
    userName: from.username || [from.first_name, from.last_name].filter(Boolean).join(" "),
    eventTs: message.date ? unixSecondsToIso(message.date) : "",
    external: {
      chatType: chat.type || "",
    },
  };
}

async function sendText({ external = {}, text, config = {} }) {
  if (!config.botToken) return { ok: false, skipped: true, reason: "TELEGRAM_BOT_TOKEN is not set" };
  if (!external.channel) return { ok: false, skipped: true, reason: "Telegram chat id is missing" };
  const payload = {
    chat_id: external.channel,
    text: String(text || "").slice(0, 4096),
    disable_web_page_preview: true,
  };
  if (external.messageId) payload.reply_to_message_id = Number(external.messageId);
  if (external.threadTs && external.threadTs !== external.channel) payload.message_thread_id = Number(external.threadTs);
  return postJson(`https://api.telegram.org/bot${config.botToken}/sendMessage`, payload);
}

module.exports = createMessagePlatformAdapter({
  id: TELEGRAM_CHANNEL_ID,
  name: "Telegram",
  httpPrefix: "/telegram/",
  description: "Telegram Bot API webhook task intake and sendMessage result replies.",
  chunkSize: 3900,
  config: telegramConfig,
  configured: (config) => Boolean(config.botToken),
  meta: (config) => config.botToken ? "Bot token 已配置 · webhook 入口 /telegram/webhook" : "缺少 TELEGRAM_BOT_TOKEN · webhook 入口 /telegram/webhook",
  parseIncoming,
  sendText,
});
