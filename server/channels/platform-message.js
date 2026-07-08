"use strict";

const crypto = require("crypto");
const https = require("https");
const { URL } = require("url");

const PRODUCT_NAME = "Second";

function createMessagePlatformAdapter(spec = {}) {
  const id = spec.id;
  const name = spec.name || id;
  const httpPrefix = spec.httpPrefix || `/${id}/`;
  const config = spec.config || (() => ({}));

  async function receiveHttp(ctx = {}) {
    const effectiveConfig = ctx.config || config();
    const parsed = await spec.parseIncoming?.({
      ...ctx,
      body: parseJson(ctx.rawBody),
      pathname: normalizePathname(ctx.url?.pathname),
      config: effectiveConfig,
    });
    if (!parsed || parsed.ignored) {
      return response(200, {
        ok: true,
        ignored: true,
        reason: parsed?.reason || "ignored",
        channel: id,
      });
    }
    if (parsed.kind === "response") {
      const nested = parsed.response || parsed;
      return response(nested.status || parsed.status || 200, nested.body || parsed.body || { ok: true }, {
        ...parsed,
        ...nested,
      });
    }

    const message = normalizeMessage(parsed);
    if (!message.text) return response(200, { ok: true, ignored: true, reason: "empty_message", channel: id });
    const allow = allowedMessage(message, effectiveConfig);
    if (!allow.ok) return response(200, { ok: true, ignored: true, reason: allow.reason, channel: id });

    return {
      kind: "task.requested",
      channelId: id,
      taskInput: platformMessageToTaskInput({ id, name }, message, ctx.profile),
      response: parsed.response || (({ task, skipped, reason }) => ({
        status: 200,
        body: {
          ok: true,
          ignored: Boolean(skipped),
          reason: reason || undefined,
          taskId: task?.id || null,
          channel: id,
        },
      })),
    };
  }

  async function sendTaskAccepted(task) {
    return sendPlatformTaskMessage(task, `${PRODUCT_NAME} 已接住任务: ${task.title}`);
  }

  async function sendTaskResult(task, { success = true, finalText = "" } = {}) {
    const status = success ? "完成" : "失败";
    const body = String(finalText || task.summary || "").trim();
    const header = `${PRODUCT_NAME} 任务${status}: ${task.title}`;
    const chunks = chunkMessage(body || task.summary || "", spec.chunkSize || 3500);
    if (!chunks.length) chunks.push(task.summary || "");

    const results = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const prefix = chunks.length === 1 ? header : `${header}\n(${index + 1}/${chunks.length})`;
      const result = await sendPlatformTaskMessage(task, `${prefix}\n${chunks[index]}`.trim());
      results.push(result);
      if (result.ok === false) return { ok: false, chunk: index + 1, results, error: result.error || result.reason };
    }
    return { ok: true, chunks: chunks.length, results };
  }

  async function sendTestMessage({ channel, text } = {}) {
    const external = { channel, threadTs: channel };
    return spec.sendText?.({ external, text: text || `${PRODUCT_NAME} ${name} 连接测试: 本地 daemon 可以发送消息。`, config: config() }) ||
      skipped(`No ${name} sender is configured`);
  }

  async function sendPlatformTaskMessage(task, text) {
    const external = task?.lastResumeRequest?.external || task?.channel?.external || task?.slack || {};
    return spec.sendText?.({ task, external, text, config: config() }) || skipped(`No ${name} sender is configured`);
  }

  return {
    id,
    name,
    kind: "http-adapter",
    status: "implemented",
    description: spec.description || `${name} webhook task intake and daemon-delivered replies.`,
    httpPrefix,
    supports: {
      taskIntake: true,
      decisionButtons: false,
      resultReply: true,
      socketMode: false,
      ...(spec.supports || {}),
    },
    configured: () => Boolean(spec.configured ? spec.configured(config()) : false),
    meta: () => spec.meta?.(config()) || `${name} webhook · 结果回传到原会话`,
    receiveHttp,
    sendDecisionRequested: async () => skipped("Decision events are managed in Second only"),
    sendDecisionResolved: async () => skipped("Decision resolution is managed in Second only"),
    sendTaskAccepted,
    sendTaskResult,
    sendTestMessage,
    startTransport: spec.startTransport,
    platformMessageToTaskInput: (message, profile) => platformMessageToTaskInput({ id, name }, message, profile),
  };
}

function platformMessageToTaskInput(adapter, message = {}, profile = {}) {
  const text = cleanMessageText(message.text) || `Handle the ${adapter.name} request.`;
  const external = {
    channel: message.channel || null,
    channelName: message.channelName || null,
    channelLabel: message.channelLabel || null,
    threadTs: message.threadTs || message.messageId || message.channel || null,
    messageId: message.messageId || null,
    user: message.user || null,
    userName: message.userName || null,
    team: message.team || null,
    eventTs: message.eventTs || null,
    ...(message.external || {}),
  };
  const prompt = [
    `Handle this ${PRODUCT_NAME} task from an external ${adapter.name} message.`,
    `Return the answer as your final response. ${PRODUCT_NAME} daemon will post that final response back to the source conversation.`,
    "Do not use messaging connector tools or attempt to send/reply/post directly.",
    `${adapter.name} channel: ${external.channel || "unknown"}`,
    external.threadTs ? `${adapter.name} conversation: ${external.threadTs}` : "",
    external.user ? `Requester: ${external.user}` : "",
    "",
    text,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    title: text.slice(0, 80) || `${adapter.name} task`,
    prompt,
    messageText: text,
    source: `${adapter.name} ${message.channelLabel || message.channelName || message.channel || ""}`.trim(),
    run: true,
    channel: {
      id: adapter.id,
      name: adapter.name,
      external,
    },
    agent: profile?.agentName,
    sourceMessage: {
      type: adapter.id,
      label: adapter.name,
      actor: message.userName || message.user || adapter.name,
      text,
      createdAt: external.eventTs || new Date().toISOString(),
      external,
    },
  };
}

function allowedMessage(message = {}, config = {}) {
  const allowedUsers = csv(config.allowedUsers);
  const allowedChannels = csv(config.allowedChannels);
  if (allowedUsers.length && !allowedUsers.includes(String(message.user || ""))) return { ok: false, reason: "allowlist" };
  if (allowedChannels.length && !allowedChannels.includes(String(message.channel || ""))) return { ok: false, reason: "allowlist" };
  return { ok: true };
}

function normalizeMessage(value = {}) {
  return {
    ...value,
    text: cleanMessageText(value.text || value.message || value.content),
  };
}

function parseJson(rawBody) {
  try {
    return JSON.parse(rawBody || "{}");
  } catch {
    return {};
  }
}

function cleanMessageText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, 12000);
}

function chunkMessage(text, maxLength = 3500) {
  const source = String(text || "");
  if (!source) return [];
  const chunks = [];
  let rest = source;
  while (rest.length > maxLength) {
    const slice = rest.slice(0, maxLength);
    const cut = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    const end = cut > maxLength * 0.5 ? cut : maxLength;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function postJson(url, payload, options = {}) {
  const target = new URL(url);
  const body = JSON.stringify(payload || {});
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        method: options.method || "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
          ...(options.headers || {}),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          const parsed = parseJson(text);
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300 && parsed.ok !== false,
            statusCode: res.statusCode,
            response: parsed,
            error: parsed.error || parsed.errmsg || parsed.message || (res.statusCode >= 400 ? `HTTP ${res.statusCode}` : undefined),
          });
        });
      },
    );
    req.setTimeout(options.timeout || 5000, () => req.destroy(new Error(`${target.hostname} request timed out`)));
    req.on("error", reject);
    req.end(body);
  });
}

function signedDingTalkWebhook(webhookUrl, secret) {
  if (!webhookUrl || !secret) return webhookUrl;
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = encodeURIComponent(crypto.createHmac("sha256", secret).update(stringToSign).digest("base64"));
  const separator = webhookUrl.includes("?") ? "&" : "?";
  return `${webhookUrl}${separator}timestamp=${timestamp}&sign=${sign}`;
}

function response(status, body, extra = {}) {
  return {
    kind: "response",
    response: {
      status,
      body,
      rawBody: extra.rawBody,
      contentType: extra.contentType,
    },
  };
}

function skipped(reason) {
  return Promise.resolve({ ok: false, skipped: true, reason });
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePathname(pathname) {
  return String(pathname || "/").replace(/\/{2,}/g, "/");
}

function unixSecondsToIso(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return new Date(numeric * 1000).toISOString();
}

function millisecondsToIso(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return new Date(numeric).toISOString();
}

module.exports = {
  cleanMessageText,
  createMessagePlatformAdapter,
  millisecondsToIso,
  platformMessageToTaskInput,
  postJson,
  response,
  signedDingTalkWebhook,
  unixSecondsToIso,
};
