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

    function render(state = {}, ui = {}) {
      return `
        <div class="page">
          <div class="content-wide">
            <h1 style="margin:0;font-size:18px;font-weight:700">授权与记忆 · 三层模型</h1>
            <div class="page-subtitle" style="max-width:640px">「用户通常喜欢什么」与「agent 被授权做什么」严格分层 —— 偏好可被学习,规则候选自动提取,长期授权必须由你显式确认后才生效。</div>
            ${authorizationLab(state, ui)}
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

    function authorizationLab(state = {}, ui = {}) {
      const lab = ui.authLab || {};
      const input = lab.input || "rg TODO server";
      const result = lab.result || null;
      const recentAuth = (state.decisions || []).filter((decision) => decision.authorization).slice(0, 4);
      const grants = (state.authorization?.grants || []).slice(0, 5);
      return `
        <section class="column-card" style="margin:16px 0;border-color:#D8D1BD">
          <div class="column-head">
            <div class="column-title">Authorization Lab <span class="mono" style="font-size:10.5px;color:var(--faint);font-weight:600">/api/authorize dry-run</span></div>
            <div class="column-sub">由 daemon 返回 allow / gate / deny; 前端只提交样例并渲染结果。</div>
          </div>
          <div style="padding:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:14px">
            <div>
              <textarea data-auth-lab-field="input" spellcheck="false" style="width:100%;min-height:112px;resize:vertical;border:1px solid var(--line);border-radius:8px;padding:10px;font:12px/1.45 var(--mono);background:#FFFDF8;color:var(--ink)">${escapeHtml(input)}</textarea>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
                <button class="btn btn-primary" data-action="auth-lab-submit" style="font-size:11px;padding:7px 12px;border-radius:6px">测试授权</button>
                <button class="btn" data-action="auth-lab-example" data-example="allow" style="font-size:11px;padding:7px 10px;border-radius:6px">Allow 样例</button>
                <button class="btn" data-action="auth-lab-example" data-example="gate" style="font-size:11px;padding:7px 10px;border-radius:6px">Gate 样例</button>
                <button class="btn" data-action="auth-lab-example" data-example="deny" style="font-size:11px;padding:7px 10px;border-radius:6px">Deny 样例</button>
              </div>
              ${lab.error ? `<div class="memory-source" style="color:var(--red);margin-top:8px">${escapeHtml(lab.error)}</div>` : ""}
            </div>
            <div>
              ${result ? authorizationResult(result) : `<div class="memory-item"><div class="memory-text">尚未测试</div><div class="memory-source">输入命令或 raw JSON 后点击测试授权。</div></div>`}
            </div>
          </div>
          <div style="border-top:1px solid var(--line);padding:12px 14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:12px">
            <div>
              <div class="column-sub" style="margin-bottom:8px">最近授权决策</div>
              ${recentAuth.length ? recentAuth.map(authDecisionItem).join("") : `<div class="memory-source">暂无真实授权决策。</div>`}
            </div>
            <div>
              <div class="column-sub" style="margin-bottom:8px">Grant ledger</div>
              ${grants.length ? grants.map(grantItem).join("") : `<div class="memory-source">暂无 active / consumed grant。</div>`}
            </div>
          </div>
        </section>
      `;
    }

    function authorizationResult(result = {}) {
      const cls = result.action === "allow" ? "risk-low" : result.action === "gate" ? "risk-mid" : "risk-high";
      const intent = result.intent || {};
      return `
        <div class="memory-item" style="height:100%">
          <div><span class="pill ${cls}">${escapeHtml(result.action || "unknown")}</span></div>
          <div class="memory-text" style="margin-top:8px">${escapeHtml(result.reason || "")}</div>
          <div class="memory-source mono" style="margin-top:8px">rule ${escapeHtml(result.ruleId || "n/a")}</div>
          <div class="memory-source mono">fingerprint ${escapeHtml(result.fingerprint || "n/a")}</div>
          <div style="margin-top:10px;display:grid;gap:5px;font-size:11px">
            ${intentRow("action", intent.action)}
            ${intentRow("target", `${intent.target?.type || "unknown"}:${intent.target?.value || intent.target?.scope || "unknown"}`)}
            ${intentRow("env", intent.environment)}
            ${intentRow("reversible", intent.reversibility)}
            ${intentRow("identity", intent.identity)}
          </div>
          <div class="memory-source" style="margin-top:8px">${result.wouldCreateDecision ? "dry-run: 会创建 decision" : result.wouldConsumeGrant ? "dry-run: 会消耗 grant" : "dry-run: 不产生副作用"}</div>
        </div>
      `;
    }

    function intentRow(label, value) {
      return `<div style="display:flex;justify-content:space-between;gap:10px"><span class="memory-source">${escapeHtml(label)}</span><span class="mono">${escapeHtml(value || "unknown")}</span></div>`;
    }

    function authDecisionItem(decision = {}) {
      return `
        <div class="memory-item" style="padding:8px;margin-bottom:7px">
          <div><span class="detail-id mono">${escapeHtml(decision.id)}</span> <span class="pill ${decision.status === "pending" ? "risk-mid" : "risk-low"}">${escapeHtml(decision.status)}</span></div>
          <div class="memory-source mono" style="margin-top:5px">${escapeHtml(decision.authorization?.fingerprint || "")}</div>
        </div>
      `;
    }

    function grantItem(grant = {}) {
      const cls = grant.status === "active" ? "risk-low" : grant.status === "consumed" ? "risk-mid" : "risk-high";
      return `
        <div class="memory-item" style="padding:8px;margin-bottom:7px">
          <div><span class="detail-id mono">${escapeHtml(grant.id)}</span> <span class="pill ${cls}">${escapeHtml(grant.status)}</span></div>
          <div class="memory-source mono" style="margin-top:5px">${escapeHtml(grant.fingerprint || "")}</div>
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
