(function initSecondSettingsView(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondSettingsView = api;
  if (typeof window === "object") window.SecondSettingsView = api;
  if (typeof globalThis === "object") globalThis.SecondSettingsView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondSettingsView() {
  "use strict";

  function createSettingsView(deps = {}) {
    const {
      PRODUCT_NAME = "Second",
      PRODUCT_LOGO_SOURCES = {},
      channelMetaParts = (value) => String(value || "").split(" · ").filter(Boolean),
      engineColor = () => ({ bg: "rgba(217,86,11,.1)", color: "var(--accent)" }),
      engineStatus = () => ({ label: "未知", cls: "tag" }),
      escapeAttr = escapeHtmlAttribute,
      escapeHtml = escapeHtmlText,
      latestSlackStatus = () => ({ label: "未连接", cls: "kind-amber" }),
      relativeTime = () => "刚刚",
    } = deps;

    function render(state = {}, ui = {}, currentSlackForm = () => ({})) {
      const snippet = `"mcpServers": {
  "second-decision": {
    "command": "second",
    "args": ["mcp", "serve"],
    "env": { "SECOND_DAEMON": "localhost:${state.daemon?.port || 7317}" }
  }
}`;
      return `
        <div class="page">
          <div class="content-wide settings-page">
            <div class="settings-page-head">
              <div>
                <h1 style="margin:0;font-size:18px;font-weight:700">设置</h1>
                <div class="page-subtitle">本地执行环境 · daemon 自动扫描 PATH 中的 agent 执行引擎,并通过探针验证可用性</div>
              </div>
              <div class="settings-summary-strip">
                <span><b>${(state.engines || []).filter((engine) => engine.status === "ok").length}</b> 个引擎可用</span>
                <span><b>${(state.channels || []).filter((channel) => channel.status === "connected").length}</b> 个渠道连接</span>
                <span><b>${state.metrics?.pendingDecisions || 0}</b> 个待决策</span>
              </div>
            </div>

            <div class="settings-layout">
              <div class="settings-primary">
                <div class="settings-card first">
                  <div class="settings-head">
                    <div style="flex:1">
                      <div class="settings-name">Agent 执行环境</div>
                      <div class="settings-meta">上次检测 ${state.settings?.lastScan ? relativeTime(state.settings.lastScan) : "尚未检测"} · 新任务将派发给默认引擎</div>
                    </div>
                    <button class="btn" data-action="detect-engines">${ui.busy ? "检测中..." : "全部重新检测"}</button>
                  </div>
                  ${(state.engines || []).map(engineRow).join("")}
                </div>
                <div class="settings-card">
                  <div class="settings-head">
                    <div>
                      <div class="settings-name">信息接收渠道</div>
                      <div class="settings-meta">分身从这些渠道接收任务与 @提及,并把决策请求与结果回传到原线程</div>
                    </div>
                  </div>
                  ${(state.channels || []).map(channelRow).join("")}
                </div>
              </div>

              <div class="settings-secondary">
                ${slackSetupCard(state, ui, currentSlackForm)}
                ${decisionMcpCard(state, snippet)}
                ${runtimeProbeCard(state)}
                ${codexNetworkAccessCard(state)}
              </div>
            </div>
          </div>
        </div>
      `;
    }

    function decisionMcpCard(state, snippet) {
      return `
        <div class="settings-card compact-card">
          <div class="settings-head">
            <div style="flex:1">
              <div class="settings-name">Decision MCP · 决策回传通道</div>
              <div class="settings-meta">注入 Agent Runtime,让待决策内容回到 ${PRODUCT_NAME}</div>
            </div>
            <span style="display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:var(--green)"><span class="online-dot"></span>server 可用</span>
          </div>
          <div class="settings-card-body">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="section-label">MCP 配置片段</span>
              <span style="flex:1"></span>
              <button class="text-link" data-action="copy" data-copy="${escapeAttr(snippet)}">复制配置</button>
            </div>
            <div class="code-block mono">${escapeHtml(snippet)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px">
              ${["decision_request(title, options, evidence)", "decision_list(status)", "decision_resolve(id, verdict)"].map((tool) => `<span class="artifact-chip mono">${tool}</span>`).join("")}
            </div>
          </div>
        </div>
      `;
    }

    function runtimeProbeCard(state) {
      const networkEnabled = Boolean(state.settings?.codexNetworkAccess);
      return `
        <div class="settings-card compact-card">
          <div class="settings-head">
            <div>
              <div class="settings-name">检测方式</div>
              <div class="settings-meta">探针结果决定新任务是否可直接运行。</div>
            </div>
          </div>
          <div class="settings-card-body">
            <div class="probe-steps">
              <div><span class="detail-id mono">01</span><b>扫描 PATH</b><em>查找 <span class="mono">codex</span> 可执行文件</em></div>
              <div><span class="detail-id mono">02</span><b>读取版本</b><em>执行 <span class="mono">codex --version</span></em></div>
              <div><span class="detail-id mono">03</span><b>派发任务</b><em>使用 <span class="mono">codex exec --json --sandbox workspace-write${networkEnabled ? " -c sandbox_workspace_write.network_access=true" : ""}</span></em></div>
            </div>
          </div>
        </div>
      `;
    }

    function codexNetworkAccessCard(state) {
      const enabled = Boolean(state.settings?.codexNetworkAccess);
      return `
        <div class="settings-card compact-card">
          <div class="settings-head">
            <div style="flex:1">
              <div class="settings-name">Codex CLI 网络访问</div>
              <div class="settings-meta">开启后,新任务和恢复中的任务会带上 <span class="mono">sandbox_workspace_write.network_access=true</span>。</div>
            </div>
            <button
              class="toggle ${enabled ? "on" : ""}"
              type="button"
              aria-label="${enabled ? "关闭 Codex CLI 网络访问" : "开启 Codex CLI 网络访问"}"
              data-action="codex-network-toggle"
              data-enabled="${enabled ? "false" : "true"}"
            ></button>
          </div>
          <div class="settings-card-body">
            <div class="settings-meta" style="margin-top:0">
              当前状态: <b style="color:${enabled ? "var(--green)" : "var(--muted)"}">${enabled ? "已开启" : "未开启"}</b>。
              代理环境变量仍然继承自启动 daemon 的 shell;如果需要代理,请在启动 ${PRODUCT_NAME} 前配置 <span class="mono">HTTPS_PROXY</span> / <span class="mono">ALL_PROXY</span>。
            </div>
          </div>
        </div>
      `;
    }

    function slackSetupCard(state, ui, currentSlackForm) {
      const form = currentSlackForm();
      const slack = state.integrations?.slack || {};
      const socketStatus = latestSlackStatus(slack);
      const manifestText = ui.slackManifest || "";
      return `
        <div class="settings-card slack-setup-card">
          <div class="settings-head">
            ${productLogo({ id: "slack", name: "Slack", mono: "S" }, "settings-logo-flat")}
            <div style="flex:1">
              <div class="settings-name">Slack 集成</div>
              <div class="settings-meta">在前端保存 token、生成 manifest、重连 Socket Mode、发测试消息。manifest 会包含频道名称解析所需 read scope。</div>
            </div>
            <span class="pill ${socketStatus.cls}">${escapeHtml(socketStatus.label)}</span>
          </div>
          <div class="slack-setup-body">
            <div class="slack-mode-row">
              <label class="slack-check">
                <input type="checkbox" data-slack-field="socketMode" ${form.socketMode ? "checked" : ""} />
                <span>使用 Socket Mode</span>
              </label>
              <span class="settings-meta" style="margin:0">推荐。${PRODUCT_NAME} 主动连接 Slack WebSocket,不需要 cloudflared/ngrok。</span>
            </div>
            <div class="slack-mode-row">
              <label class="slack-check">
                <input type="checkbox" data-slack-field="customizeProfileMessages" ${form.customizeProfileMessages ? "checked" : ""} />
                <span>使用用户头像发 Slack 消息</span>
              </label>
              <span class="settings-meta" style="margin:0">需要 Slack scope <span class="mono">chat:write.customize</span>;缺少权限时会自动回退为普通 Bot 头像。</span>
            </div>
            <div class="slack-config-grid">
              ${secretField(state, currentSlackForm, "botToken", "Bot User OAuth Token", slack.botTokenConfigured, slack.botTokenLabel, "xoxb-...")}
              ${secretField(state, currentSlackForm, "appToken", "App-Level Token", slack.appTokenConfigured, slack.appTokenLabel, "xapp-...")}
              ${secretField(state, currentSlackForm, "signingSecret", "Signing Secret", slack.signingSecretConfigured, slack.signingSecretLabel, "HTTP callback 模式使用")}
              <label class="field">
                <span>Public URL</span>
                <input data-slack-field="publicUrl" value="${escapeAttr(form.publicUrl)}" placeholder="HTTP callback 模式使用; Socket Mode 可留空" />
              </label>
              <label class="field">
                <span>决策通知频道 ID</span>
                <input data-slack-field="decisionChannel" value="${escapeAttr(form.decisionChannel)}" placeholder="C0123456789" />
              </label>
              <label class="field">
                <span>允许用户 ID</span>
                <input data-slack-field="allowedUsers" value="${escapeAttr(form.allowedUsers)}" placeholder="可选: U123,U456" />
              </label>
              <label class="field">
                <span>允许频道 ID</span>
                <input data-slack-field="allowedChannels" value="${escapeAttr(form.allowedChannels)}" placeholder="可选: C123,C456" />
              </label>
            </div>
            <div class="slack-setup-actions">
              <button class="btn btn-primary" data-action="save-slack-config">${ui.busy === "slack-save" ? "保存中..." : "保存并重连"}</button>
              <button class="btn" data-action="slack-reconnect">重连 Socket</button>
              <button class="btn" data-action="slack-manifest">${form.socketMode ? "生成 Socket Manifest" : "生成 HTTP Manifest"}</button>
              <button class="btn" data-action="slack-test">发测试消息</button>
            </div>
            <div class="settings-meta">已有 token 不会在前端回显。对应输入框留空表示不修改;如需更换,直接粘贴新 token 后保存。</div>
            ${manifestText ? `
              <div class="slack-manifest-box">
                <div style="display:flex;align-items:center;gap:8px">
                  <span class="section-label">Slack App Manifest</span>
                  <span style="flex:1"></span>
                  <button class="text-link" data-action="copy-slack-manifest">复制 manifest</button>
                </div>
                <div class="code-block mono">${escapeHtml(manifestText)}</div>
              </div>
            ` : ""}
          </div>
        </div>
      `;
    }

    function secretField(state, currentSlackForm, key, label, configured, tokenLabel, placeholder) {
      const source = state.integrations?.slack?.sources?.[key] || null;
      return `
        <label class="field">
          <span>${escapeHtml(label)} ${configured ? `<em class="secret-state">已配置${tokenLabel ? ` · ${escapeHtml(tokenLabel)}` : ""}${source ? ` · ${escapeHtml(source)}` : ""}</em>` : `<em class="secret-state missing">未配置</em>`}</span>
          <input type="password" autocomplete="off" data-slack-field="${escapeAttr(key)}" value="${escapeAttr(currentSlackForm()[key] || "")}" placeholder="${escapeAttr(placeholder)}" />
        </label>
      `;
    }

    function productLogo(item, extraClass = "") {
      const id = item?.id || "";
      const src = PRODUCT_LOGO_SOURCES[id];
      const classes = ["settings-logo", `logo-${id}`, extraClass].filter(Boolean).join(" ");
      if (src) {
        return `
          <div class="${classes}" aria-hidden="true">
            <img src="${escapeAttr(src)}" alt="" loading="lazy" decoding="async" />
          </div>
        `;
      }
      const color = engineColor(id);
      return `
        <div class="${classes} settings-logo-fallback" aria-hidden="true" style="background:${color.bg};color:${color.color}">
          ${escapeHtml(item?.mono || item?.name?.[0] || "?")}
        </div>
      `;
    }

    function engineRow(engine) {
      const st = engineStatus(engine.status);
      return `
        <div class="settings-row engine-row">
          ${productLogo(engine)}
          <div class="settings-main">
            <div class="settings-title-line">
              <span class="settings-name">${escapeHtml(engine.name)}</span>
              <span class="pill ${st.cls}">${st.label}</span>
              ${engine.isDefault ? `<span class="pill" style="color:var(--accent);background:rgba(217,86,11,.1)">默认引擎</span>` : ""}
            </div>
            <div class="settings-meta mono">${escapeHtml(engineDisplayMeta(engine))}</div>
            ${engine.status === "error" ? `<div class="settings-meta" style="color:var(--red)">${escapeHtml(engine.reason)}</div>` : ""}
          </div>
          <div class="settings-actions">
            ${engine.status === "ok" && !engine.isDefault ? `<button class="btn btn-primary" style="font-size:11.5px;padding:7px 13px;border-radius:7px" data-action="default-engine" data-id="${escapeAttr(engine.id)}">设为默认</button>` : ""}
            <button class="btn" style="font-size:11.5px;padding:7px 13px;border-radius:7px" data-action="detect-engines">重新检测</button>
          </div>
        </div>
      `;
    }

    function engineDisplayMeta(engine) {
      if (engine.version) return `版本 ${engine.version}`;
      if (engine.status === "error") return "不可用";
      if (engine.reason) return engine.reason;
      return "未配置";
    }

    function channelRow(channel) {
      const connected = channel.status === "connected";
      return `
        <div class="settings-row channel-row">
          ${productLogo(channel, "settings-logo-flat")}
          <div class="settings-main">
            <div class="settings-title-line">
              <span class="settings-name">${escapeHtml(channel.name)}</span>
              <span class="pill ${connected ? "risk-low" : "kind-amber"}">${connected ? (channel.notify ? "已连接" : "已连接 · 推送暂停") : "未连接"}</span>
            </div>
            <div class="settings-meta channel-meta">${channelMetaParts(channel.meta).map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</div>
          </div>
          ${connected ? `
            <div class="channel-controls">
              <span style="font-size:11.5px;color:#6E6858">接收任务与决策推送</span>
              <button class="toggle ${channel.notify ? "on" : ""}" aria-label="toggle ${escapeAttr(channel.name)}" data-action="channel-toggle" data-id="${escapeAttr(channel.id)}" data-notify="${channel.notify ? "false" : "true"}"></button>
              <button class="btn" style="font-size:11.5px;padding:7px 13px;border-radius:7px" data-action="channel-status" data-id="${escapeAttr(channel.id)}" data-status="disconnected">断开</button>
            </div>
          ` : `<div class="channel-controls single"><button class="btn btn-primary" style="font-size:11.5px;padding:7px 14px;border-radius:7px" data-action="channel-status" data-id="${escapeAttr(channel.id)}" data-status="connected">连接</button></div>`}
        </div>
      `;
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
    createSettingsView,
  };
});
