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

    function render(state = {}, ui = {}, currentSlackForm = () => ({}), currentPublicAccessForm = () => ({})) {
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
                ${publicAccessCard(state, ui, currentPublicAccessForm)}
                ${decisionMcpCard(state, snippet)}
                ${agentNetworkAccessCard(state)}
              </div>
            </div>
            ${settingsChannelModal(state, ui, currentSlackForm)}
          </div>
        </div>
      `;
    }

    function publicAccessCard(state, ui, currentPublicAccessForm) {
      const access = state.integrations?.publicAccess || {};
      const form = currentPublicAccessForm();
      const providers = Array.isArray(access.providers) && access.providers.length
        ? access.providers
        : [
            { id: "manual", label: "手动公网链接", description: "使用你自己配置好的 HTTPS 地址。" },
            { id: "cloudflared", label: "Cloudflare Quick Tunnel", description: "由 Second 启动 cloudflared 快速隧道。" },
          ];
      const provider = form.provider || access.provider || "manual";
      const activeUrl = access.activeUrl || "";
      const check = access.lastCheck || null;
      const checkLine = check
        ? check.ok
          ? `成功 · ${check.statusCode || 200} · ${relativeTime(check.at)}`
          : `失败 · ${check.error || "无法访问"}`
        : "尚未检测";
      const status = publicAccessStatus(access);
      const manualProvider = provider === "manual";
      return `
        <div class="settings-card public-access-card">
          <div class="settings-head">
            ${productLogo({ id: "public-access", name: "手机公网通道" }, "settings-logo-flat")}
            <div style="flex:1">
              <div class="settings-name">手机公网通道</div>
              <div class="settings-meta">手机决策端需要一个手机可访问的 HTTPS 地址。这里统一管理 Cloudflared、手动公网链接以及后续 ngrok / frp provider。</div>
            </div>
            <span class="pill ${status.cls}">${status.label}</span>
          </div>
          <div class="settings-card-body public-access-body">
            <div class="public-access-grid ${manualProvider ? "" : "single"}">
              <label class="field">
                <span>通道方式</span>
                <select data-public-access-field="provider">
                  ${providers.map((item) => `<option value="${escapeAttr(item.id)}" ${item.id === provider ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
                </select>
              </label>
              ${manualProvider ? `
                <label class="field">
                  <span>手动公网链接</span>
                  <input data-public-access-field="manualUrl" value="${escapeAttr(form.manualUrl || "")}" placeholder="https://your-domain.example.com" />
                </label>
              ` : ""}
            </div>
            <div class="public-access-provider-note">
              ${providers.map((item) => `<span class="${item.id === provider ? "active" : ""}">${escapeHtml(item.label)}: ${escapeHtml(item.description || "")}</span>`).join("")}
            </div>
            <div class="public-access-status-grid">
              <div>
                <b>当前访问地址</b>
                <span class="mono">${activeUrl ? escapeHtml(activeUrl) : "未打开"}</span>
              </div>
              <div>
                <b>公网检测</b>
                <span>${escapeHtml(checkLine)}</span>
              </div>
            </div>
            ${access.lastError ? `<div class="public-access-error">${escapeHtml(access.lastError)}</div>` : ""}
            <div class="public-access-actions">
              <button class="btn" data-action="public-access-save">保存设置</button>
              <button class="btn btn-primary" data-action="public-access-start" ${ui.busy === "public-access-start" ? "disabled" : ""}>${access.enabled ? "重新打开" : "打开通道"}</button>
              <button class="btn" data-action="public-access-check" ${ui.busy === "public-access-check" ? "disabled" : ""}>检测公网访问</button>
              <button class="btn" data-action="public-access-copy-url" ${activeUrl ? "" : "disabled"}>复制链接</button>
              <button class="btn" data-action="public-access-stop" ${ui.busy === "public-access-stop" || !access.enabled ? "disabled" : ""}>关闭</button>
            </div>
            <div class="settings-meta">打开后，“消息端”的二维码会使用这里的访问地址。关闭后手机仍可保留订阅，但新的手机配对不再使用公网通道。</div>
          </div>
        </div>
      `;
    }

    function publicAccessStatus(access = {}) {
      if (!access.enabled) return { label: "未打开", cls: "kind-amber" };
      if (access.status === "online") return { label: "公网可访问", cls: "risk-low" };
      if (access.status === "starting") return { label: "启动中", cls: "kind-amber" };
      if (access.status === "error") return { label: "检测失败", cls: "risk-high" };
      if (access.activeUrl) return { label: "已配置", cls: "risk-low" };
      return { label: "待检测", cls: "kind-amber" };
    }

    function settingsChannelModal(state, ui, currentSlackForm) {
      if (ui.settingsChannelConfig !== "slack") return "";
      const slack = state.integrations?.slack || {};
      const socketStatus = latestSlackStatus(slack);
      return `
        <div class="profile-modal-backdrop settings-channel-backdrop" role="presentation" data-action="close-settings-channel-config">
          <section class="profile-modal settings-channel-modal" role="dialog" aria-modal="true" aria-labelledby="settings-channel-title">
            <div class="profile-modal-head">
              ${productLogo({ id: "slack", name: "Slack", mono: "S" }, "settings-logo-flat")}
              <div style="flex:1">
                <h2 id="settings-channel-title">Slack 集成</h2>
                <div class="settings-meta">配置 token、Socket Mode、manifest 和测试消息。已有 token 不会在前端回显。</div>
              </div>
              <span class="pill ${socketStatus.cls}">${escapeHtml(socketStatus.label)}</span>
              <button class="icon-btn" data-action="close-settings-channel-config" aria-label="关闭">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>
              </button>
            </div>
            <div class="profile-modal-body settings-channel-modal-body">
              ${slackSetupBody(state, ui, currentSlackForm)}
            </div>
          </section>
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

    function agentNetworkAccessCard(state) {
      const enabled = Boolean(state.settings?.codexNetworkAccess);
      return `
        <div class="settings-card compact-card">
          <div class="settings-head">
            <div style="flex:1">
              <div class="settings-name">本地智能体网络代理</div>
              <div class="settings-meta">开启后,新任务会获得 <span class="mono">SECOND_AUTH_PROXY</span>; 外部请求必须先走 daemon 授权,不会直接打开 Codex 原生网络开关。</div>
            </div>
            <button
              class="toggle ${enabled ? "on" : ""}"
              type="button"
              aria-label="${enabled ? "关闭本地智能体网络代理" : "开启本地智能体网络代理"}"
              data-action="codex-network-toggle"
              data-enabled="${enabled ? "false" : "true"}"
            ></button>
          </div>
          <div class="settings-card-body">
            <div class="settings-meta" style="margin-top:0">
              当前状态: <b style="color:${enabled ? "var(--green)" : "var(--muted)"}">${enabled ? "已开启" : "未开启"}</b>。
              如需极端调试的原生网络,必须由启动环境显式设置 <span class="mono">SECOND_CODEX_RAW_NETWORK_ACCESS=1</span>。
            </div>
          </div>
        </div>
      `;
    }

    function slackSetupBody(state, ui, currentSlackForm) {
      const form = currentSlackForm();
      const slack = state.integrations?.slack || {};
      const manifestText = ui.slackManifest || "";
      return `
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
      if (id === "assistant") return assistantSettingsLogo(classes);
      if (id === "public-access") return proxyNetworkLogo(classes);
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

    function assistantSettingsLogo(classes) {
      return `
        <div class="${classes}" aria-hidden="true">
          <span class="assistant-robot settings-assistant-robot">
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
        </div>
      `;
    }

    function proxyNetworkLogo(classes) {
      return `
        <div class="${classes} settings-icon-proxy" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" focusable="false">
            <path d="M4 12h4.5m7 0H20" />
            <path d="M8.5 12a3.5 3.5 0 0 1 7 0" />
            <path d="M8.5 12a3.5 3.5 0 0 0 7 0" />
            <circle cx="4" cy="12" r="2" />
            <circle cx="12" cy="12" r="3" />
            <circle cx="20" cy="12" r="2" />
          </svg>
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
      const processingEnabled = connected && channel.notify !== false;
      const toggleDisabled = connected ? "" : "disabled";
      return `
        <div class="settings-row channel-row">
          ${productLogo(channel, "settings-logo-flat")}
          <div class="settings-main">
            <div class="settings-title-line">
              <span class="settings-name">${escapeHtml(channel.name)}</span>
              <span class="pill ${connected ? "risk-low" : "kind-amber"}">${connected ? "已连接" : "未连接"}</span>
            </div>
            <div class="settings-meta channel-meta">${channelMetaParts(channel.meta).map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</div>
          </div>
          <div class="channel-controls">
            <span class="channel-processing-label">${processingEnabled ? "处理中" : "已停用"}</span>
            <button
              class="toggle channel-processing-toggle ${processingEnabled ? "on" : ""}"
              type="button"
              aria-label="${processingEnabled ? `停用 ${escapeAttr(channel.name)} 消息处理` : `启用 ${escapeAttr(channel.name)} 消息处理`}"
              data-action="channel-toggle"
              data-id="${escapeAttr(channel.id)}"
              data-notify="${processingEnabled ? "false" : "true"}"
              ${toggleDisabled}
            ></button>
            <button class="btn channel-config-btn" data-action="channel-config" data-id="${escapeAttr(channel.id)}">配置</button>
          </div>
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
