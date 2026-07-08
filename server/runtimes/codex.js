"use strict";

const fs = require("fs");
const path = require("path");
const { nowIso } = require("../state");
const { buildInitialPrompt, buildResumePrompt } = require("../codex/prompts");
const { codexEnv, codexNetworkArgs, prepareCodexRuntimeFiles } = require("../codex/runtime-files");

const codexRuntimeAdapter = {
  id: "codex",
  engineId: "codex",
  eventPrefix: "codex",
  name: "Codex CLI",
  command: "codex",
  sessionIdField: "codexSessionId",
  sessionLabel: "Codex session",
  versionArgs: ["--version"],
  status: "available",
  normalizeEvent(raw, context = {}) {
    return normalizeAgentRuntimeEvent("codex", raw, context);
  },
  prepareRun: prepareCodexRunInvocation,
  prepareResume: prepareCodexResumeInvocation,
};

function prepareCodexRunInvocation(task, state = {}) {
  fs.mkdirSync(task.workspace, { recursive: true });
  prepareCodexRuntimeFiles(task, state);
  const prompt = buildInitialPrompt(task);
  return {
    command: "codex",
    args: [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      ...codexNetworkArgs(state),
      "-C",
      task.workspace,
      "-o",
      task.outputFile,
      prompt,
    ],
    cwd: task.workspace,
    env: codexEnv(state, task),
    outputFile: task.outputFile,
    rawLogFile: task.rawLogFile,
    phase: "initial",
  };
}

function prepareCodexResumeInvocation(task, state = {}, decision = null, options = {}) {
  const mode = options.mode === "reply" ? "reply" : options.mode === "channel" ? "channel" : "decision";
  const stamp = nowIso().replace(/[:.]/g, "-");
  const artifactsDir = task.artifactsDir || path.join(task.workspace, "artifacts");
  const outputFile = path.join(artifactsDir, `resume-${stamp}.md`);
  const rawLogFile = path.join(artifactsDir, `codex-resume-${stamp}.jsonl.log`);
  fs.mkdirSync(task.workspace, { recursive: true });
  fs.mkdirSync(artifactsDir, { recursive: true });
  prepareCodexRuntimeFiles(task, state);
  const prompt = buildResumePrompt(task, decision, options);

  return {
    command: "codex",
    args: [
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      ...codexNetworkArgs(state),
      "-o",
      outputFile,
      task.codexSessionId,
      prompt,
    ],
    cwd: task.workspace,
    env: codexEnv(state, task),
    outputFile,
    rawLogFile,
    mode,
    phase: mode === "reply" ? "reply" : mode === "channel" ? "channel" : "resume",
    runId: `${mode}-${stamp}`,
  };
}

function normalizeAgentRuntimeEvent(runtime, raw, context = {}) {
  if (runtime === "codex") return normalizeCodexJsonEvent(raw, context);
  return genericAgentEvent(runtime, raw, context);
}

function normalizeCodexJsonEvent(raw, context = {}) {
  const event = eventPayload(raw);
  const eventType = camelToSnake(event?.type || raw?.type || "");
  if (!eventType) return null;
  const base = {
    id: `${context.taskId || "task"}:${context.phase || "run"}:${context.seq || 0}`,
    seq: context.seq || 0,
    ts: nowIso(),
    runtime: "codex",
    source: "codex-jsonl",
    phase: context.phase || "run",
    runId: context.runId || "",
    rawType: eventType,
  };

  if (["thread_started", "turn_started"].includes(eventType)) {
    return {
      ...base,
      kind: "system",
      type: "system",
      title: eventType === "thread_started" ? "Thread Started" : "Turn Started",
      text: event.thread_id || event.threadId || "",
      meta: "codex",
      tone: "system",
    };
  }
  if (eventType === "turn_completed") {
    return {
      ...base,
      kind: "success",
      type: "success",
      title: "Turn Completed",
      text: usageText(event.usage),
      meta: "codex",
      tone: "assistant",
    };
  }
  if (eventType === "turn_failed") {
    return {
      ...base,
      kind: "error",
      type: "error",
      title: "Turn Failed",
      text: event.error?.message || event.message || "turn failed",
      meta: "codex",
      tone: "error",
    };
  }
  if (eventType === "error") {
    return {
      ...base,
      kind: "error",
      type: "error",
      title: "Error",
      text: event.message || event.error?.message || compactJson(event),
      meta: "codex",
      tone: "error",
    };
  }
  if (["item_started", "item_updated", "item_completed"].includes(eventType)) {
    return normalizeCodexItem(event.item, eventType, base);
  }
  if (["agent_message", "agent_message_content_delta"].includes(eventType)) {
    return {
      ...base,
      kind: "assistant",
      type: "stdout",
      title: "Codex",
      text: event.message || event.delta || event.text || "",
      meta: "assistant",
      tone: "assistant",
    };
  }
  if (["agent_reasoning", "agent_reasoning_raw_content", "reasoning_content_delta", "reasoning_raw_content_delta"].includes(eventType)) {
    return {
      ...base,
      kind: "reasoning",
      type: "stdout",
      title: "Reasoning",
      text: event.text || event.delta || "",
      meta: eventType.includes("raw") ? "raw" : "summary",
      tone: "system",
    };
  }
  if (eventType === "exec_command_begin") {
    return {
      ...base,
      kind: "command",
      type: "stdout",
      title: "Running",
      text: commandText(event.command),
      meta: event.cwd || "",
      tone: "command",
    };
  }
  if (eventType === "exec_command_output_delta") {
    const stream = camelToSnake(event.stream || "stdout").includes("stderr") ? "stderr" : "stdout";
    return {
      ...base,
      kind: "command-output",
      type: stream,
      title: stream,
      text: decodeBase64Text(event.chunk),
      meta: event.call_id || "",
      tone: stream === "stderr" ? "warning" : "output",
    };
  }
  if (eventType === "exec_command_end") {
    const output = event.aggregated_output || [event.stdout, event.stderr].filter(Boolean).join("\n");
    const failed = event.exit_code != null && event.exit_code !== 0;
    return {
      ...base,
      kind: "command",
      type: failed ? "error" : "success",
      title: failed ? "Command Failed" : "Command Completed",
      text: commandText(event.command),
      detail: output,
      meta: [event.status, event.exit_code != null ? `exit ${event.exit_code}` : "", event.duration].filter(Boolean).join(" · "),
      tone: failed ? "error" : "command",
    };
  }
  if (["mcp_tool_call_begin", "mcp_tool_call_end", "dynamic_tool_call_request", "dynamic_tool_call_response"].includes(eventType)) {
    const invocation = event.invocation || event;
    const failed = Boolean(event.result?.Err || event.error);
    return {
      ...base,
      kind: "tool",
      type: failed ? "error" : "stdout",
      title: eventType.endsWith("begin") || eventType.endsWith("request") ? "Calling Tool" : "Tool Result",
      text: [invocation.server || event.namespace, invocation.tool || event.tool].filter(Boolean).join("/"),
      detail: event.error || textFromMcpResult(event.result) || compactJson(invocation.arguments || event.arguments || event.content_items),
      meta: event.duration || event.call_id || "",
      tone: failed ? "error" : "tool",
    };
  }
  if (["web_search_begin", "web_search_end"].includes(eventType)) {
    return {
      ...base,
      kind: "web",
      type: "stdout",
      title: eventType.endsWith("end") ? "Searched Web" : "Searching Web",
      text: event.query || compactJson(event.action),
      meta: event.call_id || "",
      tone: "tool",
    };
  }
  if (["patch_apply_begin", "patch_apply_updated", "patch_apply_end"].includes(eventType)) {
    return {
      ...base,
      kind: "patch",
      type: event.success === false ? "error" : "stdout",
      title: eventType.endsWith("end") ? "Patch Finished" : "Patch",
      text: event.command || event.status || compactJson(event.changes),
      meta: event.call_id || "",
      tone: event.success === false ? "error" : "tool",
    };
  }
  if (["warning", "guardian_warning", "stream_error"].includes(eventType)) {
    return {
      ...base,
      kind: "warning",
      type: "stderr",
      title: "Warning",
      text: event.message || event.summary || compactJson(event),
      meta: "codex",
      tone: "warning",
    };
  }
  return genericAgentEvent("codex", event, { ...context, base, rawType: eventType });
}

function normalizeCodexItem(item, eventType, base) {
  if (!item || typeof item !== "object") return null;
  const itemType = camelToSnake(item.type || item.kind || item.details?.type);
  const status = item.status || item.details?.status;
  const eventState = codexEventState(eventType);

  if (itemType === "agent_message") {
    return { ...base, kind: "assistant", type: "stdout", title: "Codex", text: item.text || item.message || "", meta: "assistant", tone: "assistant" };
  }
  if (itemType === "reasoning") {
    return { ...base, kind: "reasoning", type: "stdout", title: "Reasoning", text: item.text || item.summary || "", meta: "summary", tone: "system" };
  }
  if (itemType === "command_execution") {
    const command = commandText(item.command || item.details?.command);
    const output = item.aggregated_output || item.output || item.stdout || item.stderr || item.details?.output || "";
    const exit = item.exit_code ?? item.exitCode;
    const failed = (exit != null && exit !== 0) || status === "failed";
    const label = status === "in_progress" || eventState === "started" ? "Running" : exit === 0 || status === "completed" ? "Ran" : "Command";
    return {
      ...base,
      kind: "command",
      type: failed ? "error" : "stdout",
      title: label,
      text: command,
      detail: output,
      meta: [status, exit != null ? `exit ${exit}` : ""].filter(Boolean).join(" · "),
      tone: failed ? "error" : "command",
    };
  }
  if (itemType === "file_change") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    return {
      ...base,
      kind: "patch",
      type: status === "failed" ? "error" : "stdout",
      title: status === "completed" ? "Patch Applied" : status === "failed" ? "Patch Failed" : "Patch",
      text: changes.map((change) => `${change.kind || "update"} ${change.path || ""}`.trim()).join("\n"),
      meta: status || eventState,
      tone: status === "failed" ? "error" : "tool",
    };
  }
  if (itemType === "mcp_tool_call") {
    const error = item.error?.message || "";
    return {
      ...base,
      kind: "tool",
      type: error || status === "failed" ? "error" : "stdout",
      title: status === "in_progress" || eventState === "started" ? "Calling MCP" : "MCP Tool",
      text: [item.server, item.tool].filter(Boolean).join("/"),
      detail: error || textFromMcpResult(item.result) || compactJson(item.arguments),
      meta: status || eventState,
      tone: error || status === "failed" ? "error" : "tool",
    };
  }
  if (itemType === "web_search") {
    const action = item.action || {};
    const query = item.query || action.query || (action.queries || [])[0] || action.url || "";
    return { ...base, kind: "web", type: "stdout", title: eventState === "completed" ? "Searched Web" : "Searching Web", text: query, meta: action.type || eventState, tone: "tool" };
  }
  if (itemType === "todo_list") {
    const items = Array.isArray(item.items) ? item.items : [];
    return {
      ...base,
      kind: "plan",
      type: "stdout",
      title: "Plan",
      text: items.map((todo) => `${todo.completed ? "[x]" : "[ ]"} ${todo.text}`).join("\n"),
      meta: eventState,
      tone: "system",
    };
  }
  if (itemType === "error") {
    return { ...base, kind: "error", type: "error", title: "Error", text: item.message || compactJson(item), meta: eventState, tone: "error" };
  }
  return genericAgentEvent("codex", item, { base, rawType: itemType || eventType });
}

function genericAgentEvent(runtime, raw, context = {}) {
  const base = context.base || {
    id: `${context.taskId || "task"}:${context.phase || "run"}:${context.seq || 0}`,
    seq: context.seq || 0,
    ts: nowIso(),
    runtime,
    source: `${runtime}-event`,
    phase: context.phase || "run",
    rawType: context.rawType || camelToSnake(raw?.type || raw?.kind || "event"),
  };
  return {
    ...base,
    kind: "system",
    type: "system",
    title: "Agent Event",
    text: firstText(raw?.message, raw?.summary, raw?.text) || compactJson(raw),
    detail: compactJson(raw),
    meta: base.rawType,
    tone: "system",
  };
}

function eventPayload(raw) {
  if (raw && raw.msg && typeof raw.msg === "object") {
    if (raw.msg.type) return raw.msg;
    const keys = Object.keys(raw.msg);
    if (keys.length === 1 && typeof raw.msg[keys[0]] === "object") {
      return { type: keys[0], ...raw.msg[keys[0]] };
    }
  }
  return raw;
}

function usageText(usage) {
  if (!usage) return "";
  const parts = [];
  if (usage.input_tokens != null) parts.push(`in ${usage.input_tokens}`);
  if (usage.cached_input_tokens != null) parts.push(`cached ${usage.cached_input_tokens}`);
  if (usage.output_tokens != null) parts.push(`out ${usage.output_tokens}`);
  if (usage.reasoning_output_tokens != null) parts.push(`reasoning ${usage.reasoning_output_tokens}`);
  return parts.join(" · ");
}

function codexEventState(eventType) {
  const type = camelToSnake(eventType || "");
  if (type.endsWith("started") || type.endsWith("begin")) return "started";
  if (type.endsWith("updated") || type.endsWith("delta")) return "updated";
  if (type.endsWith("completed") || type.endsWith("end")) return "completed";
  if (type.endsWith("failed") || type.endsWith("error")) return "failed";
  return "";
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (value != null && typeof value !== "object") return String(value);
  }
  return "";
}

function textFromMcpResult(result) {
  if (!result) return "";
  if (result.error?.message) return result.error.message;
  const content = result.content || result.result?.content || [];
  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text || item?.content || "")
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content === "string") return content;
  return firstText(result.text, result.message) || compactJson(result);
}

function commandText(command) {
  if (Array.isArray(command)) return command.join(" ");
  if (command && typeof command === "object") return command.command || command.text || compactJson(command);
  return String(command || "");
}

function decodeBase64Text(value) {
  if (!value) return "";
  try {
    return Buffer.from(String(value), "base64").toString("utf8");
  } catch {
    return String(value);
  }
}

function compactJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value || "");
  }
}

function camelToSnake(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[.\-/\s]+/g, "_")
    .toLowerCase();
}

module.exports = {
  camelToSnake,
  codexRuntimeAdapter,
  codexEventState,
  commandText,
  compactJson,
  normalizeAgentRuntimeEvent,
  normalizeCodexJsonEvent,
  prepareCodexResumeInvocation,
  prepareCodexRunInvocation,
};
