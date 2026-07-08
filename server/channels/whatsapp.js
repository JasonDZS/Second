"use strict";

const { createMessagePlatformAdapter, postJson, response } = require("./platform-message");
const { getChannelConfig } = require("../channel-config");

const WHATSAPP_CHANNEL_ID = "whatsapp";

function whatsappConfig() {
  return getChannelConfig(WHATSAPP_CHANNEL_ID);
}

function parseIncoming({ req, url, pathname, body, config }) {
  if (pathname !== "/whatsapp/webhook") return { kind: "response", status: 404, body: { error: "WhatsApp endpoint not found" } };
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (mode === "subscribe" && (!config.verifyToken || token === config.verifyToken)) {
      return response(200, {}, { rawBody: challenge, contentType: "text/plain; charset=utf-8" });
    }
    return { kind: "response", status: 403, body: { error: "Invalid WhatsApp verify token" } };
  }
  if (req.method !== "POST") return { kind: "response", status: 405, body: { error: "Method not allowed" } };

  const value = body.entry?.[0]?.changes?.[0]?.value || body.value || body;
  const message = value.messages?.[0] || body.message || {};
  const contact = value.contacts?.[0] || {};
  const text =
    message.text?.body ||
    message.button?.text ||
    message.interactive?.button_reply?.title ||
    message.interactive?.list_reply?.title ||
    body.text ||
    "";
  const from = message.from || contact.wa_id || body.from || body.user || "";
  return {
    text,
    channel: from,
    channelLabel: contact.profile?.name || from,
    threadTs: message.context?.id || from,
    messageId: message.id || body.messageId || "",
    user: from,
    userName: contact.profile?.name || from,
    eventTs: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : "",
    external: {
      phoneNumberId: value.metadata?.phone_number_id || config.phoneNumberId || "",
    },
  };
}

async function sendText({ external = {}, text, config = {} }) {
  const token = config.accessToken;
  const phoneNumberId = external.phoneNumberId || config.phoneNumberId;
  const to = external.user || external.channel;
  if (!token) return { ok: false, skipped: true, reason: "WHATSAPP_ACCESS_TOKEN is not set" };
  if (!phoneNumberId) return { ok: false, skipped: true, reason: "WHATSAPP_PHONE_NUMBER_ID is not set" };
  if (!to) return { ok: false, skipped: true, reason: "WhatsApp recipient is missing" };
  return postJson(
    `https://graph.facebook.com/v19.0/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: String(text || "").slice(0, 3900), preview_url: false },
    },
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

module.exports = createMessagePlatformAdapter({
  id: WHATSAPP_CHANNEL_ID,
  name: "WhatsApp",
  httpPrefix: "/whatsapp/",
  description: "WhatsApp Cloud API webhook task intake and Graph API result replies.",
  chunkSize: 3600,
  config: whatsappConfig,
  configured: (config) => Boolean(config.accessToken && config.phoneNumberId),
  meta: (config) => config.accessToken && config.phoneNumberId ? "Cloud API 已配置 · webhook 入口 /whatsapp/webhook" : "缺少 WhatsApp Cloud API token 或 phone number id",
  parseIncoming,
  sendText,
});
