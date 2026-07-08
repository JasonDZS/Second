(function initSecondRuntimeView(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondRuntimeView = api;
  if (typeof window === "object") window.SecondRuntimeView = api;
  if (typeof globalThis === "object") globalThis.SecondRuntimeView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondRuntimeView() {
  "use strict";

  const RUNNING_STATUSES = ["running", "needs_human", "paused", "pending", "pending_resume", "resuming"];

  function createRuntimeView(deps = {}) {
    const {
      PRODUCT_NAME = "Second",
      agentEventsForTask = () => [],
      displayEventLogText = (event = {}) => event.text || event.type || "",
      displayTraceEvent = (event = {}) => event,
      escapeAttr = escapeHtmlAttribute,
      escapeHtml = escapeHtmlText,
      eventColor = () => "inherit",
      eventKindClass = () => "",
      relativeTime = () => "刚刚",
      shortKind = (kind) => kind || "",
      taskStatus = () => ({ label: "未知", cls: "tag" }),
      uptime = () => "",
    } = deps;

    function render(state = {}, ui = {}) {
      const running = (state.tasks || []).filter((task) => RUNNING_STATUSES.includes(task.status));
      const codex = (state.engines || []).find((engine) => engine.id === "codex");
      const highRisk = (state.decisions || []).filter((decision) => decision.risk === "高").length;
      const archivedTasks = state.archived?.tasks || 0;
      const archivedDecisions = state.archived?.decisions || 0;
      return `
        <div class="page">
          <div class="content-med">
            <div class="page-head">
              <div style="flex:1">
                <h1>运行时 · 玻璃机房</h1>
                <div class="page-subtitle">本地 daemon 正在做什么、动了哪些文件,实时可见、随时可停</div>
              </div>
              <button class="btn btn-danger soft" data-action="stop-all">紧急全停</button>
            </div>
            <div class="grid-3">
              <div class="metric-card">
                <div class="metric-title">DAEMON</div>
                <div class="metric-value"><span class="online-dot"></span>在线</div>
                <div class="metric-sub">uptime ${escapeHtml(uptime(state.daemon?.startedAt))} · heartbeat 刚刚<br>${PRODUCT_NAME} daemon v${escapeHtml(state.daemon?.version)} · localhost:${state.daemon?.port || ""}</div>
              </div>
              <div class="metric-card">
                <div class="metric-title">执行分身</div>
                <div style="font-size:13px;font-weight:650;margin-top:9px">${escapeHtml(state.profile?.agentName || "分身")} <span class="pill ${codex?.status === "ok" ? "risk-low" : "risk-mid"}">${codex?.status === "ok" ? "已连接" : "待检测"}</span></div>
                <div class="metric-sub">本地执行器已连接 · 当前任务由分身执行</div>
              </div>
              <div class="metric-card">
                <div class="metric-title">今日</div>
                <div class="stat-row">
                  <div><div class="stat-number">${(state.tasks || []).length}</div><div class="stat-label">任务</div></div>
                  <div><div class="stat-number">${(state.decisions || []).length}</div><div class="stat-label">决策</div></div>
                  <div><div class="stat-number" style="color:var(--red)">${highRisk}</div><div class="stat-label">越权拦截</div></div>
                </div>
                <div class="metric-sub">零中转率 ${state.metrics?.zeroHandoffRate || 0}% · 决策延迟中位数 ${state.metrics?.medianDecisionLatency || "-"} · 打扰密度 ${state.metrics?.decisionInterruptionDensity || 0}${archivedTasks || archivedDecisions ? ` · 已归档 ${archivedTasks} 任务 / ${archivedDecisions} 决策` : ""}</div>
              </div>
            </div>

            ${taskLauncher(state, ui, codex)}

            <div class="table-card">
              <div class="table-head">
                <span class="section-label">正在运行的任务</span>
                <span class="table-sub">点击行查看执行状态与最近事件</span>
              </div>
              ${running.map((task) => runtimeRow(task, ui)).join("") || `<div style="padding:18px;color:var(--muted);font-size:13px">暂无运行中的任务。</div>`}
            </div>
            <div class="grid-2">
              <div class="metric-card">
                <div class="section-label">文件活动</div>
                <div class="stack" style="margin-top:10px">${fileActivity(state).join("")}</div>
              </div>
              <div class="metric-card dark-log">
                <div class="section-label">事件日志</div>
                <div class="log-lines mono">${(state.events || []).slice(0, 7).map((event) => `<div style="color:${eventColor(event.type)}">${escapeHtml(displayEventLogText(event))}</div>`).join("")}</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    function taskLauncher(state, ui, codex) {
      const disabled = codex?.status !== "ok";
      return `
        <section class="task-launcher">
          <div class="section-label">本地分身执行单元</div>
          <div class="page-subtitle">提交后 ${PRODUCT_NAME} 会创建本地 run 目录,由${escapeHtml(state.profile?.agentName || "分身")}执行并回传 trace 与最终输出。</div>
          <div class="launcher-grid">
            <div class="field">
              <label>任务</label>
              <textarea data-field="taskPrompt" placeholder="例如: 在当前 workspace 生成一个 README 小结">${escapeHtml(ui.taskPrompt)}</textarea>
            </div>
            <div class="field">
              <label>WORKSPACE(可选)</label>
              <input data-field="taskWorkspace" value="${escapeAttr(ui.taskWorkspace)}" placeholder="默认 .second/runs/..." />
            </div>
            <button class="btn btn-primary" data-action="create-task" ${disabled || ui.busy ? "disabled" : ""}>创建并运行</button>
          </div>
          ${disabled ? `<div class="metric-sub" style="color:var(--amber)">本地分身执行器尚未通过探针。先到设置页或点击“全部重新检测”。</div>` : ""}
        </section>
      `;
    }

    function runtimeRow(task, ui) {
      const st = taskStatus(task);
      const open = Boolean(ui.sessionOpen?.[task.id]);
      const events = (task.trace || []).slice(-8).reverse();
      const agentEvents = agentEventsForTask(task);
      return `
        <div class="run-row">
          <div class="run-summary ${open ? "open" : ""}">
            <button class="btn-plain" data-action="toggle-session" data-id="${escapeAttr(task.id)}" style="padding:0"><span class="chev ${open ? "open" : ""}">▶</span></button>
            <div style="flex:1;min-width:0">
              <div class="run-title">${escapeHtml(task.id)} · ${escapeHtml(task.title)}</div>
              <div class="run-meta mono">${escapeHtml(task.agent || "分身")} · ${escapeHtml(st.label)}${agentEvents.length ? ` · ${agentEvents.length} 条 agent 事件` : ""}</div>
            </div>
            <span class="pill ${st.cls}">${st.label}</span>
            <span class="run-meta mono" style="flex:none">${escapeHtml(task.fileDelta || "0 文件")}</span>
            ${task.status === "pending" ? `<button class="btn" data-action="run-task" data-id="${escapeAttr(task.id)}">运行</button>` : ""}
            ${task.status === "running" ? `<button class="btn" data-action="pause-task" data-id="${escapeAttr(task.id)}" data-paused="true">暂停</button>` : ""}
            ${task.status === "paused" || task.status === "pending_resume" ? `<button class="btn" data-action="resume-task" data-id="${escapeAttr(task.id)}">继续</button>` : ""}
            <button class="btn btn-danger" data-action="stop-task" data-id="${escapeAttr(task.id)}">停止</button>
          </div>
          ${open ? `
            <div class="session-panel">
              <div class="session-head">
                <span class="online-dot"></span>
                <span class="mono" style="font-size:11.5px;font-weight:700">${escapeHtml(String(task.id || "").toLowerCase())}</span>
                <span class="pill ${st.cls}">${st.label}</span>
                <span style="flex:1"></span>
                <span style="font-size:10.5px;color:var(--faint)">运行详情</span>
              </div>
              <div class="session-grid">
                ${sessionMeta(task).map((item) => `
                  <div>
                    <div class="tiny-label">${escapeHtml(item.k)}</div>
                    <div class="tiny-value mono">${escapeHtml(item.v)}</div>
                  </div>
                `).join("")}
              </div>
              <div style="padding:11px 14px 13px">
                <div class="tiny-label">历史事件 · ${events.length} 条</div>
                <div class="event-lines" style="margin-top:8px">
                ${events.map((event) => {
                  const display = displayTraceEvent(event, task);
                  return `
                    <div class="event-line">
                      <span class="event-time mono">${escapeHtml(event.time || "刚刚")}</span>
                      <span class="event-kind ${eventKindClass(event.kind)}">${escapeHtml(shortKind(event.kind))}</span>
                      <span class="event-text mono">${escapeHtml(display.title || display.description || event.kind)}</span>
                    </div>
                  `;
                }).join("")}
                </div>
              </div>
            </div>
          ` : ""}
        </div>
      `;
    }

    function fileActivity(state) {
      const rows = [];
      for (const task of (state.tasks || []).filter((item) => !item.archivedAt).slice(0, 5)) {
        for (const artifact of task.artifacts || []) {
          rows.push({ op: "写入", path: artifact.path || artifact.label || artifact, run: task.id, kind: "w" });
        }
        if (!task.artifacts?.length) {
          rows.push({
            op: task.status === "needs_human" ? "拦截" : "读取",
            path: task.summary,
            run: task.id,
            kind: task.status === "needs_human" ? "x" : "r",
          });
        }
      }
      return rows.slice(0, 5).map((row) => {
        const cls = row.kind === "w" ? "risk-mid" : row.kind === "x" ? "risk-high" : "tag";
        return `
          <div class="file-row mono">
            <span class="pill ${cls}" style="font-size:10px;padding:1.5px 6px">${escapeHtml(row.op)}</span>
            <span class="file-path">${escapeHtml(row.path)}</span>
            <span style="flex:1"></span>
            <span style="color:var(--faint);flex:none">${escapeHtml(row.run)}</span>
          </div>
        `;
      });
    }

    function sessionMeta(task) {
      const st = taskStatus(task);
      const agentCount = agentEventsForTask(task).length;
      return [
        { k: "任务编号", v: task.id },
        { k: "执行分身", v: task.agent || "分身" },
        { k: "启动时间", v: relativeTime(task.startedAt) },
        { k: "运行状态", v: st.label },
        { k: "Agent 事件", v: agentCount ? `${agentCount} 条` : "等待事件" },
        { k: "Human Gate", v: task.decisionId ? "等待或已完成审核" : "未触发" },
        { k: "结果产物", v: task.outputFile ? "已生成" : "未生成" },
      ];
    }

    return {
      render,
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
    RUNNING_STATUSES,
    createRuntimeView,
  };
});
