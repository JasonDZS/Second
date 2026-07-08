(function initSecondTaskTraceSourceView(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondTaskTraceSourceView = api;
  if (typeof window === "object") window.SecondTaskTraceSourceView = api;
  if (typeof globalThis === "object") globalThis.SecondTaskTraceSourceView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondTaskTraceSourceView() {
  "use strict";

  function createTaskTraceSourceView(deps = {}) {
    const {
      TraceCore = {},
      DEFAULT_SOURCE_CHANNEL = TraceCore.DEFAULT_SOURCE_CHANNEL || {},
      actorStyle = () => ({ color: "inherit", bg: "transparent" }),
      escapeAttr = escapeHtmlAttribute,
      escapeHtml = escapeHtmlText,
      relativeTime = () => "刚刚",
    } = deps;

    function sourceMessageTimelineItem(task, ev, index, total, live = false) {
      const source = ev.source || channelMessageSource(task, ev);
      const adapter = sourceChannelAdapter(source.type);
      const actor = actorStyle(adapter.actorKind);
      return `
        <div class="timeline-item source-message-node ${live ? "live" : ""}">
          <div class="timeline-rail">
            <div class="timeline-dot" style="background:${actor.color}"></div>
            ${index < total - 1 ? `<div class="timeline-line"></div>` : ""}
          </div>
          <div class="timeline-body">
            <div class="actor-row source-message-actor-row">
              <span class="source-event-badge">
                ${sourceIcon(source.type, "source-event-badge-icon")}
                <span>${escapeHtml(source.label || source.channelLabel || "信息源")}</span>
              </span>
              <span class="source-kind">${escapeHtml(source.kindLabel || adapter.kindLabel || "信息源")}</span>
              <span class="time-small mono" style="margin-left:0">${escapeHtml(source.time || ev.time || "刚刚")}</span>
            </div>
            ${sourceMessageCard(source)}
          </div>
        </div>
      `;
    }

    function sourceMessageCard(source) {
      if (!source.text) return "";
      const adapter = sourceChannelAdapter(source.type);
      if (source.type && adapter !== DEFAULT_SOURCE_CHANNEL) {
        return `
          <section class="task-source-card task-source-${escapeAttr(adapter.id)}">
            <div class="slack-shell">
              <div class="slack-head">
                <span style="font-size:13px;font-weight:750">${escapeHtml(source.channelLabel)}</span>
                <span style="font-size:11px;color:var(--faint)">${escapeHtml(source.subtitle || adapter.originalSubtitle)}</span>
              </div>
              <div class="slack-body task-source-body">
                <div class="slack-msg">
                  ${sourceIcon(source.type, "task-source-avatar")}
                  <div style="min-width:0;flex:1">
                    <div class="task-source-author">
                      <b>${escapeHtml(source.author)}</b>
                      ${source.time ? `<span>${escapeHtml(source.time)}</span>` : ""}
                    </div>
                    <div class="task-source-text">${escapeHtml(source.text)}</div>
                    <div class="task-source-meta mono">
                      ${sourceMetaParts(source, adapter).map((part) => `<span>${escapeHtml(part)}</span>`).join("")}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        `;
      }
      return `
        <section class="task-source-card">
          <div class="task-source-generic-head">
            <span class="section-label">原始任务消息</span>
            <span class="task-source-meta mono">${escapeHtml(source.channelLabel)}</span>
          </div>
          <div class="task-source-text">${escapeHtml(source.text)}</div>
        </section>
      `;
    }

    function taskSourceMessage(task) {
      const external = task.channel?.external || task.slack || task.sourceMessage?.external || {};
      const type = sourceChannelType(task);
      const adapter = sourceChannelAdapter(type);
      const text = task.messageText || task.sourceMessage?.text || extractTaskMessageText(task);
      const channelId = external.channel || "";
      const threadTs = external.threadTs || external.thread_ts || "";
      return {
        type,
        label: adapter.label,
        taskId: task.id,
        text,
        channelId,
        threadTs,
        author: adapter.authorLabel(external, task),
        avatar: slackUserAvatar(external.user || "requester"),
        channelLabel: adapter.channelLabel(external, task),
        time: adapter.eventTime(external, { relativeTime, task }),
        subtitle: adapter.originalSubtitle,
        kindLabel: adapter.kindLabel,
      };
    }

    function taskSourceMessageEvent(task) {
      const source = taskSourceMessage(task);
      if (!source.text) return null;
      return {
        kind: "source-message",
        actor: source.label || source.channelLabel,
        time: source.time || "刚刚",
        title: "原始消息",
        description: source.text,
        source,
      };
    }

    function channelMessageSource(task, ev = {}) {
      const base = taskSourceMessage(task);
      return {
        ...base,
        text: ev.description || "",
        time: ev.time || "刚刚",
        subtitle: sourceChannelAdapter(base.type).threadSubtitle,
        kindLabel: sourceChannelAdapter(base.type).threadKindLabel || sourceChannelAdapter(base.type).kindLabel,
        taskId: task.id,
      };
    }

    function sourceChannelType(task = {}) {
      return TraceCore.sourceChannelType ? TraceCore.sourceChannelType(task) : task.channel?.id || (task.slack ? "slack" : "") || "source";
    }

    function sourceChannelAdapter(type) {
      return TraceCore.sourceChannelAdapter?.(type) || DEFAULT_SOURCE_CHANNEL;
    }

    function sourceIcon(type, extraClass = "") {
      const adapter = sourceChannelAdapter(type);
      if (adapter.id === "assistant") {
        return assistantSourceIcon(adapter, extraClass);
      }
      if (adapter.icon) {
        return `
          <span class="source-icon ${escapeAttr(adapter.iconClass || "")} ${escapeAttr(extraClass)}" aria-hidden="true">
            <img src="${escapeAttr(adapter.icon)}" alt="" loading="lazy" decoding="async" />
          </span>
        `;
      }
      return `<span class="source-icon ${escapeAttr(extraClass)}" aria-hidden="true">${escapeHtml(String(adapter.label || "S").slice(0, 1))}</span>`;
    }

    function assistantSourceIcon(adapter, extraClass = "") {
      return `
        <span class="source-icon ${escapeAttr(adapter.iconClass || "")} ${escapeAttr(extraClass)}" aria-hidden="true">
          <span class="assistant-robot source-assistant-robot">
            <svg viewBox="0 0 64 64" fill="none" focusable="false">
              <path class="assistant-robot-halo" d="M21 13c3-5 19-5 22 0" />
              <rect class="assistant-robot-shell" x="10" y="15" width="44" height="39" rx="16" />
              <path class="assistant-robot-side left" d="M10 30H6c-2 0-3 1.6-3 3.5S4 37 6 37h4" />
              <path class="assistant-robot-side right" d="M54 30h4c2 0 3 1.6 3 3.5S60 37 58 37h-4" />
              <rect class="assistant-robot-visor" x="18" y="25" width="28" height="16" rx="9" />
              <circle class="assistant-robot-eye" cx="27" cy="33" r="2.6" />
              <circle class="assistant-robot-eye" cx="37" cy="33" r="2.6" />
              <path class="assistant-robot-smile" d="M27 43c3.1 2.7 7.1 2.7 10.2 0" />
              <circle class="assistant-robot-status" cx="44" cy="20" r="3" />
            </svg>
          </span>
        </span>
      `;
    }

    function sourceMetaParts(source = {}, adapter = {}) {
      if (adapter.id === "assistant") {
        return [
          source.threadTs ? `conversation ${source.threadTs}` : "",
          source.taskId,
        ].filter(Boolean);
      }
      return [
        source.channelId,
        source.threadTs ? `thread ${source.threadTs}` : "",
        source.taskId,
      ].filter(Boolean);
    }

    function isSourceMessageEvent(ev = {}) {
      return ev.kind === "source-message";
    }

    function isChannelMessageTrace(task, ev = {}) {
      if (ev.kind !== "entry") return false;
      return Boolean(TraceCore.isChannelMessageTrace?.(task, ev));
    }

    function extractTaskMessageText(task) {
      const prompt = String(task.prompt || "").trim();
      if (prompt) {
        const lines = prompt
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const last = lines[lines.length - 1] || "";
        if (last && !/^Handle this /.test(last) && !/^(Return|Do not use|Source channel|Thread|Requester):?/.test(last)) return last;
      }
      return task.title || "";
    }

    function slackUserAvatar(user) {
      const value = String(user || "").replace(/^U/i, "").slice(0, 2);
      return value || "U";
    }

    return {
      channelMessageSource,
      isChannelMessageTrace,
      isSourceMessageEvent,
      sourceChannelAdapter,
      sourceChannelType,
      sourceIcon,
      sourceMessageCard,
      sourceMessageTimelineItem,
      taskSourceMessage,
      taskSourceMessageEvent,
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
    createTaskTraceSourceView,
  };
});
