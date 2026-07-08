(function initSecondTaskTraceAgentView(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondTaskTraceAgentView = api;
  if (typeof window === "object") window.SecondTaskTraceAgentView = api;
  if (typeof globalThis === "object") globalThis.SecondTaskTraceAgentView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondTaskTraceAgentView() {
  "use strict";

  function createTaskTraceAgentView(deps = {}) {
    const {
      TraceCore = {},
      actorStyle = () => ({ color: "inherit", bg: "transparent" }),
      displayTraceEvent = () => ({}),
      escapeAttr = escapeHtmlAttribute,
      escapeHtml = escapeHtmlText,
      getUi = () => ({}),
      relativeTime = () => "",
      traceFormat = {},
    } = deps;
    const sanitizeTraceText = traceFormat.sanitizeTraceText || ((text) => String(text || "").trim());
    const sanitizeTraceMeta = traceFormat.sanitizeTraceMeta || ((meta) => sanitizeTraceText(meta));
    const sanitizeAgentCardText = traceFormat.sanitizeAgentCardText || ((text) => String(text || "").trim());
    const sanitizeAgentCardMeta = traceFormat.sanitizeAgentCardMeta || ((meta) => String(meta || "").trim());
    const appendText = traceFormat.appendText || ((current, next) => [current, next].filter(Boolean).join("\n").trim());

    function agentEventsForTask(task) {
      return TraceCore.agentEventsForTask ? TraceCore.agentEventsForTask(task) : task.agentEvents || [];
    }

    function agentEventStats(task) {
      const events = agentEventsForTask(task);
      if (!events.length) return "";
      const tools = events.filter((event) => event.kind === "tool").length;
      const texts = events.filter((event) => event.kind === "assistant").length;
      return `
        <div class="agent-layer-strip">
          <span class="code-chip mono">AGENT LAYER</span>
          <span>${escapeHtml(task.agent || "分身")} · ${events.length} 条事件</span>
          ${texts ? `<span>${texts} 条文本</span>` : ""}
          ${tools ? `<span>${tools} 次工具</span>` : ""}
        </div>
      `;
    }

    function agentRuntimeBundle(task, segment, index, total, live = false) {
      const events = segment.events || [];
      const contextEvents = segment.contextEvents || [];
      const activities = agentActivityItems(events);
      const key = `${task.id}:agent-runtime:${segment.key || index}`;
      const ui = getUi() || {};
      const expanded = Boolean(ui.execOpen?.[key]);
      const phaseLabel = agentRuntimePhaseLabel(segment);
      const latest = activities[activities.length - 1] || events[events.length - 1];
      const completion = segment.completionEvent ? displayTraceEvent(segment.completionEvent, task) : null;
      const completionTone = /失败|结束/.test(String(segment.completionEvent?.title || "")) ? "danger" : "ok";
      const actor = actorStyle("agent");
      const eventTime = agentRuntimeSegmentTime(events);
      const tools = activities.filter((item) => item.kind === "tool").length;
      const textOutputs = activities.filter((item) => item.kind === "assistant").length;
      const errors = activities.filter((item) => ["error", "warning"].includes(item.tone)).length;
      return `
        <div class="timeline-item agent-runtime-node ${live ? "live" : ""}">
          <div class="timeline-rail">
            <div class="timeline-dot agent-runtime-dot"></div>
            ${index < total - 1 ? `<div class="timeline-line"></div>` : ""}
          </div>
          <div class="timeline-body">
            <div class="actor-row agent-bundle-actor-row">
              <span class="pill" style="color:${actor.color};background:${actor.bg}">${escapeHtml(task.agent || "分身")}</span>
              <span class="source-kind">agent 事件</span>
              ${eventTime ? `<span class="time-small mono" style="margin-left:0">${escapeHtml(eventTime)}</span>` : ""}
            </div>
            <section class="agent-event-bundle ${expanded ? "expanded" : ""}">
              <button class="agent-event-bundle-toggle" data-action="toggle-exec" data-key="${escapeAttr(key)}" aria-expanded="${expanded ? "true" : "false"}">
                <span class="agent-event-bundle-dot" aria-hidden="true"></span>
                <span class="agent-event-bundle-copy">
                  <strong>${escapeHtml(task.agent || "分身")}${phaseLabel}</strong>
                  <em>${events.length} 条事件 · ${activities.length} 张卡片</em>
                </span>
                ${latest ? `<span class="agent-event-bundle-latest">最新: ${escapeHtml(latest.title || latest.label)}</span>` : ""}
                ${textOutputs ? `<span class="agent-bundle-chip">${textOutputs} 文本</span>` : ""}
                ${tools ? `<span class="agent-bundle-chip">${tools} 工具</span>` : ""}
                ${errors ? `<span class="agent-bundle-chip danger">${errors} 异常</span>` : ""}
                ${completion ? `<span class="agent-bundle-chip ${completionTone}">${completionTone === "ok" ? "已完成" : "已结束"}</span>` : ""}
                <span class="chev ${expanded ? "open" : ""}">▶</span>
              </button>
              ${contextEvents.length ? renderAgentBundleContext(contextEvents) : ""}
              ${completion ? `
                <div class="agent-bundle-completion ${completionTone}">
                  <b>${escapeHtml(completion.title || "执行完成")}</b>
                  ${completion.description ? `<span>${escapeHtml(completion.description)}</span>` : ""}
                </div>
              ` : ""}
              ${expanded ? `<div class="agent-event-list">${activities.map(renderAgentActivityCard).join("")}</div>` : ""}
            </section>
          </div>
        </div>
      `;
    }

    function agentRuntimePhaseLabel(segment) {
      const adapter = agentRuntimeAdapter(segment.runtime || segment.events?.[0]?.runtime);
      return adapter.phaseLabels?.[segment.phase] || adapter.phaseLabels?.default || "执行流";
    }

    function agentRuntimeSegmentTime(events = []) {
      const event = events.find((item) => item.ts);
      return event?.ts ? relativeTime(event.ts) : "";
    }

    function renderAgentBundleContext(events) {
      return `
        <div class="agent-bundle-context">
          ${events.map(renderAgentBundleContextLine).join("")}
        </div>
      `;
    }

    function renderAgentBundleContextLine(event) {
      const title = sanitizeTraceText(event.title || "上下文");
      const description = sanitizeTraceText(event.description || "");
      const meta = sanitizeTraceMeta(event.meta || "");
      return `
        <div class="agent-bundle-context-line">
          <b>${escapeHtml(title)}</b>
          ${description ? `<span>${escapeHtml(description)}</span>` : ""}
          ${meta ? `<code>${escapeHtml(meta)}</code>` : ""}
        </div>
      `;
    }

    function agentActivityItems(events) {
      const items = [];
      let lastCommand = null;
      let reasoning = null;
      let issue = null;
      for (const event of events) {
        const kind = String(event.kind || "system").toLowerCase();
        const adapter = agentRuntimeAdapter(event.runtime);
        if (adapter.shouldSkipActivity?.(event)) continue;
        const text = String(event.text || "").trim();
        const detail = String(event.detail || "").trim();
        if (!text && !detail && !event.meta) continue;
        if (["error", "warning"].includes(kind) || ["stderr", "error"].includes(String(event.type || "").toLowerCase())) {
          const line = [event.title, event.meta, text, detail].filter(Boolean).join("\n");
          if (!issue) {
            issue = createAgentActivity(event, { title: "运行告警与错误", text: line, detail: "" });
            issue.tone = kind === "error" || event.type === "error" ? "error" : "warning";
            issue.issueCount = 1;
            items.push(issue);
          } else {
            issue.text = appendText(issue.text, line);
            issue.issueCount += 1;
            issue.lastTs = event.ts || issue.lastTs;
            if (kind === "error" || event.type === "error") issue.tone = "error";
          }
          continue;
        }
        if (kind === "command-output") {
          const output = appendText(text, detail);
          if (lastCommand) {
            lastCommand.detail = appendText(lastCommand.detail, output);
            lastCommand.lastTs = event.ts || lastCommand.lastTs;
          } else {
            items.push(createAgentActivity(event, { title: "命令输出", text: output, detail: "" }));
          }
          continue;
        }
        if (kind === "command") {
          const command = text;
          if (lastCommand && lastCommand.command === command) {
            lastCommand.detail = appendText(lastCommand.detail, detail);
            lastCommand.meta = event.meta || lastCommand.meta;
            lastCommand.lastTs = event.ts || lastCommand.lastTs;
            continue;
          }
          lastCommand = createAgentActivity(event, { title: "命令调用", command, detail });
          items.push(lastCommand);
          continue;
        }
        if (kind === "reasoning") {
          if (!reasoning) {
            reasoning = createAgentActivity(event, { title: "思考过程", text: appendText(text, detail), detail: "" });
            items.push(reasoning);
          } else {
            reasoning.text = appendText(reasoning.text, appendText(text, detail));
            reasoning.lastTs = event.ts || reasoning.lastTs;
          }
          continue;
        }
        items.push(createAgentActivity(event));
      }
      return items;
    }

    function createAgentActivity(event, overrides = {}) {
      const kind = String(event.kind || "system").toLowerCase();
      return {
        key: event.key || `${event.runtime || "agent"}:${event.seq || Math.random()}`,
        kind,
        label: agentKindLabel(kind, event.runtime),
        tone: event.tone || agentTone(kind, event.type, event.runtime),
        title: overrides.title || event.title || agentKindLabel(kind, event.runtime),
        command: overrides.command || "",
        text: sanitizeAgentCardText(overrides.text ?? event.text ?? ""),
        detail: sanitizeAgentCardText(overrides.detail ?? event.detail ?? ""),
        meta: sanitizeAgentCardMeta(event.meta || event.rawType || ""),
        firstTs: event.ts || "",
        lastTs: event.ts || "",
        issueCount: 0,
      };
    }

    function renderAgentActivityCard(item) {
      const body = renderAgentActivityBody(item);
      const meta = [item.issueCount ? `${item.issueCount} 条` : "", item.meta, item.lastTs ? relativeTime(item.lastTs) : ""].filter(Boolean).join(" · ");
      return `
        <details class="agent-activity-card tone-${escapeAttr(item.tone)}" ${item.kind === "assistant" ? "open" : ""}>
          <summary>
            <span class="agent-activity-dot" aria-hidden="true"></span>
            <span class="agent-activity-copy">
              <strong>${escapeHtml(item.title || item.label)}</strong>
              ${meta ? `<em>${escapeHtml(meta)}</em>` : ""}
            </span>
          </summary>
          ${body ? `<div class="agent-activity-detail">${body}</div>` : ""}
        </details>
      `;
    }

    function renderAgentActivityBody(item) {
      const parts = [];
      if (item.text) parts.push(`<pre class="agent-event-pre subtle-pre">${escapeHtml(item.text)}</pre>`);
      if (item.detail) parts.push(`<pre class="agent-event-pre">${escapeHtml(item.detail)}</pre>`);
      return parts.join("");
    }

    function agentRuntimeAdapter(runtime) {
      return TraceCore.agentRuntimeAdapter
        ? TraceCore.agentRuntimeAdapter(runtime)
        : { phaseLabels: { default: "执行流" }, shouldSkipActivity: () => false };
    }

    function agentKindLabel(kind, runtime = "") {
      return TraceCore.agentKindLabel ? TraceCore.agentKindLabel(kind, runtime) : kind || "事件输出";
    }

    function agentTone(kind, type, runtime = "") {
      return TraceCore.agentTone ? TraceCore.agentTone(kind, type, runtime) : kind || type || "system";
    }

    return {
      agentActivityItems,
      agentEventStats,
      agentEventsForTask,
      agentRuntimeBundle,
      renderAgentActivityCard,
    };
  }

  function escapeHtmlText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => (
      {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[char]
    ));
  }

  function escapeHtmlAttribute(value) {
    return escapeHtmlText(value);
  }

  return {
    createTaskTraceAgentView,
  };
});
