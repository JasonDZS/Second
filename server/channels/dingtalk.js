"use strict";

const { createMessagePlatformAdapter, millisecondsToIso, postJson, signedDingTalkWebhook } = require("./platform-message");
const { getChannelConfig } = require("../channel-config");

const DINGTALK_CHANNEL_ID = "dingding";

function dingtalkConfig() {
  return getChannelConfig(DINGTALK_CHANNEL_ID);
}

function parseIncoming({ req, pathname, body }) {
  if (req.method !== "POST") return { kind: "response", status: 405, body: { error: "Method not allowed" } };
  if (pathname !== "/dingtalk/webhook" && pathname !== "/dingding/webhook") {
    return { kind: "response", status: 404, body: { error: "DingTalk endpoint not found" } };
  }
  const text = body.text?.content || body.content || body.message || "";
  const conversationId = body.conversationId || body.conversation_id || body.openConversationId || "";
  return {
    text,
    channel: conversationId,
    channelName: body.conversationTitle || "",
    channelLabel: body.conversationTitle || conversationId,
    threadTs: conversationId,
    messageId: body.msgId || body.messageId || "",
    user: body.senderStaffId || body.senderId || body.senderNick || "",
    userName: body.senderNick || body.senderName || "",
    team: body.senderCorpId || body.corpId || "",
    eventTs: body.createAt ? millisecondsToIso(body.createAt) : "",
  };
}

async function sendText({ text, config = {} }) {
  if (!config.webhookUrl) return { ok: false, skipped: true, reason: "DINGTALK_WEBHOOK_URL is not set" };
  return postJson(
    signedDingTalkWebhook(config.webhookUrl, config.secret),
    {
      msgtype: "text",
      text: { content: String(text || "").slice(0, 3900) },
    },
  );
}

module.exports = createMessagePlatformAdapter({
  id: DINGTALK_CHANNEL_ID,
  name: "DingTalk",
  httpPrefix: "/dingtalk/",
  description: "DingTalk robot webhook task intake and custom robot result replies.",
  chunkSize: 3600,
  config: dingtalkConfig,
  configured: (config) => Boolean(config.webhookUrl),
  meta: (config) => config.webhookUrl ? "机器人 webhook 已配置 · webhook 入口 /dingtalk/webhook" : "缺少 DINGTALK_WEBHOOK_URL · webhook 入口 /dingtalk/webhook",
  parseIncoming,
  sendText,
});
