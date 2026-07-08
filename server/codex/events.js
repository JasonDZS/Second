"use strict";

const { appendEvent } = require("../state");
const { normalizeAgentRuntimeEvent } = require("../runtimes/codex");

const PRODUCT_NAME = "Second";

function handleCodexJsonLine(state, task, line, phase = "initial", runId = null) {
  if (!line.trim()) return;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  const type = event.type || event.event || event.kind || "codex.event";
  const sessionId = extractSessionId(event);
  if (sessionId && !task.codexSessionId) {
    task.codexSessionId = sessionId;
    task.trace.push({
      kind: "runtime",
      actor: task.agent,
      time: "实时",
      title: "可恢复会话已建立",
      description: `${PRODUCT_NAME} 已保存恢复点,后续可在 Human Gate 审核后继续执行。`,
    });
    appendEvent(state, {
      type: "codex.session",
      text: `codex.session ${task.id}`,
      taskId: task.id,
    });
  }
  const normalized = normalizeAgentRuntimeEvent("codex", event, {
    phase,
    runId,
    seq: (task.agentEvents || []).length + 1,
    taskId: task.id,
  });
  if (normalized) {
    task.agentEvents = [...(task.agentEvents || []), normalized].slice(-300);
  }
  const text = summarizeCodexEvent(event, normalized);
  if (!text) return;
  if (!normalized) {
    task.trace.push({
      kind: "runtime",
      actor: task.agent,
      time: "实时",
      title: type,
      description: text.slice(0, 500),
      agentEventId: null,
    });
    task.trace = task.trace.slice(-120);
  }
  appendEvent(state, {
    type: `codex.${type}`,
    text: text.slice(0, 240),
    taskId: task.id,
  });
}

function summarizeCodexEvent(event, normalized = null) {
  if (normalized) {
    return [normalized.title, normalized.text || normalized.detail].filter(Boolean).join(": ");
  }
  if (typeof event.message === "string") return event.message;
  if (typeof event.text === "string") return event.text;
  if (event.item?.type && event.item?.text) return `${event.item.type}: ${event.item.text}`;
  if (event.item?.type && event.item?.command) return `${event.item.type}: ${event.item.command}`;
  if (event.type) return JSON.stringify(event).slice(0, 300);
  return null;
}

function extractSessionId(event) {
  const preferred = [];
  const fallback = [];
  walkJson(event, [], (keyPath, value) => {
    if (typeof value !== "string" || !looksLikeSessionId(value)) return;
    const joined = keyPath.join(".").toLowerCase();
    const leaf = keyPath[keyPath.length - 1]?.toLowerCase() || "";
    if (/session|conversation|thread/.test(joined) && /id$|_id$/.test(leaf)) {
      preferred.push(value);
      return;
    }
    if (leaf === "id" && /session|conversation|thread/.test(String(event.type || event.event || "").toLowerCase())) {
      preferred.push(value);
      return;
    }
    fallback.push(value);
  });
  return preferred[0] || fallback[0] || null;
}

function walkJson(value, pathParts, visit) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    visit(childPath, child);
    if (child && typeof child === "object") walkJson(child, childPath, visit);
  }
}

function looksLikeSessionId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

module.exports = {
  extractSessionId,
  handleCodexJsonLine,
  looksLikeSessionId,
  summarizeCodexEvent,
};
