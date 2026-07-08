(function initSecondAssistantWidget(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondAssistantWidget = api;
  if (typeof window === "object") window.SecondAssistantWidget = api;
  if (typeof globalThis === "object") globalThis.SecondAssistantWidget = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondAssistantWidgetModule() {
  "use strict";

  const CHANNEL_ID = "assistant";
  const DEFAULT_CONVERSATION_ID = "local-assistant";
  const ACTIVE_STATUSES = new Set(["pending", "running", "resuming", "pending_resume"]);

  function createAssistantWidget(deps = {}) {
    const {
      escapeAttr = escapeHtmlAttribute,
      escapeHtml = escapeHtmlText,
      relativeTime = () => "",
    } = deps;

    function render(state = {}, ui = {}) {
      const open = Boolean(ui.assistantOpen);
      const messages = assistantConversationMessages(state, ui);
      const activeCount = assistantTasks(state).filter((task) => ACTIVE_STATUSES.has(task.status)).length;
      if (!open) {
        return `
          <button class="assistant-launcher" data-action="assistant-toggle" aria-label="打开对话助手">
            ${robotMark()}
            ${activeCount ? `<span class="assistant-launcher-badge">${activeCount}</span>` : ""}
          </button>
        `;
      }

      return `
        <section class="assistant-panel" aria-label="对话助手">
          <div class="assistant-panel-head">
            ${robotMark("assistant-robot-small")}
            <div class="assistant-head-copy">
              <div class="assistant-title">对话助手</div>
              <div class="assistant-subtitle">${activeCount ? `${activeCount} 条处理中` : "本地 daemon"}</div>
            </div>
            <button class="assistant-head-btn" data-action="assistant-toggle" aria-label="折叠对话助手">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 15 12 9 6 15"></path></svg>
            </button>
          </div>

          <div class="assistant-message-list" role="log" aria-live="polite">
            ${messages.length ? messages.map(messageBubble).join("") : emptyState()}
          </div>

          <div class="assistant-compose">
            <textarea
              data-assistant-field="draft"
              rows="3"
              maxlength="12000"
              placeholder="发送给本地 daemon"
            >${escapeHtml(ui.assistantDraft || "")}</textarea>
            <button class="assistant-send-btn" data-action="assistant-send" ${ui.busy === "assistant-send" ? "disabled" : ""} aria-label="发送">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4 20-7z"></path><path d="M22 2 11 13"></path></svg>
            </button>
          </div>
        </section>
      `;
    }

    function emptyState() {
      return `
        <div class="assistant-empty">
          ${robotMark("assistant-empty-robot")}
          <div>还没有对话</div>
        </div>
      `;
    }

    function messageBubble(message) {
      const role = message.role === "user" ? "user" : "assistant";
      const statusClass = message.status === "failed" ? " failed" : message.pending ? " pending" : "";
      const meta = [message.actor, message.at ? relativeTime(message.at) : ""].filter(Boolean).join(" · ");
      return `
        <article class="assistant-message ${role}${statusClass}">
          <div class="assistant-message-meta">${escapeHtml(meta)}</div>
          <div class="assistant-message-text">${renderAssistantMarkdown(message.text || "")}</div>
        </article>
      `;
    }

    function robotMark(extraClass = "") {
      return `
        <span class="assistant-robot ${escapeAttr(extraClass)}" aria-hidden="true">
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
      `;
    }

    return {
      render,
    };
  }

  function assistantConversationMessages(state = {}, ui = {}) {
    const conversationId = ui.assistantConversationId || state.assistant?.activeConversationId || DEFAULT_CONVERSATION_ID;
    const stored = (state.assistant?.messages || [])
      .filter((message) => (message.conversationId || DEFAULT_CONVERSATION_ID) === conversationId)
      .slice()
      .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
    const tasks = assistantTasks(state);
    const repliesByUserMessage = new Set(
      stored
        .filter((message) => message.role !== "user" && message.inReplyTo)
        .map((message) => message.inReplyTo),
    );
    const output = [];
    for (const message of stored) {
      output.push(message);
      if (message.role !== "user" || repliesByUserMessage.has(message.id)) continue;
      const task = taskForAssistantMessage(tasks, message);
      const status = pendingStatusMessage(task, message);
      if (status) output.push(status);
    }
    return output;
  }

  function assistantTasks(state = {}) {
    return (state.tasks || []).filter((task) => task.channel?.id === CHANNEL_ID);
  }

  function taskForAssistantMessage(tasks = [], message = {}) {
    return tasks.find((task) => task.channel?.external?.messageId === message.id)
      || tasks.find((task) => task.lastResumeRequest?.external?.messageId === message.id)
      || tasks.find((task) => (task.channelFollowups || []).some((followup) => followup.external?.messageId === message.id))
      || null;
  }

  function pendingStatusMessage(task, message) {
    if (!task) return null;
    if (task.status === "done") return null;
    const failed = ["failed", "stopped"].includes(task.status);
    const needsHuman = task.status === "needs_human";
    return {
      id: `status-${message.id}`,
      role: "assistant",
      actor: task.agent || "Second",
      at: task.completedAt || task.startedAt || task.createdAt || message.at,
      text: failed || needsHuman ? task.summary || statusText(task) : statusText(task),
      status: failed ? "failed" : task.status,
      pending: !failed,
    };
  }

  function statusText(task = {}) {
    if (task.status === "pending") return "daemon 已接收,等待派发。";
    if (task.status === "running") return `${task.agent || "分身"}正在处理...`;
    if (task.status === "resuming") return `${task.agent || "分身"}正在继续处理...`;
    if (task.status === "pending_resume") return "已收到,等待同一会话恢复。";
    if (task.status === "needs_human") return "需要你在收件箱处理决策。";
    if (task.status === "failed") return task.summary || "处理失败。";
    if (task.status === "stopped") return "任务已停止。";
    return task.summary || "正在处理...";
  }

  function renderAssistantMarkdown(value) {
    const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
    const html = [];
    let paragraph = [];
    let list = null;
    let code = null;

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(`<p>${paragraph.map(renderInlineMarkdown).join("<br>")}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (!list) return;
      html.push(`<${list.type}>${list.items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${list.type}>`);
      list = null;
    };
    const pushListItem = (type, text) => {
      flushParagraph();
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(text);
    };

    for (const line of lines) {
      const fence = line.match(/^\s*```/);
      if (fence) {
        if (code) {
          html.push(`<pre><code>${escapeHtmlText(code.lines.join("\n"))}</code></pre>`);
          code = null;
        } else {
          flushParagraph();
          flushList();
          code = { lines: [] };
        }
        continue;
      }
      if (code) {
        code.lines.push(line);
        continue;
      }

      if (!line.trim()) {
        flushParagraph();
        flushList();
        continue;
      }

      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        const level = Math.min(3, heading[1].length);
        html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }

      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      if (bullet) {
        pushListItem("ul", bullet[1]);
        continue;
      }

      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (ordered) {
        pushListItem("ol", ordered[1]);
        continue;
      }

      flushList();
      paragraph.push(line);
    }

    if (code) html.push(`<pre><code>${escapeHtmlText(code.lines.join("\n"))}</code></pre>`);
    flushParagraph();
    flushList();
    return html.join("");
  }

  function renderInlineMarkdown(value) {
    const codes = [];
    const tokenized = String(value || "").replace(/`([^`\n]+)`/g, (_match, code) => {
      const token = `\u0000CODE${codes.length}\u0000`;
      codes.push(`<code>${escapeHtmlText(code)}</code>`);
      return token;
    });
    let html = escapeHtmlText(tokenized);
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\b__([^_\n]+)__\b/g, "<strong>$1</strong>");
    html = html.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => codes[Number(index)] || "");
    return html;
  }

  function assistantSignature(state = {}) {
    return {
      activeConversationId: state.assistant?.activeConversationId || DEFAULT_CONVERSATION_ID,
      messages: (state.assistant?.messages || []).map((message) => ({
        id: message.id,
        role: message.role,
        at: message.at,
        text: message.text,
        status: message.status,
        taskId: message.taskId,
        inReplyTo: message.inReplyTo,
        conversationId: message.conversationId,
      })),
      tasks: assistantTasks(state).map((task) => ({
        id: task.id,
        status: task.status,
        summary: task.summary,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        messageId: task.channel?.external?.messageId,
        resumeMessageId: task.lastResumeRequest?.external?.messageId,
        followups: (task.channelFollowups || []).map((followup) => followup.external?.messageId),
      })),
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
    assistantConversationMessages,
    assistantSignature,
    assistantTasks,
    createAssistantWidget,
    renderAssistantMarkdown,
    renderInlineMarkdown,
    statusText,
  };
});
