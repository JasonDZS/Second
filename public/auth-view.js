(function initSecondAuthView(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondAuthView = api;
  if (typeof window === "object") window.SecondAuthView = api;
  if (typeof globalThis === "object") globalThis.SecondAuthView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondAuthView() {
  "use strict";

  function createAuthView(deps = {}) {
    const {
      escapeAttr = escapeHtmlAttribute,
      escapeHtml = escapeHtmlText,
    } = deps;

    function render(state = {}) {
      return `
        <div class="page">
          <div class="content-wide">
            <h1 style="margin:0;font-size:18px;font-weight:700">授权与记忆 · 三层模型</h1>
            <div class="page-subtitle" style="max-width:640px">「用户通常喜欢什么」与「agent 被授权做什么」严格分层 —— 偏好可被学习,规则候选自动提取,长期授权必须由你显式确认后才生效。</div>
            <div class="auth-grid">
              <div class="column-card">
                <div class="column-head">
                  <div class="column-title">① 偏好 <span class="mono" style="font-size:10.5px;color:var(--faint);font-weight:600">PREFERENCES.md</span></div>
                  <div class="column-sub">可被学习与引用 · 不构成授权</div>
                </div>
                <div class="stack" style="padding:12px 14px">${(state.preferences || []).map((p) => memoryItem(p.text, p.source)).join("")}</div>
              </div>
              <div class="column-card candidate">
                <div class="column-head">
                  <div class="column-title">② 规则候选 <span class="mono" style="font-size:10.5px;color:#A8925A;font-weight:600">RULE_CANDIDATES</span></div>
                  <div class="column-sub" style="color:#A8925A">从重复任务与决策历史自动提取 · 等你确认</div>
                </div>
                <div class="stack" style="padding:12px 14px">${(state.candidates || []).map(candidateItem).join("")}</div>
              </div>
              <div class="column-card rules">
                <div class="column-head">
                  <div class="column-title">③ 授权规则 <span class="mono" style="font-size:10.5px;color:#5E8A6B;font-weight:600">AUTHORIZATION</span></div>
                  <div class="column-sub" style="color:#5E8A6B">经决策中心显式确认 · 越界即进 Human Gate</div>
                </div>
                <div class="stack" style="padding:12px 14px">${(state.rules || []).map(ruleItem).join("")}</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    function memoryItem(text, source) {
      return `
        <div class="memory-item">
          <div class="memory-text">${escapeHtml(text)}</div>
          <div class="memory-source">${escapeHtml(source)}</div>
        </div>
      `;
    }

    function candidateItem(c = {}) {
      const done = c.status !== "pending";
      return `
        <div class="memory-item" style="${c.status === "ignored" ? "opacity:.45" : ""}">
          <div>
            <span class="detail-id mono">${escapeHtml(c.id)}</span>
            <span class="pill risk-mid">置信 ${escapeHtml(c.confidence)}</span>
          </div>
          <div class="memory-text" style="margin-top:6px">${escapeHtml(c.text)}</div>
          <div class="memory-source">${escapeHtml(c.source)}</div>
          ${done ? `<div style="font-size:11px;font-weight:700;color:${c.status === "approved" ? "var(--green)" : "#98937F"};margin-top:8px">${c.status === "approved" ? "✓ 已确认 · 已生效为授权规则" : "已忽略 · 30 天后可重新提取"}</div>` : `
            <div style="display:flex;gap:7px;margin-top:9px">
              <button class="btn btn-primary" style="font-size:11px;padding:6px 11px;border-radius:6px" data-action="candidate" data-id="${escapeAttr(c.id)}" data-status="approved">确认为授权规则</button>
              <button class="btn" style="font-size:11px;padding:6px 11px;border-radius:6px" data-action="candidate" data-id="${escapeAttr(c.id)}" data-status="ignored">忽略</button>
            </div>
          `}
        </div>
      `;
    }

    function ruleItem(rule = {}) {
      const cls = rule.kind === "允许" ? "risk-low" : rule.kind === "强制 Gate" ? "risk-high" : "risk-high";
      return `
        <div class="memory-item" style="${rule.fresh ? "border-color:var(--accent)" : ""}">
          <div>
            <span class="pill ${cls}">${escapeHtml(rule.kind)}</span>
            ${rule.fresh ? `<span style="font-size:10px;font-weight:700;color:var(--accent);margin-left:6px">刚刚生效</span>` : ""}
          </div>
          <div class="memory-text" style="margin-top:6px">${escapeHtml(rule.text)}</div>
          <div class="memory-source">${escapeHtml(rule.source)}</div>
        </div>
      `;
    }

    return {
      candidateItem,
      memoryItem,
      render,
      ruleItem,
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
    createAuthView,
  };
});
