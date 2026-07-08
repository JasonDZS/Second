"use strict";

const { appendEvent, loadState, makeId, nowIso, saveState } = require("../state");

const ASSISTANT_CHANNEL_ID = "assistant";
const ASSISTANT_NAME = "对话助手";
const PRODUCT_NAME = "Second";
const DEFAULT_CONVERSATION_ID = "local-assistant";
const MAX_MESSAGE_LENGTH = 12000;
const MAX_RESULT_LENGTH = 24000;
const MAX_STORED_MESSAGES = 200;

async function receiveHttp({ req, url, rawBody, profile }) {
  if (req.method !== "POST") return response(405, { error: "Method not allowed" });
  if (normalizePathname(url.pathname) !== "/assistant/messages") {
    return response(404, { error: "Assistant endpoint not found" });
  }

  const body = parseJson(rawBody);
  const text = cleanMessage(body.text || body.message || body.prompt, MAX_MESSAGE_LENGTH);
  if (!text) return response(400, { error: "Message is required" });

  const messageId = makeId("AM");
  const conversationId = cleanConversationId(body.conversationId);
  const createdAt = nowIso();
  const external = {
    channel: ASSISTANT_CHANNEL_ID,
    threadTs: conversationId,
    conversationId,
    messageId,
    user: body.user || profile?.name || "local-user",
    eventTs: createdAt,
  };

  appendAssistantMessage({
    id: messageId,
    role: "user",
    actor: profile?.name || "你",
    text,
    at: createdAt,
    conversationId,
    status: "sent",
  });

  return {
    kind: "task.requested",
    channelId: ASSISTANT_CHANNEL_ID,
    taskInput: assistantMessageToTaskInput({ text, external, workspace: body.workspace }, profile),
    response: ({ task, continuation, skipped, reason, error }) => ({
      status: error ? 500 : 201,
      body: {
        ok: !error,
        channel: ASSISTANT_CHANNEL_ID,
        taskId: task?.id || null,
        continuation: continuation || null,
        skipped: Boolean(skipped),
        reason: reason || undefined,
        error: error || undefined,
      },
    }),
  };
}

function assistantMessageToTaskInput(message = {}, profile = {}) {
  const text = cleanMessage(message.text || "处理这条本地对话消息。", MAX_MESSAGE_LENGTH);
  const external = {
    channel: ASSISTANT_CHANNEL_ID,
    threadTs: DEFAULT_CONVERSATION_ID,
    conversationId: DEFAULT_CONVERSATION_ID,
    ...(message.external || {}),
  };
  const prompt = [
    `Handle this ${PRODUCT_NAME} task from the local assistant chat.`,
    `Return the answer as your final response. ${PRODUCT_NAME} daemon will show that final response in the assistant chat.`,
    "Do not use messaging connector tools or attempt to send/reply/post directly.",
    `Conversation id: ${external.conversationId || external.threadTs || DEFAULT_CONVERSATION_ID}`,
    external.user ? `Requester: ${external.user}` : "",
    "",
    text,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title: text.slice(0, 80) || "对话助手任务",
    prompt,
    messageText: text,
    source: ASSISTANT_NAME,
    run: true,
    workspace: message.workspace,
    channel: {
      id: ASSISTANT_CHANNEL_ID,
      name: ASSISTANT_NAME,
      external,
    },
    agent: profile?.agentName,
    sourceMessage: {
      type: ASSISTANT_CHANNEL_ID,
      label: ASSISTANT_NAME,
      actor: profile?.name || "你",
      text,
      createdAt: external.eventTs || nowIso(),
      external,
    },
  };
}

async function sendTaskAccepted(task) {
  updateAssistantMessage(task?.channel?.external?.messageId, {
    taskId: task?.id || null,
    status: "accepted",
  });
  return { ok: true, skipped: true, reason: "Assistant accepts are rendered from task state" };
}

async function sendTaskResult(task, { success = true, finalText = "", phase = "run" } = {}) {
  const external = task?.lastResumeRequest?.external || task?.channel?.external || {};
  const conversationId = external.conversationId || external.threadTs || DEFAULT_CONVERSATION_ID;
  const text = cleanMessage(finalText || task?.summary || "", MAX_RESULT_LENGTH) || (success ? "任务已完成。" : "任务失败。");
  appendAssistantMessage({
    id: makeId("AM"),
    role: "assistant",
    actor: task?.agent || PRODUCT_NAME,
    text,
    at: nowIso(),
    conversationId,
    taskId: task?.id || null,
    inReplyTo: external.messageId || task?.channel?.external?.messageId || null,
    status: success ? "done" : "failed",
    phase,
  });
  return { ok: true, chunks: 1 };
}

async function sendDecisionRequested() {
  return { ok: false, skipped: true, reason: "Decision events are managed in Second only" };
}

async function sendDecisionResolved() {
  return { ok: false, skipped: true, reason: "Decision resolution is managed in Second only" };
}

function appendAssistantMessage(message) {
  const state = loadState();
  state.assistant = normalizeAssistantState(state.assistant);
  state.assistant.messages.push(message);
  state.assistant.messages = state.assistant.messages.slice(-MAX_STORED_MESSAGES);
  appendEvent(state, {
    type: `channel.${ASSISTANT_CHANNEL_ID}.${message.role === "user" ? "message_received" : "result_recorded"}`,
    text: `channel.${ASSISTANT_CHANNEL_ID}.${message.role === "user" ? "message_received" : "result_recorded"} ${message.id}`,
    taskId: message.taskId || undefined,
    channelId: ASSISTANT_CHANNEL_ID,
  });
  saveState(state);
  return message;
}

function updateAssistantMessage(messageId, patch = {}) {
  if (!messageId) return null;
  const state = loadState();
  state.assistant = normalizeAssistantState(state.assistant);
  const message = state.assistant.messages.find((item) => item.id === messageId);
  if (!message) return null;
  Object.assign(message, patch);
  saveState(state);
  return message;
}

function normalizeAssistantState(value = {}) {
  return {
    activeConversationId: value.activeConversationId || DEFAULT_CONVERSATION_ID,
    messages: Array.isArray(value.messages) ? value.messages : [],
  };
}

function cleanMessage(value, limit) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, limit);
}

function cleanConversationId(value) {
  const text = String(value || DEFAULT_CONVERSATION_ID).trim();
  if (!text) return DEFAULT_CONVERSATION_ID;
  return text.replace(/[^\w:.-]/g, "-").slice(0, 80) || DEFAULT_CONVERSATION_ID;
}

function parseJson(rawBody) {
  try {
    return JSON.parse(rawBody || "{}");
  } catch {
    return {};
  }
}

function normalizePathname(pathname) {
  return String(pathname || "/").replace(/\/{2,}/g, "/");
}

function response(status, body) {
  return {
    kind: "response",
    response: { status, body },
  };
}

module.exports = {
  ASSISTANT_CHANNEL_ID,
  DEFAULT_CONVERSATION_ID,
  appendAssistantMessage,
  assistantMessageToTaskInput,
  id: ASSISTANT_CHANNEL_ID,
  name: ASSISTANT_NAME,
  kind: "local-adapter",
  status: "implemented",
  description: "Local floating assistant chat intake and daemon-delivered result replies.",
  httpPrefix: "/assistant/",
  supports: {
    taskIntake: true,
    decisionButtons: false,
    resultReply: true,
    socketMode: false,
  },
  receiveHttp,
  sendDecisionRequested,
  sendDecisionResolved,
  sendTaskAccepted,
  sendTaskResult,
};
