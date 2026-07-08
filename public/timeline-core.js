(function initSecondTrace(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  const target = root?.window || root;
  if (target) target.SecondTrace = api;
  if (typeof window === "object") window.SecondTrace = api;
  if (typeof globalThis === "object") globalThis.SecondTrace = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondTrace() {
  "use strict";

  const PRODUCT_LOGO_SOURCES = {
    codex: "/logos/codex.svg",
    "claude-code": "/logos/claude-code.svg",
    openclaw: "/logos/openclaw.svg",
    slack: "/logos/slack.svg",
    linear: "/logos/linear.svg",
    clickup: "/logos/clickup.svg",
    feishu: "/logos/feishu.png",
    dingding: "/logos/dingtalk.svg",
  };

  const SOURCE_CHANNELS = {
    slack: {
      id: "slack",
      label: "Slack",
      icon: PRODUCT_LOGO_SOURCES.slack,
      iconClass: "source-icon-slack",
      actorKind: "entry",
      originalSubtitle: "Slack · 原始消息",
      threadSubtitle: "Slack · 线程消息",
      channelLabel: (external = {}) => slackChannelLabel(external),
      authorLabel: (external = {}) => slackUserLabel(external.user || "requester"),
      eventTime: (external = {}, helpers = {}) => slackEventTime(external.eventTs || external.event_ts, helpers.relativeTime),
      isThreadTrace: (ev = {}) => ev.kind === "entry" && /线程新消息|线程消息/.test(String(ev.title || "")),
    },
  };

  const DEFAULT_SOURCE_CHANNEL = {
    id: "source",
    label: "信息源",
    icon: "",
    iconClass: "",
    actorKind: "entry",
    originalSubtitle: "原始任务消息",
    threadSubtitle: "线程消息",
    channelLabel: (_external = {}, task = {}) => task.source || task.sourceMessage?.channelName || "任务来源",
    authorLabel: (_external = {}, task = {}) => task.source || "来源",
    eventTime: (external = {}, helpers = {}) => (external.eventTs && helpers.relativeTime ? helpers.relativeTime(external.eventTs) : ""),
    isThreadTrace: (ev = {}) => ev.kind === "entry" && /线程新消息|线程消息/.test(String(ev.title || "")),
  };

  const AGENT_RUNTIME_DEFAULT = {
    id: "agent",
    label: "Agent Runtime",
    phaseLabels: {
      initial: "执行流",
      run: "执行流",
      resume: "继续执行流",
      channel: "线程继续执行流",
      reply: "补证据流",
      default: "执行流",
    },
    kindLabels: {
      assistant: "文本输出",
      command: "命令调用",
      "command-output": "命令输出",
      tool: "工具调用",
      reasoning: "思考过程",
      web: "网络检索",
      patch: "文件变更",
      plan: "计划",
      system: "事件输出",
      success: "完成",
      warning: "警告",
      error: "错误",
    },
    tones: {
      assistant: "assistant",
      success: "assistant",
      tool: "tool",
      web: "tool",
      patch: "tool",
      command: "command",
      "command-output": "command",
      error: "error",
      warning: "warning",
    },
    isRunStart: (event = {}) => {
      const rawType = String(event.rawType || event.type || "").toLowerCase();
      return ["thread_started", "thread.started"].includes(rawType) || event.title === "Thread Started";
    },
    shouldSkipActivity: (event = {}) => {
      const kind = String(event.kind || "system").toLowerCase();
      const rawType = String(event.rawType || event.type || "").toLowerCase();
      return kind === "system" && ["thread_started", "turn_started", "thread.started", "turn.started"].includes(rawType);
    },
  };

  const AGENT_RUNTIMES = {
    codex: {
      ...AGENT_RUNTIME_DEFAULT,
      id: "codex",
      label: "Codex CLI",
    },
    claude: {
      ...AGENT_RUNTIME_DEFAULT,
      id: "claude",
      label: "Claude Code",
    },
  };

  const TRACE_CONTEXT_PHASE_RULES = [
    { phase: "channel", pattern: /slack|thread|线程/i },
    { phase: "reply", pattern: /reply|补充|补证据/i },
    { phase: "resume", pattern: /resume|继续|恢复|decision|human gate|决策/i },
  ];

  const TRACE_HIDDEN_RULES = [
    { title: /^任务创建$/ },
    { kind: "agent", title: /提交 Human Gate 决策|准备恢复可恢复式/ },
    { kind: "gate", title: /^等待决策/ },
    { kind: "runtime", title: /可恢复会话已建立|捕获可恢复/ },
    { kind: "out", title: /执行完成|执行结束/ },
  ];

  function taskTimelineSegments(task = {}, options = {}) {
    const trace = task.trace || [];
    const agentEvents = agentEventsForTask(task);
    const agentGroups = agentEventGroups(agentEvents);
    const groupsByEventKey = agentGroupsByEventKey(agentGroups);
    const groupsByContextTrace = agentGroupsByContextTrace(trace, agentGroups);
    const segments = [];
    if (options.sourceEvent) segments.push({ type: "trace", event: options.sourceEvent });
    segments.push(...(options.preludeEvents || []).map((event) => ({ type: "trace", event })));

    const insertedGroups = new Set();
    const pendingContextEvents = [];
    let pendingCompletionEvent = null;
    let lastAgentSegment = null;

    const pushGroup = (group, contextEvents = []) => {
      if (!group || insertedGroups.has(group.key)) return false;
      const segment = { type: "agent-bundle", ...group, contextEvents };
      if (pendingCompletionEvent) {
        segment.completionEvent = pendingCompletionEvent;
        pendingCompletionEvent = null;
      }
      segments.push(segment);
      insertedGroups.add(group.key);
      lastAgentSegment = segment;
      return true;
    };

    const flushPendingContextEvents = () => {
      if (!pendingContextEvents.length) return;
      segments.push(...pendingContextEvents.splice(0).map((event) => ({ type: "trace", event })));
    };

    for (const ev of trace) {
      if (isAgentRuntimeTrace(ev)) {
        const anchoredGroup = groupsByEventKey.get(ev.agentEventId);
        if (anchoredGroup) pushGroup(anchoredGroup, pendingContextEvents.splice(0));
        continue;
      }
      if (isCompletionTraceEvent(ev)) {
        if (lastAgentSegment) lastAgentSegment.completionEvent = ev;
        else pendingCompletionEvent = ev;
        continue;
      }
      if (shouldHideTraceEvent(ev)) continue;
      if (isAgentRuntimeContextTrace(ev)) {
        pendingContextEvents.push(ev);
        const contextGroup = groupsByContextTrace.get(ev);
        if (contextGroup) pushGroup(contextGroup, pendingContextEvents.splice(0));
        continue;
      }
      flushPendingContextEvents();
      segments.push({ type: "trace", event: ev });
    }

    const remainingGroups = agentGroups.filter((group) => !insertedGroups.has(group.key));
    const firstBundleIndex = segments.findIndex((segment) => segment.type === "agent-bundle");
    if (firstBundleIndex >= 0) {
      const firstSeq = segments[firstBundleIndex].minSeq || Infinity;
      const earlierGroups = remainingGroups.filter((group) => group.maxSeq < firstSeq);
      if (earlierGroups.length) {
        segments.splice(
          firstBundleIndex,
          0,
          ...earlierGroups.map((group) => ({ type: "agent-bundle", ...group, contextEvents: [] })),
        );
        for (const group of earlierGroups) insertedGroups.add(group.key);
      }
    }

    for (const group of agentGroups) {
      if (!insertedGroups.has(group.key)) pushGroup(group, []);
    }
    flushPendingContextEvents();
    if (pendingCompletionEvent && lastAgentSegment) lastAgentSegment.completionEvent = pendingCompletionEvent;
    return segments;
  }

  function sourceChannelType(task = {}) {
    return task.channel?.id || (task.slack ? "slack" : "") || task.sourceMessage?.type || "source";
  }

  function sourceChannelAdapter(type) {
    return SOURCE_CHANNELS[String(type || "").toLowerCase()] || DEFAULT_SOURCE_CHANNEL;
  }

  function isChannelMessageTrace(task, ev) {
    return sourceChannelAdapter(sourceChannelType(task)).isThreadTrace(ev, task);
  }

  function isRuntimeLaunchTrace(ev) {
    if (ev?.kind !== "runtime") return false;
    const title = String(ev.title || "").toLowerCase();
    return (
      /codex exec/.test(title) ||
      /分身.*(开始|继续)执行/.test(String(ev.title || "")) ||
      /线程消息继续执行|分身补充证据/.test(String(ev.title || ""))
    );
  }

  function isAgentRuntimeContextTrace(ev) {
    if (isRuntimeLaunchTrace(ev)) return true;
    return false;
  }

  function contextTracePhase(ev) {
    const text = `${ev?.title || ""} ${ev?.description || ""}`.toLowerCase();
    const rule = TRACE_CONTEXT_PHASE_RULES.find((item) => item.pattern.test(text));
    if (rule) return rule.phase;
    return "initial";
  }

  function shouldHideTraceEvent(ev = {}) {
    return TRACE_HIDDEN_RULES.some((rule) => traceRuleMatches(rule, ev));
  }

  function traceRuleMatches(rule, ev = {}) {
    if (rule.kind && ev.kind !== rule.kind) return false;
    if (rule.title && !rule.title.test(String(ev.title || ""))) return false;
    return true;
  }

  function isCompletionTraceEvent(ev = {}) {
    return ev.kind === "out" && /执行完成|执行结束/.test(String(ev.title || ""));
  }

  function agentEventGroups(events = []) {
    const ordered = [];
    const counters = new Map();
    let current = null;
    for (const event of events) {
      const phase = event.phase || "run";
      const runId = event.runId || "";
      const startsRun = isAgentRunStart(event);
      const shouldStart =
        !current ||
        current.phase !== phase ||
        (runId && current.runId !== runId) ||
        (startsRun && current.events.length);
      if (shouldStart) {
        const runIndex = (counters.get(phase) || 0) + 1;
        counters.set(phase, runIndex);
        const key = runId || `${phase}:${runIndex}`;
        current = { key, phase, runId, runIndex, events: [] };
        ordered.push(current);
      }
      current.events.push(event);
    }
    return ordered.map((group) => ({
      ...group,
      runtime: group.events.find((event) => event.runtime)?.runtime || "agent",
      minSeq: Math.min(...group.events.map((event) => Number(event.seq) || 0)),
      maxSeq: Math.max(...group.events.map((event) => Number(event.seq) || 0)),
    }));
  }

  function agentGroupsByEventKey(groups) {
    const byKey = new Map();
    for (const group of groups) {
      for (const event of group.events) byKey.set(event.key, group);
    }
    return byKey;
  }

  function agentGroupsByContextTrace(trace = [], groups = []) {
    const byTrace = new Map();
    const traceByPhase = new Map();
    const groupsByPhase = new Map();
    for (const ev of trace) {
      if (!isAgentRuntimeContextTrace(ev)) continue;
      const phase = contextTracePhase(ev);
      if (!traceByPhase.has(phase)) traceByPhase.set(phase, []);
      traceByPhase.get(phase).push(ev);
    }
    for (const group of groups) {
      const phase = group.phase || "initial";
      if (!groupsByPhase.has(phase)) groupsByPhase.set(phase, []);
      groupsByPhase.get(phase).push(group);
    }
    for (const [phase, phaseGroups] of groupsByPhase.entries()) {
      const phaseTrace = traceByPhase.get(phase) || [];
      let traceIndex = phaseTrace.length - 1;
      for (let groupIndex = phaseGroups.length - 1; groupIndex >= 0 && traceIndex >= 0; groupIndex -= 1, traceIndex -= 1) {
        byTrace.set(phaseTrace[traceIndex], phaseGroups[groupIndex]);
      }
    }
    return byTrace;
  }

  function isAgentRunStart(event) {
    return agentRuntimeAdapter(event.runtime).isRunStart(event);
  }

  function isAgentRuntimeTrace(ev) {
    if (!ev || ev.kind !== "runtime") return false;
    if (ev.agentEventId) return true;
    const title = String(ev.title || "");
    return /^(thread|turn|item)\./.test(title) || ["agent_message", "agent_reasoning", "reasoning"].some((part) => title.includes(part));
  }

  function agentEventsForTask(task = {}) {
    const stored = Array.isArray(task.agentEvents) ? task.agentEvents : [];
    if (stored.length) return stored.map((event, index) => normalizeStoredAgentEvent(event, index));
    return (task.trace || [])
      .filter(isAgentRuntimeTrace)
      .map((ev, index) => normalizeTraceAgentEvent(ev, index))
      .filter(Boolean);
  }

  function normalizeStoredAgentEvent(event, index) {
    const kind = String(event.kind || event.type || "system").toLowerCase();
    return {
      key: event.id || `${event.runtime || "agent"}:${event.phase || "run"}:${event.seq || index}`,
      seq: event.seq || index + 1,
      ts: event.ts || event.at || "",
      runtime: event.runtime || "agent",
      phase: event.phase || "run",
      runId: event.runId || "",
      source: event.source || "runtime",
      rawType: event.rawType || event.type || "",
      kind,
      type: event.type || "stdout",
      tone: event.tone || agentTone(kind, event.type, event.runtime),
      title: event.title || agentKindLabel(kind, event.runtime),
      text: event.text || "",
      detail: event.detail || "",
      meta: event.meta || "",
    };
  }

  function normalizeTraceAgentEvent(ev, index) {
    const raw = tryParseJson(ev.description);
    if (raw) return normalizeRawRuntimeEvent(raw, ev, index);
    const description = String(ev.description || "");
    const messageMatch = description.match(/^agent_message:\s*([\s\S]*)$/);
    return {
      key: ev.agentEventId || `trace-agent:${index}`,
      seq: index + 1,
      ts: "",
      runtime: ev.runtime || "codex",
      phase: "legacy",
      source: "trace",
      rawType: ev.title || "",
      kind: messageMatch ? "assistant" : "system",
      type: "stdout",
      tone: messageMatch ? "assistant" : "system",
      title: messageMatch ? "Codex" : ev.title || "Agent Event",
      text: messageMatch ? messageMatch[1] : description,
      detail: "",
      meta: ev.meta || ev.title || "",
    };
  }

  function normalizeRawRuntimeEvent(raw, ev, index) {
    const runtime = String(ev.runtime || ev.meta || "codex").toLowerCase();
    if (runtime.includes("codex") || !runtime || runtime === "legacy") return normalizeRawCodexEvent(raw, ev, index);
    return normalizeGenericRawAgentEvent(raw, ev, index);
  }

  function normalizeRawCodexEvent(raw, ev, index) {
    const event = raw?.msg && typeof raw.msg === "object" ? raw.msg : raw;
    const type = snakeCase(event?.type || raw?.type || ev.title || "event");
    const base = {
      key: ev.agentEventId || `trace-agent:${index}`,
      seq: index + 1,
      ts: "",
      runtime: "codex",
      phase: "legacy",
      source: "trace-json",
      rawType: type,
      type: "stdout",
      meta: "codex",
    };
    if (type === "thread_started" || type === "turn_started") {
      return {
        ...base,
        kind: "system",
        tone: "system",
        title: type === "thread_started" ? "Thread Started" : "Turn Started",
        text: event.thread_id || event.threadId || "",
      };
    }
    if (type === "turn_completed") return { ...base, kind: "success", tone: "assistant", title: "Turn Completed", text: usageText(event.usage) };
    if (type === "turn_failed" || type === "error") {
      return { ...base, kind: "error", type: "error", tone: "error", title: "Error", text: event.error?.message || event.message || compactJson(event) };
    }
    if (["item_started", "item_updated", "item_completed"].includes(type)) return normalizeRawCodexItem(event.item, type, base);
    return {
      ...base,
      kind: "system",
      tone: "system",
      title: "Codex Event",
      text: firstText(event.message, event.text) || compactJson(event),
      detail: compactJson(event),
      meta: type,
    };
  }

  function normalizeGenericRawAgentEvent(raw, ev, index) {
    const event = raw?.msg && typeof raw.msg === "object" ? raw.msg : raw;
    const type = snakeCase(event?.type || raw?.type || ev.title || "event");
    const kind = type.includes("error") || type.includes("failed") ? "error" : type.includes("message") ? "assistant" : "system";
    return {
      key: ev.agentEventId || `trace-agent:${index}`,
      seq: index + 1,
      ts: event.ts || event.timestamp || "",
      runtime: ev.runtime || "agent",
      phase: ev.phase || "legacy",
      source: "trace-json",
      rawType: type,
      kind,
      type: kind === "error" ? "error" : "stdout",
      tone: agentTone(kind, kind === "error" ? "error" : "stdout", ev.runtime),
      title: event.title || agentKindLabel(kind, ev.runtime),
      text: firstText(event.message, event.text, event.output) || compactJson(event),
      detail: compactJson(event),
      meta: type,
    };
  }

  function normalizeRawCodexItem(item, eventType, base) {
    if (!item || typeof item !== "object") return { ...base, kind: "system", tone: "system", title: "Codex Event", text: compactJson(item) };
    const itemType = snakeCase(item.type || item.kind || item.details?.type);
    const state = codexEventState(eventType);
    const status = item.status || item.details?.status || state;
    if (itemType === "agent_message") return { ...base, kind: "assistant", tone: "assistant", title: "Codex", text: item.text || item.message || "", meta: "assistant" };
    if (itemType === "reasoning") return { ...base, kind: "reasoning", tone: "system", title: "Reasoning", text: item.text || item.summary || "", meta: "summary" };
    if (itemType === "mcp_tool_call") {
      const error = item.error?.message || "";
      return {
        ...base,
        kind: "tool",
        tone: error || status === "failed" ? "error" : "tool",
        type: error || status === "failed" ? "error" : "stdout",
        title: status === "in_progress" || state === "started" ? "Calling MCP" : "MCP Tool",
        text: [item.server, item.tool].filter(Boolean).join("/"),
        detail: error || textFromMcpResult(item.result) || compactJson(item.arguments),
        meta: status,
      };
    }
    if (itemType === "command_execution") {
      const exit = item.exit_code ?? item.exitCode;
      const failed = (exit != null && exit !== 0) || status === "failed";
      return {
        ...base,
        kind: "command",
        tone: failed ? "error" : "command",
        type: failed ? "error" : "stdout",
        title: status === "in_progress" || state === "started" ? "Running" : "Command",
        text: commandText(item.command || item.details?.command),
        detail: item.aggregated_output || item.output || item.stdout || item.stderr || item.details?.output || "",
        meta: [status, exit != null ? `exit ${exit}` : ""].filter(Boolean).join(" · "),
      };
    }
    return { ...base, kind: "system", tone: "system", title: itemType || "Codex Event", text: firstText(item.text, item.message) || compactJson(item), meta: status };
  }

  function agentRuntimeAdapter(runtime) {
    const value = String(runtime || "").toLowerCase();
    if (value.includes("codex")) return AGENT_RUNTIMES.codex;
    if (value.includes("claude")) return AGENT_RUNTIMES.claude;
    return AGENT_RUNTIME_DEFAULT;
  }

  function agentKindLabel(kind, runtime = "") {
    return agentRuntimeAdapter(runtime).kindLabels[kind] || AGENT_RUNTIME_DEFAULT.kindLabels[kind] || "事件输出";
  }

  function agentTone(kind, type, runtime = "") {
    const adapter = agentRuntimeAdapter(runtime);
    if (adapter.tones[kind]) return adapter.tones[kind];
    if (type === "error") return "error";
    if (type === "stderr") return "warning";
    return "system";
  }

  function runtimeLabel(runtime) {
    return agentRuntimeAdapter(runtime).label || runtime || "Agent Runtime";
  }

  function slackChannelLabel(external = {}) {
    if (external.channelLabel) return external.channelLabel;
    if (external.channelName) return `#${external.channelName}`;
    if (external.channel) return `# ${external.channel}`;
    return "Slack";
  }

  function slackUserLabel(user) {
    const value = String(user || "").trim();
    if (!value) return "Slack requester";
    if (value === "requester") return "Slack requester";
    return `Slack ${value}`;
  }

  function slackEventTime(ts, relativeTime) {
    if (!ts) return "";
    const value = Number.parseFloat(String(ts));
    if (!Number.isFinite(value)) return "";
    const iso = new Date(value * 1000).toISOString();
    return typeof relativeTime === "function" ? relativeTime(iso) : iso;
  }

  function tryParseJson(text) {
    const value = String(text || "").trim();
    if (!value.startsWith("{") && !value.startsWith("[")) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function snakeCase(value) {
    return String(value || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[.\-/\s]+/g, "_")
      .toLowerCase();
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
    const type = snakeCase(eventType || "");
    if (type.endsWith("started") || type.endsWith("begin")) return "started";
    if (type.endsWith("updated") || type.endsWith("delta")) return "updated";
    if (type.endsWith("completed") || type.endsWith("end")) return "completed";
    if (type.endsWith("failed") || type.endsWith("error")) return "failed";
    return "";
  }

  function commandText(command) {
    if (Array.isArray(command)) return command.join(" ");
    if (command && typeof command === "object") return command.command || command.text || compactJson(command);
    return String(command || "");
  }

  function textFromMcpResult(result) {
    if (!result) return "";
    if (result.error?.message) return result.error.message;
    const content = result.content || result.result?.content || [];
    if (Array.isArray(content)) return content.map((item) => item?.text || item?.content || "").filter(Boolean).join("\n");
    if (typeof content === "string") return content;
    return firstText(result.text, result.message) || compactJson(result);
  }

  function compactJson(value) {
    try {
      const text = JSON.stringify(value);
      return text == null ? "" : text;
    } catch {
      return String(value || "");
    }
  }

  function firstText(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value;
      if (value != null && typeof value !== "object") return String(value);
    }
    return "";
  }

  return {
    AGENT_RUNTIME_DEFAULT,
    AGENT_RUNTIMES,
    DEFAULT_SOURCE_CHANNEL,
    PRODUCT_LOGO_SOURCES,
    SOURCE_CHANNELS,
    TRACE_CONTEXT_PHASE_RULES,
    TRACE_HIDDEN_RULES,
    agentEventGroups,
    agentGroupsByContextTrace,
    agentEventsForTask,
    agentKindLabel,
    agentRuntimeAdapter,
    agentTone,
    contextTracePhase,
    isAgentRuntimeContextTrace,
    isAgentRuntimeTrace,
    isChannelMessageTrace,
    isCompletionTraceEvent,
    isRuntimeLaunchTrace,
    runtimeLabel,
    shouldHideTraceEvent,
    sourceChannelAdapter,
    sourceChannelType,
    taskTimelineSegments,
  };
});
