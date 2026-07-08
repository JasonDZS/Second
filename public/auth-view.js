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
            ${authorizationManagement(state, ui)}
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

    function authorizationManagement(state = {}, ui = {}) {
      const overview = ui.authOverview || localAuthorizationOverview(state);
      const policy = overview.policy || {};
      const grants = overview.grants?.items || state.authorization?.grants || [];
      const decisions = overview.decisions?.recent || (state.decisions || []).filter((decision) => decision.authorization).slice(0, 20);
      const audit = ui.authAudit || overview.audit || state.authorization?.audit || [];
      return `
        <section class="column-card" style="margin:16px 0;border-color:#C8D6D0">
          <div class="column-head" style="align-items:flex-start">
            <div>
              <div class="column-title">授权控制台 <span class="mono" style="font-size:10.5px;color:var(--faint);font-weight:600">daemon managed</span></div>
              <div class="column-sub">查看有效规则、授权凭证、决策历史与审计日志; 管理动作由 daemon 执行并写审计。</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn" data-action="auth-overview-refresh" style="font-size:11px;padding:7px 10px;border-radius:6px">刷新授权状态</button>
              <button class="btn" data-action="auth-audit-refresh" style="font-size:11px;padding:7px 10px;border-radius:6px">刷新审计</button>
              <button class="btn" data-action="candidates-extract" style="font-size:11px;padding:7px 10px;border-radius:6px">提取规则候选</button>
            </div>
          </div>
          ${authSummaryGrid(overview)}
          <div style="padding:0 14px 14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:12px">
            ${policyPanel(policy)}
            ${grantPanel(grants)}
            ${decisionPanel(decisions)}
            ${auditPanel(audit)}
          </div>
        </section>
      `;
    }

    function authSummaryGrid(overview = {}) {
      const policy = overview.policy || {};
      const grants = overview.grants || {};
      const decisions = overview.decisions || {};
      const audit = overview.audit || [];
      return `
        <div style="padding:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(160px,100%),1fr));gap:10px">
          ${summaryCard("Policy", policy.failedClosed ? "fail-closed" : "loaded", policy.source || "state snapshot", policy.failedClosed ? "risk-high" : "risk-low")}
          ${summaryCard("Unknown", policy.defaults?.unknown_action || "gate", "默认未识别动作处理", policy.defaults?.unknown_action === "deny" ? "risk-high" : "risk-mid")}
          ${summaryCard("Rules", `${policy.counts?.allow || 0}/${policy.counts?.gate || 0}/${policy.counts?.deny || 0}`, "allow / gate / deny", "risk-low")}
          ${summaryCard("Grants", `${grants.active || 0} active`, `${grants.total || 0} total · ${grants.revoked || 0} revoked`, grants.active ? "risk-mid" : "risk-low")}
          ${summaryCard("Decisions", `${decisions.pending || 0} pending`, `${decisions.total || 0} authorization decisions`, decisions.pending ? "risk-mid" : "risk-low")}
          ${summaryCard("Audit", `${audit.length || 0} shown`, "最近授权事件", "risk-low")}
        </div>
      `;
    }

    function summaryCard(label, value, meta, cls) {
      return `
        <div class="memory-item" style="padding:10px 11px">
          <div class="memory-source">${escapeHtml(label)}</div>
          <div style="margin-top:5px"><span class="pill ${cls}">${escapeHtml(value)}</span></div>
          <div class="memory-source" style="margin-top:6px">${escapeHtml(meta || "")}</div>
        </div>
      `;
    }

    function policyPanel(policy = {}) {
      const rules = policy.rules || null;
      return `
        <div class="memory-item" style="padding:12px">
          <div class="memory-text" style="font-weight:800">有效规则</div>
          <div class="memory-source mono" style="margin-top:4px">${escapeHtml(policy.source || "点击刷新授权状态读取 AUTHORIZATION.yml")}</div>
          ${policy.failedClosed ? `<div class="memory-source" style="color:var(--red);margin-top:7px">${escapeHtml(policy.error || "policy failed closed")}</div>` : ""}
          ${rules ? `
            ${ruleGroup("Allow", rules.allow || [], "risk-low")}
            ${ruleGroup("Gate", rules.gate || [], "risk-mid")}
            ${ruleGroup("Deny", rules.deny || [], "risk-high")}
          ` : `<div class="memory-source" style="margin-top:8px">规则摘要在右侧三层模型中可见;点击刷新授权状态可读取 daemon 当前 effective policy。</div>`}
        </div>
      `;
    }

    function ruleGroup(label, rules = [], cls) {
      return `
        <details style="margin-top:10px" ${label !== "Allow" ? "open" : ""}>
          <summary style="cursor:pointer;font-size:11px;font-weight:800;color:var(--muted)"><span class="pill ${cls}">${escapeHtml(label)}</span> ${rules.length}</summary>
          <div style="display:grid;gap:7px;margin-top:8px">
            ${rules.slice(0, 12).map((rule) => `
              <div style="border:1px solid var(--line);border-radius:7px;padding:8px;background:#FFFDF8">
                <div class="mono" style="font-size:11px;font-weight:800">${escapeHtml(rule.id || "")}</div>
                <div class="memory-source" style="margin-top:4px">${escapeHtml(rule.reason || "")}</div>
                <div class="memory-source mono" style="margin-top:4px">${escapeHtml(ruleBits(rule))}</div>
              </div>
            `).join("") || `<div class="memory-source">暂无 ${escapeHtml(label)} rules。</div>`}
            ${rules.length > 12 ? `<div class="memory-source">另有 ${rules.length - 12} 条规则未展开。</div>` : ""}
          </div>
        </details>
      `;
    }

    function ruleBits(rule = {}) {
      return [
        rule.action ? `action=${rule.action}` : "",
        rule.scope ? `scope=${rule.scope}` : "",
        rule.target ? `target=${Array.isArray(rule.target) ? rule.target.join(",") : rule.target}` : "",
        rule.env ? `env=${Array.isArray(rule.env) ? rule.env.join(",") : rule.env}` : "",
        rule.granularity ? `grant=${Array.isArray(rule.granularity) ? rule.granularity.join(",") : rule.granularity}` : "",
        rule.risk_tag ? `risk=${Array.isArray(rule.risk_tag) ? rule.risk_tag.join(",") : rule.risk_tag}` : "",
      ].filter(Boolean).join(" · ");
    }

    function grantPanel(grants = []) {
      return `
        <div class="memory-item" style="padding:12px">
          <div class="memory-text" style="font-weight:800">Grant 管理</div>
          <div class="memory-source" style="margin-top:4px">active grant 可撤销;consumed/expired/revoked 只保留审计。</div>
          <div style="display:grid;gap:8px;margin-top:10px">
            ${grants.slice(0, 12).map(managedGrantItem).join("") || `<div class="memory-source">暂无 grant。</div>`}
          </div>
        </div>
      `;
    }

    function managedGrantItem(grant = {}) {
      const cls = grant.status === "active" ? "risk-low" : grant.status === "consumed" ? "risk-mid" : "risk-high";
      return `
        <div style="border:1px solid var(--line);border-radius:7px;padding:8px;background:#FFFDF8">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
            <div>
              <span class="detail-id mono">${escapeHtml(grant.id)}</span>
              <span class="pill ${cls}">${escapeHtml(grant.status || "unknown")}</span>
              <span class="memory-source mono">${escapeHtml(grant.type || "grant")}</span>
            </div>
            ${grant.status === "active" ? `<button class="btn" data-action="authorization-grant-revoke" data-id="${escapeAttr(grant.id)}" style="font-size:10.5px;padding:5px 8px;border-radius:6px">撤销</button>` : ""}
          </div>
          <div class="memory-source mono" style="margin-top:5px">${escapeHtml(grant.fingerprint || "")}</div>
          <div class="memory-source" style="margin-top:4px">${escapeHtml([grant.taskId, grant.decisionId, grant.ruleId].filter(Boolean).join(" · "))}</div>
        </div>
      `;
    }

    function decisionPanel(decisions = []) {
      return `
        <div class="memory-item" style="padding:12px">
          <div class="memory-text" style="font-weight:800">授权决策历史</div>
          <div style="display:grid;gap:8px;margin-top:10px">
            ${decisions.slice(0, 12).map((decision) => `
              <div style="border:1px solid var(--line);border-radius:7px;padding:8px;background:#FFFDF8">
                <div><span class="detail-id mono">${escapeHtml(decision.id)}</span> <span class="pill ${decision.status === "pending" ? "risk-mid" : "risk-low"}">${escapeHtml(decision.status)}</span></div>
                <div class="memory-source" style="margin-top:4px">${escapeHtml(decision.title || decision.taskId || "")}</div>
                <div class="memory-source mono" style="margin-top:4px">${escapeHtml(decision.ruleId || decision.authorization?.ruleId || "")} · ${escapeHtml(decision.fingerprint || decision.authorization?.fingerprint || "")}</div>
              </div>
            `).join("") || `<div class="memory-source">暂无授权决策。</div>`}
          </div>
        </div>
      `;
    }

    function auditPanel(audit = []) {
      return `
        <div class="memory-item" style="padding:12px">
          <div class="memory-text" style="font-weight:800">审计日志</div>
          <div style="display:grid;gap:8px;margin-top:10px">
            ${audit.slice(0, 12).map((entry) => `
              <div style="border:1px solid var(--line);border-radius:7px;padding:8px;background:#FFFDF8">
                <div><span class="pill ${auditClass(entry.event)}">${escapeHtml(entry.event || "authorization.audit")}</span></div>
                <div class="memory-source mono" style="margin-top:5px">${escapeHtml(entry.at || entry.fingerprint || "")}</div>
                <div class="memory-source" style="margin-top:4px">${escapeHtml([entry.ruleId, entry.grantId, entry.decisionId].filter(Boolean).join(" · "))}</div>
                ${entry.reason ? `<div class="memory-source" style="margin-top:4px">${escapeHtml(entry.reason)}</div>` : ""}
              </div>
            `).join("") || `<div class="memory-source">暂无审计事件。</div>`}
          </div>
        </div>
      `;
    }

    function auditClass(event) {
      const text = String(event || "");
      if (text.includes(".deny") || text.includes(".revoke") || text.includes(".quota")) return "risk-high";
      if (text.includes(".gate")) return "risk-mid";
      return "risk-low";
    }

    function authorizationLab(state = {}, ui = {}) {
      const lab = ui.authLab || {};
      const input = lab.input || "rg TODO server";
      const result = lab.result || null;
      const tasks = (state.tasks || []).filter((task) => !task.archivedAt).slice(0, 20);
      const selectedTaskId = lab.taskId || tasks[0]?.id || "";
      const selectedTask = tasks.find((task) => task.id === selectedTaskId) || tasks[0] || {};
      const workspace = lab.workspace || selectedTask.workspace || "";
      const environment = lab.environment || "local";
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
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr));gap:8px;margin-top:10px">
                <label style="display:grid;gap:4px;font-size:11px;color:var(--muted);font-weight:700">Task
                  <select data-auth-lab-field="taskId" style="height:34px;border:1px solid var(--line);border-radius:7px;background:#FFFDF8;color:var(--ink);padding:0 8px">
                    <option value="">无 task context</option>
                    ${tasks.map((task) => `<option value="${escapeAttr(task.id)}" ${task.id === selectedTaskId ? "selected" : ""}>${escapeHtml(task.id)} · ${escapeHtml(task.title || task.workspace || "task")}</option>`).join("")}
                  </select>
                </label>
                <label style="display:grid;gap:4px;font-size:11px;color:var(--muted);font-weight:700">Workspace
                  <input data-auth-lab-field="workspace" value="${escapeAttr(workspace)}" placeholder="workspace path" style="height:34px;border:1px solid var(--line);border-radius:7px;background:#FFFDF8;color:var(--ink);padding:0 8px;font:11px var(--mono)" />
                </label>
                <label style="display:grid;gap:4px;font-size:11px;color:var(--muted);font-weight:700">Env
                  <select data-auth-lab-field="environment" style="height:34px;border:1px solid var(--line);border-radius:7px;background:#FFFDF8;color:var(--ink);padding:0 8px">
                    ${["local", "dev", "staging", "prod", "external", "unknown"].map((item) => `<option value="${item}" ${item === environment ? "selected" : ""}>${item}</option>`).join("")}
                  </select>
                </label>
              </div>
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

    function localAuthorizationOverview(state = {}) {
      const decisions = (state.decisions || []).filter((decision) => decision.authorization);
      const grants = state.authorization?.grants || [];
      const audit = state.authorization?.audit || [];
      const allow = (state.rules || []).filter((rule) => rule.kind === "允许").length;
      const gate = (state.rules || []).filter((rule) => String(rule.kind || "").includes("Gate")).length;
      const deny = (state.rules || []).filter((rule) => rule.kind === "拒绝").length;
      return {
        policy: {
          source: "state snapshot",
          failedClosed: false,
          defaults: { unknown_action: "gate" },
          counts: { allow, gate, deny },
          rules: null,
        },
        decisions: {
          total: decisions.length,
          pending: decisions.filter((decision) => decision.status === "pending").length,
          recent: decisions.slice(0, 20),
        },
        grants: {
          total: grants.length,
          active: grants.filter((grant) => grant.status === "active").length,
          consumed: grants.filter((grant) => grant.status === "consumed").length,
          expired: grants.filter((grant) => grant.status === "expired").length,
          revoked: grants.filter((grant) => grant.status === "revoked").length,
          items: grants,
        },
        audit,
      };
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
