(function initSecondTaskTraceView(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondTaskTraceView = api;
  if (typeof window === "object") window.SecondTaskTraceView = api;
  if (typeof globalThis === "object") globalThis.SecondTaskTraceView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondTaskTraceView() {
  "use strict";

  function createTaskTraceView(deps = {}) {
    const {
      PRODUCT_NAME = "Second",
      TraceCore = {},
      DEFAULT_SOURCE_CHANNEL = TraceCore.DEFAULT_SOURCE_CHANNEL || {},
      actorStyle = () => ({ label: "事件", color: "inherit", bg: "transparent" }),
      escapeAttr = escapeHtmlAttribute,
      escapeHtml = escapeHtmlText,
      emptyPage = (title, message) => `<div class="page"><h1>${escapeHtml(title)}</h1><div class="page-subtitle">${escapeHtml(message)}</div></div>`,
      eventKindClass = () => "",
      normalizeExec = (exec) => Array.isArray(exec) ? exec : [],
      relativeTime = () => "刚刚",
      agentView = {},
      sourceView = {},
      taskStatus = () => ({ label: "未知", cls: "tag" }),
      traceFormat = {},
      toolColor = () => "inherit",
    } = deps;
    const sanitizeTraceText = traceFormat.sanitizeTraceText || ((text) => String(text || "").trim());
    const sanitizeTraceMeta = traceFormat.sanitizeTraceMeta || ((meta) => sanitizeTraceText(meta));
    let state = null;
    let ui = null;

    function render(nextState = {}, nextUi = {}) {
      state = nextState;
      ui = nextUi;
      return tasksView();
    }

  function tasksView() {
    const tasks = state.tasks;
    const selected = tasks.find((item) => item.id === ui.selectedTask) || tasks[0];
    if (!selected) return emptyPage("任务与 Trace", "暂无任务。");
    return `
      <div class="split">
        <div class="list-pane task-list-pane">
          <div class="pane-head">
            <h1>任务与 Trace</h1>
            <div class="pane-kicker">从入口到回传的完整血缘,跟着 agent 走</div>
          </div>
          <div class="scroll-list">
            ${tasks.map(taskCard).join("")}
          </div>
        </div>
        <div class="detail-pane">${taskDetail(selected)}</div>
      </div>
    `;
  }

  function taskCard(t) {
    const st = taskStatus(t);
    const active = t.id === ui.selectedTask ? " active" : "";
    return `
      <button class="list-card${active}" data-action="select-task" data-id="${escapeAttr(t.id)}">
        <div class="list-top">
          <span class="detail-id mono">${escapeHtml(t.id)}</span>
          <span style="flex:1"></span>
          <span class="pill ${st.cls}">${st.label}</span>
        </div>
        <div class="list-title">${escapeHtml(t.title)}</div>
        <div class="list-meta">${escapeHtml(t.source)} · ${escapeHtml(t.agent)}</div>
      </button>
    `;
  }

  function taskDetail(task) {
    const st = taskStatus(task);
    const canArchive = !["running", "resuming"].includes(task.status);
    const canResume = ["paused", "pending_resume"].includes(task.status) && task.codexSessionId;
    const segments = taskTimelineSegments(task);
    const liveIndex = liveTimelineSegmentIndex(task, segments);
    return `
      <div class="content-narrow">
        <div class="trace-head">
          <div style="flex:1">
            <div class="detail-eyebrow">
              <span class="detail-id mono">${escapeHtml(task.id)}</span>
              <span class="pill ${st.cls}">${st.label}</span>
            </div>
            <h2 class="detail-title">${escapeHtml(task.title)}</h2>
            <div class="pane-kicker">${escapeHtml(task.source)} 发起 · ${escapeHtml(task.agent)} 执行</div>
            ${agentEventStats(task)}
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
            ${task.status === "pending" ? `<button class="btn" data-action="run-task" data-id="${escapeAttr(task.id)}">交给${escapeHtml(task.agent)}</button>` : ""}
            ${canResume ? `<button class="btn btn-primary" data-action="resume-task" data-id="${escapeAttr(task.id)}">从最近恢复点继续</button>` : ""}
            <button class="btn" data-action="archive-task" data-id="${escapeAttr(task.id)}" ${canArchive ? "" : "disabled"}>归档任务</button>
          </div>
        </div>
        <div class="timeline">
          ${segments.map((segment, index) => {
            const live = index === liveIndex;
            if (segment.type === "agent-bundle") return agentRuntimeBundle(task, segment, index, segments.length, live);
            return timelineItem(task, segment.event, index, segments.length, live);
          }).join("")}
        </div>
      </div>
    `;
  }

  function timelineItem(task, ev, index, total = (task.trace || []).length, live = false) {
    if (sourceView.isSourceMessageEvent?.(ev) || sourceView.isChannelMessageTrace?.(task, ev)) {
      return sourceView.sourceMessageTimelineItem(task, ev, index, total, live);
    }
    const display = displayTraceEvent(ev, task);
    const actor = traceActorStyle(task, ev);
    const execKey = `${task.id}-${index}`;
    const open = Boolean(ui.execOpen[execKey]);
    const exec = normalizeExec(ev.exec);
    return `
      <div class="timeline-item ${live ? "live" : ""}">
        <div class="timeline-rail">
          <div class="timeline-dot" style="background:${actor.color}"></div>
          ${index < total - 1 ? `<div class="timeline-line"></div>` : ""}
        </div>
        <div class="timeline-body">
          <div class="actor-row">
            <span class="pill" style="color:${actor.color};background:${actor.bg}">${escapeHtml(traceActorLabel(task, ev, actor))}</span>
            <span class="time-small mono" style="margin-left:0">${escapeHtml(ev.time || "刚刚")}</span>
          </div>
          <div class="trace-title">${escapeHtml(display.title || ev.kind)}</div>
          ${display.description ? `<div class="trace-desc">${escapeHtml(display.description)}</div>` : ""}
          ${display.meta ? `<div class="code-chip mono" style="display:inline-block;margin-top:7px">${escapeHtml(display.meta)}</div>` : ""}
          ${ev.decisionId ? `<div><button class="text-link" data-action="open-decision" data-id="${escapeAttr(ev.decisionId)}">打开决策 ${escapeHtml(ev.decisionId)} →</button></div>` : ""}
          ${exec.length ? `
            <button class="btn" style="margin-top:8px;padding:5px 10px;font-size:12px" data-action="toggle-exec" data-key="${escapeAttr(execKey)}">
              <span class="chev ${open ? "open" : ""}">▶</span> ${open ? "收起执行过程" : `展开执行过程 · ${exec.length} 步`}
            </button>
            ${open ? execBox(task, exec) : ""}
          ` : ""}
        </div>
      </div>
    `;
  }

  function execBox(task, exec) {
    return `
      <div class="exec-box">
        <div class="exec-head">
          <span class="online-dot"></span>
          <span class="mono" style="font-size:10.5px;color:rgba(233,228,218,.55)">${escapeHtml(task.agent || "分身")} · 执行过程</span>
        </div>
        <div class="exec-steps">
          ${exec.map((step) => `
            <div class="exec-step">
              <span class="exec-step-time mono">${escapeHtml(step.time)}</span>
              <span class="exec-tool mono" style="color:${toolColor(step.tool)}">${escapeHtml(step.tool)}</span>
              <span class="exec-text mono">${escapeHtml(step.text)}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function traceActorLabel(task, ev = {}, actor = {}) {
    const raw = String(ev.actor || "");
    if (ev.kind === "runtime" || raw === "Codex CLI" || raw === `${PRODUCT_NAME} daemon`) return task.agent || actor.label || "分身";
    if (ev.kind === "agent") return task.agent || raw || actor.label || "分身";
    return raw || actor.label || "事件";
  }

  function traceActorStyle(task, ev = {}) {
    const base = actorStyle(ev.kind);
    return traceActorLabel(task, ev, base) === (task.agent || "分身") ? actorStyle("agent") : base;
  }

  function liveTimelineSegmentIndex(task, segments = []) {
    if (!["running", "resuming"].includes(task.status)) return -1;
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index];
      if (segment?.type === "agent-bundle" && segment.events?.length) return index;
      if (segment?.type === "trace") return index;
    }
    return -1;
  }

  function displayTraceEvent(ev = {}, task = {}) {
    const agent = task.agent || "分身";
    const title = String(ev.title || ev.kind || "");
    const kind = String(ev.kind || "");
    const lowerTitle = title.toLowerCase();
    if (title === "任务创建") {
      return {
        title,
        description: sanitizeTraceText(ev.description || `控制台创建本地任务,准备派发给${agent}。`),
        meta: sanitizeTraceMeta(ev.meta || ""),
      };
    }
    if (kind === "runtime" && lowerTitle.includes("codex exec resume")) {
      return {
        title: `${agent}继续执行`,
        description: "Human Gate 已完成审核,正在恢复同一会话。",
        meta: "",
      };
    }
    if (kind === "runtime" && lowerTitle.includes("codex exec")) {
      return {
        title: `${agent}开始执行`,
        description: `${agent}已接管任务。`,
        meta: "",
      };
    }
    if (/捕获可恢复|session/i.test(title)) {
      return {
        title: "可恢复会话已建立",
        description: `${PRODUCT_NAME} 已保存恢复点,后续可在 Human Gate 审核后继续执行。`,
        meta: "",
      };
    }
    if (kind === "decision" && /已批准/.test(title)) {
      return {
        title,
        description: `决策已回传,${agent}将继续执行。`,
        meta: "",
      };
    }
    if (kind === "out" && /执行完成|执行结束/.test(title)) {
      return {
        title,
        description: "执行结果已保存,trace 已保留。",
        meta: "",
      };
    }
    return {
      title,
      description: sanitizeTraceText(ev.description || ""),
      meta: sanitizeTraceMeta(ev.meta || ""),
    };
  }

  function displayEventLogText(event = {}) {
    const type = String(event.type || "");
    if (type === "codex.start") return ["codex.start", event.taskId].filter(Boolean).join(" ");
    if (type === "codex.resume.start") return ["codex.resume.start", event.taskId].filter(Boolean).join(" ");
    if (type === "codex.session") return ["codex.session.ready", event.taskId].filter(Boolean).join(" ");
    return sanitizeTraceText(event.text || type);
  }

  function taskTimelineSegments(task) {
    const trace = task.trace || [];
    return TraceCore.taskTimelineSegments(task, {
      sourceEvent: sourceView.taskSourceMessageEvent?.(task) || null,
      preludeEvents: taskPreludeEvents(task, trace),
    });
  }

  function taskPreludeEvents(task, trace) {
    const events = [];
    const hasCreated = trace.some((event) => event.title === "任务创建");
    const hasStarted = trace.some((event) => /分身开始执行|codex exec/i.test(String(event.title || "")));
    const createdLog = taskEventLog(task, "task.created");
    const startedLog = taskEventLog(task, "codex.start");
    const actor = taskEntryActor(task);
    if (!hasCreated && (createdLog || task.startedAt || task.createdAt)) {
      events.push({
        kind: "entry",
        actor,
        time: taskEventTime(createdLog, task.createdAt || task.startedAt),
        title: "任务创建",
        description: `${actor} 创建任务,准备派发给${task.agent || "分身"}。`,
        meta: task.workspaceMode || "",
      });
    }
    if (!hasStarted && (startedLog || task.startedAt)) {
      events.push({
        kind: "runtime",
        actor: task.agent || "分身",
        time: taskEventTime(startedLog, task.startedAt),
        title: "分身开始执行",
        description: `${task.agent || "分身"}已接管任务。`,
      });
    }
    return events;
  }

  function taskEventLog(task, type) {
    return (state?.events || []).find((event) => event.taskId === task.id && event.type === type) || null;
  }

  function taskEventTime(event, fallbackIso) {
    const iso = event?.at || fallbackIso || "";
    return iso ? relativeTime(iso) : "刚刚";
  }

  function taskEntryActor(task) {
    return task.channel?.name || task.source || "localhost console";
  }

  function agentEventsForTask(task) {
    return agentView.agentEventsForTask?.(task) || TraceCore.agentEventsForTask?.(task) || [];
  }

  function agentEventStats(task) {
    return agentView.agentEventStats?.(task) || "";
  }

  function agentRuntimeBundle(task, segment, index, total, live = false) {
    return agentView.agentRuntimeBundle?.(task, segment, index, total, live) || "";
  }

    return {
      agentEventsForTask,
      displayEventLogText,
      displayTraceEvent,
      render,
      sanitizeTraceText,
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
    createTaskTraceView,
  };
});
