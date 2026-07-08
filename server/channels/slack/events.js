"use strict";

const crypto = require("crypto");
const { URLSearchParams } = require("url");
const { getSlackConfig } = require("../../slack-config");
const { cleanSlackText } = require("./text");
const { slackApi } = require("./web-api");

const SLACK_CHANNEL_ID = "slack";
const PRODUCT_NAME = "Second";
const channelInfoCache = new Map();

async function receiveHttp({ req, url, rawBody, profile, isKnownThread }) {
  if (req.method !== "POST") return response(405, { error: "Method not allowed" });
  if (!verifySlackSignature(req, rawBody)) return response(401, { error: "Invalid Slack signature" });

  const body = parseSlackBody(req, rawBody);
  const pathname = normalizePathname(url.pathname);

  if (pathname === "/slack/events") return receiveEventCallback(body, profile, isKnownThread);
  if (pathname === "/slack/interactive") return receiveInteractive(body);
  return response(404, { error: "Slack endpoint not found" });
}

async function receiveSocketEnvelope(envelope, { profile, isKnownThread } = {}) {
  const payload = envelope.payload || {};
  if (envelope.type === "events_api" && payload.type === "event_callback") {
    return receiveTaskEvent(payload.event || {}, profile, isKnownThread);
  }

  if (envelope.type === "interactive" || payload.type === "block_actions") {
    return receiveInteractive(payload, { includeHttpResponse: false });
  }

  return response(200, { ok: true });
}

async function receiveEventCallback(body, profile, isKnownThread) {
  if (body.type === "url_verification") return response(200, { challenge: body.challenge });
  if (body.type !== "event_callback") return response(200, { ok: true });
  return receiveTaskEvent(body.event || {}, profile, isKnownThread, {
    response: ({ task, skipped, reason }) => ({
      status: 200,
      body: {
        ok: true,
        ignored: Boolean(skipped),
        reason: reason || undefined,
        taskId: task?.id || null,
        channel: SLACK_CHANNEL_ID,
      },
    }),
  });
}

async function receiveTaskEvent(event, profile, isKnownThread, extra = {}) {
  const addressing = shouldHandleEvent(event, { isKnownThread });
  if (!addressing.ok) return response(200, { ok: true, ignored: true, reason: addressing.reason });
  return {
    kind: "task.requested",
    channelId: SLACK_CHANNEL_ID,
    taskInput: await enrichSlackTaskInput(slackEventToTaskInput(event, profile), event),
    ...extra,
  };
}

function receiveInteractive(body, options = {}) {
  const action = body.actions?.[0] || {};
  const value = parseActionValue(action.value);
  if (!value.decisionId) return response(200, { ok: true });
  return {
    kind: "decision.resolved",
    channelId: SLACK_CHANNEL_ID,
    decisionId: value.decisionId,
    verdict: value.verdict === "rejected" ? "rejected" : "approved",
    optionId: value.optionId || null,
    actor: body.user?.id || null,
    ...(options.includeHttpResponse === false
      ? {}
      : {
          response: ({ result }) => ({
            status: 200,
            body: {
              response_type: "ephemeral",
              text: `${PRODUCT_NAME} 决策已${result.decision.status === "approved" ? "批准" : "拒绝"}: ${result.decision.id}`,
            },
          }),
        }),
  };
}

function shouldHandleEvent(event, { isKnownThread } = {}) {
  if (event.bot_id || event.subtype === "bot_message") return { ok: false, reason: "bot_message" };
  if (!["app_mention", "message"].includes(event.type)) return { ok: false, reason: `unsupported_event:${event.type || "unknown"}` };
  if (!isAllowedEvent(event)) return { ok: false, reason: "allowlist" };
  if (event.type === "app_mention") return { ok: true };
  if (isDirectMessage(event)) return { ok: true };
  if (event.thread_ts && hasUserMention(event.text)) return { ok: false, reason: "message_with_mention_waiting_for_app_mention" };
  if (event.thread_ts && isKnownThread?.(event)) return { ok: true };
  return { ok: false, reason: "message_not_addressed" };
}

function isDirectMessage(event) {
  return event.channel_type === "im" || String(event.channel || "").startsWith("D");
}

function hasUserMention(text) {
  return /<@[A-Z0-9]+>/.test(String(text || ""));
}

function isAllowedEvent(event) {
  const config = getSlackConfig();
  const users = csv(config.allowedUsers);
  const channels = csv(config.allowedChannels);
  if (users.length && !users.includes(event.user)) return false;
  if (channels.length && !channels.includes(event.channel)) return false;
  return true;
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSlackBody(req, rawBody) {
  const contentType = String(req.headers["content-type"] || "");
  if (contentType.includes("application/json")) return JSON.parse(rawBody || "{}");
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(rawBody);
    if (params.has("payload")) return JSON.parse(params.get("payload"));
    return Object.fromEntries(params.entries());
  }
  return {};
}

function verifySlackSignature(req, rawBody) {
  const secret = getSlackConfig().signingSecret;
  if (!secret) return true;
  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${crypto.createHmac("sha256", secret).update(base).digest("hex")}`;
  return timingSafeEqual(expected, signature);
}

function slackEventToTaskInput(event, profile) {
  const text = cleanSlackText(event.text || "");
  const external = {
    channel: event.channel || null,
    channelName: event.channel_name || event.channelName || null,
    threadTs: event.thread_ts || event.ts || null,
    user: event.user || null,
    team: event.team || null,
    eventTs: event.ts || null,
  };
  const prompt = [
    `Handle this ${PRODUCT_NAME} task from an external chat message.`,
    `Return the answer as your final response. ${PRODUCT_NAME} daemon will post that final response back to the source chat.`,
    "Do not use messaging connector tools or attempt to send/reply/post directly.",
    `Source channel id: ${event.channel || "unknown"}`,
    external.threadTs ? `Thread: ${external.threadTs}` : "",
    event.user ? `Requester: ${event.user}` : "",
    "",
    text || event.text || "Handle the Slack request.",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    title: text.slice(0, 80) || "Slack task",
    prompt,
    messageText: text || event.text || "Handle the Slack request.",
    source: `Slack ${event.channel || ""}`.trim(),
    run: true,
    channel: {
      id: SLACK_CHANNEL_ID,
      name: "Slack",
      external,
    },
    slack: external,
    agent: profile?.agentName,
  };
}

async function enrichSlackTaskInput(input, event = {}) {
  const channelId = event.channel || input?.channel?.external?.channel;
  if (!input || !channelId) return input;
  const info = await resolveChannelInfo(channelId);
  if (!info?.name) return input;
  input.channel.external.channelName = info.name;
  input.channel.external.channelLabel = info.label || `#${info.name}`;
  input.source = `Slack ${info.label || `#${info.name}`}`;
  return input;
}

async function resolveChannelInfo(channelId) {
  const id = String(channelId || "").trim();
  if (!id) return null;
  if (channelInfoCache.has(id)) return channelInfoCache.get(id);
  const fallback = { id, name: "", label: id };
  try {
    const result = await slackApi("conversations.info", { channel: id, include_locale: false });
    if (result?.ok === false) return fallback;
    const channel = result?.channel || {};
    const name = channel.name || channel.name_normalized || "";
    const label = name ? `#${name}` : id;
    const info = { id, name, label };
    if (name) channelInfoCache.set(id, info);
    return info;
  } catch {
    return fallback;
  }
}

function normalizePathname(pathname) {
  return String(pathname || "/").replace(/\/{2,}/g, "/");
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseActionValue(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function response(status, body) {
  return {
    kind: "response",
    response: { status, body },
  };
}

module.exports = {
  enrichSlackTaskInput,
  parseActionValue,
  parseSlackBody,
  receiveHttp,
  receiveSocketEnvelope,
  resolveChannelInfo,
  response,
  shouldHandleEvent,
  slackEventToTaskInput,
  verifySlackSignature,
};
