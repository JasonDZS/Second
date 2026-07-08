(function initSecondInboxView(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondInboxView = api;
  if (typeof window === "object") window.SecondInboxView = api;
  if (typeof globalThis === "object") globalThis.SecondInboxView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondInboxView() {
  "use strict";

  function createInboxView(deps = {}) {
    const {
      decisionStatus = () => ({ label: "未知", color: "currentColor" }),
      escapeAttr = escapeHtmlAttribute,
      escapeHtml = escapeHtmlText,
      relativeTime = () => "刚刚",
      riskClass = () => "tag",
    } = deps;
    const emptyPage = deps.emptyPage || ((title, message) => `
      <div class="page">
        <h1>${escapeHtml(title)}</h1>
        <div class="page-subtitle">${escapeHtml(message)}</div>
      </div>
    `);

    function render(state = {}, ui = {}) {
      const decisions = state.decisions || [];
      const selected = decisions.find((item) => item.id === ui.selectedDecision) || decisions[0];
      if (!selected) return emptyPage("决策收件箱", "暂无决策请求。");
      return `
        <div class="split">
          <div class="list-pane">
            <div class="pane-head">
              <div class="pane-title-row">
                <h1>决策收件箱</h1>
                <span class="pending-count">${state.metrics?.pendingDecisions || 0} 待决策</span>
              </div>
              <div class="pane-kicker">所有 agent 的决策请求,汇聚一处 · Decision MCP</div>
            </div>
            <div class="scroll-list">
              ${decisions.map((decision) => decisionCard(decision, ui)).join("")}
            </div>
          </div>
          <div class="detail-pane">${decisionDetail(selected, ui)}</div>
        </div>
      `;
    }

    function decisionCard(d = {}, ui = {}) {
      const st = decisionStatus(d);
      const active = d.id === ui.selectedDecision ? " active" : "";
      return `
        <button class="list-card${active}" data-action="select-decision" data-id="${escapeAttr(d.id)}">
          <div class="list-top">
            <span class="tag">${escapeHtml(d.type)}</span>
            <span class="pill ${riskClass(d.risk)}">${escapeHtml(d.risk)}风险</span>
            <span class="time-small">${relativeTime(d.createdAt)}</span>
          </div>
          <div class="list-title">${escapeHtml(d.title)}</div>
          <div class="list-meta">${escapeHtml(d.source)} → ${escapeHtml(d.agent)}</div>
          <div class="status-line">
            <span class="status-dot" style="background:${st.color}"></span>
            <span class="status-text" style="color:${st.color}">${escapeHtml(st.label)}</span>
          </div>
        </button>
      `;
    }

    function decisionDetail(d = {}, ui = {}) {
      const options = d.options || [];
      const pending = d.status === "pending";
      const selected = d.selectedOption || options[0]?.id;
      const option = options.find((item) => item.id === selected);
      return `
        <div class="content-narrow">
          <div class="detail-eyebrow">
            <span class="detail-id mono">${escapeHtml(d.id)}</span>
            <span class="tag">${escapeHtml(d.type)}</span>
            <span class="pill ${riskClass(d.risk)}">${escapeHtml(d.risk)}风险</span>
          </div>
          <h2 class="detail-title">${escapeHtml(d.title)}</h2>
          <div class="detail-meta">
            <span>链路&nbsp; <b>${escapeHtml(d.source)} → ${escapeHtml(d.agent)} → 本地 runtime</b></span>
            <span>任务&nbsp; <b>${escapeHtml(d.taskId)} · ${escapeHtml(d.taskTitle)}</b></span>
            <span>引擎&nbsp; <b>${escapeHtml(d.engine)}</b></span>
          </div>
          ${pending ? "" : `<div class="banner ${d.status === "rejected" ? "rejected" : ""}">${d.status === "approved" ? `✓ 已批准(${escapeHtml(option?.label || "")}) · 决策已回传,任务恢复执行` : "已拒绝 · 分身收到拒绝理由,将调整方案后重新请求或转人工"}</div>`}
          <section class="section-card first">
            <div class="section-label">背景 · 分身的说明</div>
            <p class="body-copy">${escapeHtml(d.summary)}</p>
          </section>
          <section class="section-card">
            <div class="section-label">影响范围</div>
            <div class="stack" style="margin-top:10px">
              ${(d.impact || []).map((item) => `<div class="code-chip mono">${escapeHtml(item)}</div>`).join("")}
            </div>
          </section>
          <section class="section-card">
            <div class="section-label">方案 · 点击选择</div>
            <div class="stack" style="margin-top:10px">
              ${options.map((op) => `
                <button class="option ${op.id === selected ? "active" : ""}" data-action="select-option" data-id="${escapeAttr(d.id)}" data-option="${escapeAttr(op.id)}" ${pending ? "" : "disabled"}>
                  <span class="radio-dot"></span>
                  <span style="flex:1">
                    <span class="option-title">${escapeHtml(op.label)}</span>
                    ${op.recommended ? `<span class="recommended">分身推荐</span>` : ""}
                    <span class="option-desc">${escapeHtml(op.description || "")}</span>
                  </span>
                </button>
              `).join("")}
            </div>
          </section>
          <section class="section-card artifact-row">
            <div class="section-label" style="width:100%">产物与证据链</div>
            ${(d.artifacts || []).map((item) => `<span class="artifact-chip mono">${escapeHtml(item.label || item)}</span>`).join("")}
            <button class="text-link" data-action="go-trace" data-task="${escapeAttr(d.taskId)}">查看完整 Trace →</button>
          </section>
          ${decisionReplyThread(d)}
          ${pending ? decisionReplyComposer(d, ui) : ""}
          ${pending ? `
            <div class="action-row">
              <button class="btn btn-primary" data-action="resolve-decision" data-id="${escapeAttr(d.id)}" data-verdict="approved">批准 · 恢复任务</button>
              <button class="btn btn-danger" data-action="resolve-decision" data-id="${escapeAttr(d.id)}" data-verdict="rejected">拒绝</button>
              <button class="btn-plain" data-action="prefill-decision-reply" data-id="${escapeAttr(d.id)}">需要更多信息</button>
              <span class="action-hint">决策将经 Decision MCP 回传,任务可恢复地继续执行</span>
            </div>
          ` : ""}
        </div>
      `;
    }

    function decisionReplyThread(decision = {}) {
      const replies = decision.replies || [];
      if (!replies.length) return "";
      return `
        <section class="section-card reply-thread-card">
          <div class="section-label">对话 · 补充信息</div>
          <div class="reply-thread">
            ${replies.map((reply = {}) => {
              const role = reply.role || "human";
              const label = role === "agent" ? "分身" : role === "system" ? "系统" : "你";
              return `
                <div class="reply-item ${escapeAttr(role)}">
                  <div class="reply-meta">
                    <span>${escapeHtml(reply.actor || label)}</span>
                    <span>${escapeHtml(relativeTime(reply.at))}</span>
                  </div>
                  <div class="reply-message">${escapeHtml(reply.message)}</div>
                </div>
              `;
            }).join("")}
          </div>
        </section>
      `;
    }

    function decisionReplyComposer(decision = {}, ui = {}) {
      const draft = ui.replyDrafts?.[decision.id] || "";
      const busy = ui.busy === `reply-${decision.id}`;
      return `
        <section class="section-card reply-compose-card">
          <div class="section-label">补充给分身</div>
          <div class="reply-compose">
            <textarea data-reply-field data-decision-id="${escapeAttr(decision.id)}" placeholder="例如: 请先说明影响订单的数量、回滚方式和不执行的风险。">${escapeHtml(draft)}</textarea>
            <div class="reply-compose-actions">
              <button class="btn" data-action="send-decision-reply" data-id="${escapeAttr(decision.id)}" ${busy ? "disabled" : ""}>${busy ? "发送中..." : "发送给分身"}</button>
              <span>不会批准或拒绝当前方案,只让分身补证据后回到这里。</span>
            </div>
          </div>
        </section>
      `;
    }

    return {
      decisionCard,
      decisionDetail,
      decisionReplyComposer,
      decisionReplyThread,
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
    createInboxView,
  };
});
