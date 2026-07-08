(function initSecondOnboardingView(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondOnboardingView = api;
  if (typeof window === "object") window.SecondOnboardingView = api;
  if (typeof globalThis === "object") globalThis.SecondOnboardingView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondOnboardingView() {
  "use strict";

  const SETUP_STEPS = [
    { n: 0, label: "欢迎" },
    { n: 1, label: "执行引擎" },
    { n: 2, label: "消息频道" },
    { n: 3, label: "手机连接" },
    { n: 4, label: "分身身份" },
    { n: 5, label: "授权边界" },
    { n: 6, label: "开始使用" },
  ];

  function createOnboardingView(deps = {}) {
    const {
      PRODUCT_NAME = "Second",
      PRODUCT_LOGO_SOURCES = {},
      engineStatus = () => ({ label: "未知", cls: "tag" }),
      escapeAttr = escapeHtmlAttribute,
      escapeHtml = escapeHtmlText,
      latestSlackStatus = () => ({ label: "未连接", cls: "kind-amber" }),
      productLogo = null,
      relativeTime = () => "刚刚",
    } = deps;

    function render(state = {}, ui = {}, currentSlackForm = () => ({}), currentPublicAccessForm = () => ({})) {
      const step = clampStep(ui.onboardingStep ?? 0);
      const form = currentSlackForm();
      const publicAccessForm = currentPublicAccessForm();
      const slack = state.integrations?.slack || {};
      const mobilePwa = state.integrations?.mobilePwa || {};
      const publicAccess = state.integrations?.publicAccess || {};
      const defaultEngine = defaultRuntime(state);
      const runtimeReady = Boolean(defaultEngine?.status === "ok");
      const slackReady = isSlackReady(slack);
      const mobileReady = isMobileReady(mobilePwa, ui);
      const mobileSkipped = Boolean(ui.onboardingMobileSkipped);
      const profileReady = Boolean(state.profile?.name);
      const authReady = Boolean((state.rules || []).length || ui.onboardingAuthLevel);
      const canTest = runtimeReady;
      return `
        <div class="onboarding-canvas">
          <div class="onboarding-shell">
            ${rail(state, ui, step)}
            <main class="onboarding-main">
              <div class="onboarding-content">
                ${screen(step, state, ui, form, {
                  authReady,
                  canTest,
                  defaultEngine,
                  mobilePwa,
                  mobileReady,
                  mobileSkipped,
                  profileReady,
                  publicAccess,
                  publicAccessForm,
                  runtimeReady,
                  slack,
                  slackReady,
                })}
                ${step > 0 && step < 6 ? bottomNav(step, state, ui, { mobileReady, runtimeReady, slackReady }) : ""}
              </div>
            </main>
          </div>
        </div>
      `;
    }

    function rail(state, ui, step) {
      return `
        <aside class="onboarding-rail" aria-label="初始化步骤">
          <div class="onboarding-rail-list">
            ${SETUP_STEPS.slice(1).map((item) => {
              const done = isStepDone(item.n, state, ui);
              const current = step === item.n;
              return `
                <button class="onboarding-rail-item ${current ? "current" : ""} ${done ? "done" : ""}" data-action="onboarding-go" data-step="${item.n}" ${current ? `aria-current="step"` : ""}>
                  <span class="onboarding-rail-dot">${done ? checkSvg() : item.n}</span>
                  <span>${escapeHtml(item.label)}</span>
                  ${current ? `<em class="onboarding-current-label">当前</em>` : ""}
                </button>
              `;
            }).join("")}
          </div>
        </aside>
      `;
    }

    function screen(step, state, ui, form, facts) {
      if (step === 0) return welcomeScreen();
      if (step === 1) return runtimeScreen(state, ui, facts.defaultEngine);
      if (step === 2) return channelScreen(state, ui, form, facts.slack);
      if (step === 3) return mobileConnectionScreen(state, ui, facts);
      if (step === 4) return identityScreen(state, ui);
      if (step === 5) return authorizationScreen(state, ui);
      return finishScreen(state, ui, form, facts);
    }

    function welcomeScreen() {
      return `
        <section class="setup-screen setup-welcome">
          ${brandMarkSvg("#1d1b17", "setup-welcome-mark")}
          <h1>把你的分身接进来</h1>
          <p class="setup-lead">daemon 已经在本机跑起来了。接下来的几步,是让别人 @ 你的任务能被你的分身接住:选一个执行引擎、接上真实消息渠道、划好它替你做事的边界。</p>
          <div class="setup-value-grid">
            ${valueCard("任务不再经你中转", "Slack 里的 @ 提及会进入 Second,分身接住后在本地 runtime 里执行,结果回到原线程。", "slack")}
            ${valueCard("你只出现在决策点", "任务有歧义、缺少信息或越过授权边界时,决策进入 Second 收件箱,不把审批塞回 Slack。", "decision")}
            ${valueCard("执行和数据都在本机", "Codex CLI、Decision MCP、trace 与记忆都留在本机,入口可换,运行过程可见可停。", "runtime")}
          </div>
          <button class="setup-primary-btn" data-action="onboarding-start">开始配置</button>
        </section>
      `;
    }

    function valueCard(title, text, kind) {
      const visual =
        kind === "slack"
          ? `<div class="setup-mini-chat">
              <div><b>王倩</b><span>09:14 · #eng-backend</span></div>
              <p><em>@你</em> staging 有零星 500,能帮忙看下吗?</p>
              <div class="setup-mini-route">路由到个人分身 · 你未被打扰</div>
              <div class="setup-mini-dark"><span class="online-dot"></span>分身已接住 · 本地执行中</div>
            </div>`
          : kind === "decision"
            ? `<div class="setup-mini-decision">
                <div class="setup-mini-head">决策收件箱 <b>1 待决策</b></div>
                <span class="pill risk-mid">中风险</span>
                <h3>是否重启 staging 的 api 服务?</h3>
                <p>背景、风险、推荐方案与证据包都在 Second 中处理。</p>
                <div><span>批准</span><span>拒绝</span><span>证据包</span></div>
              </div>`
            : `<div class="setup-mini-terminal">
                <div><span></span><span></span><span></span><b>second daemon · localhost</b></div>
                <code>runtime 在线 · heartbeat 刚刚<br>codex exec --json<br>trace 已落盘 · 可回放可审计</code>
              </div>`;
      return `
        <article class="setup-value-card">
          <div class="setup-value-visual">${visual}</div>
          <div class="setup-value-body">
            <h2>${escapeHtml(title)}</h2>
            <p>${escapeHtml(text)}</p>
          </div>
        </article>
      `;
    }

    function runtimeScreen(state, ui, defaultEngine) {
      const engines = state.engines || [];
      const networkEnabled = Boolean(state.settings?.codexNetworkAccess);
      return `
        <section class="setup-screen">
          ${screenHead(1, "选一个执行引擎", "引擎是分身手里可以换的工具箱。Second 负责记忆、授权和 trace; runtime 负责在本机执行任务。")}
          <div class="setup-runtime-list">
            ${engines.map((engine) => runtimeRow(engine, defaultEngine, ui)).join("") || emptySetup("尚未检测到执行引擎", "点击重新检测,Second 会扫描 PATH 和常见安装目录。")}
          </div>
          <div class="setup-footnote">默认引擎会用于新任务和从 Human Gate 恢复的任务。Codex CLI 的网络访问只影响新启动的 run。</div>
          <div class="setup-action-row">
            <button class="setup-primary-btn small" data-action="detect-engines">${ui.busy === true ? "检测中..." : "重新检测 runtime"}</button>
            <button class="setup-secondary-btn" data-action="codex-network-toggle" data-enabled="${networkEnabled ? "false" : "true"}">${networkEnabled ? "关闭 Codex 网络访问" : "开启 Codex 网络访问"}</button>
            <button class="setup-secondary-btn" data-action="nav" data-view="runtime">打开运行时</button>
          </div>
        </section>
      `;
    }

    function runtimeRow(engine, defaultEngine, ui) {
      const st = engineStatus(engine.status);
      const selected = engine.id === defaultEngine?.id;
      const canSelect = engine.status === "ok" && !selected;
      const install = runtimeInstallHint(engine);
      return `
        <article class="setup-choice-card ${selected ? "selected" : ""} ${engine.status === "ok" ? "" : "muted"}">
          <div class="setup-choice-radio">${selected ? "<span></span>" : ""}</div>
          ${renderProductLogo(engine, "setup-product-logo")}
          <div class="setup-choice-body">
            <div class="setup-choice-title">
              <b>${escapeHtml(engine.name || engine.id || "Runtime")}</b>
              <span class="pill ${st.cls}">${escapeHtml(st.label)}</span>
              ${selected ? `<span class="pill kind-green">默认</span>` : ""}
            </div>
            <p>${escapeHtml(engine.path || engine.command || install.description)}</p>
            ${engine.status !== "ok" ? `<code class="setup-install-code">${escapeHtml(install.command)}</code>` : ""}
          </div>
          ${canSelect ? `<button class="setup-secondary-btn" data-action="default-engine" data-id="${escapeAttr(engine.id)}">设为默认</button>` : ""}
          ${engine.status !== "ok" ? `<button class="setup-secondary-btn" data-action="detect-engines">${ui.busy === true ? "检测中..." : "装好了,重新检测"}</button>` : ""}
        </article>
      `;
    }

    function channelScreen(state, ui, form, slack) {
      const socketStatus = latestSlackStatus(slack);
      const slackReady = isSlackReady(slack);
      const manifestText = ui.slackManifest || "";
      return `
        <section class="setup-screen">
          ${screenHead(2, "接上任务的进出口", "Second 不做聊天入口。任务从你们每天用的工具进来,分身在本机处理,结果回到原线程。当前实现的真实渠道是 Slack。")}
          ${slackSourceGuide()}
          <article class="setup-channel-card ${slackReady ? "ready" : ""}">
            <div class="setup-channel-head">
              ${renderProductLogo({ id: "slack", name: "Slack", mono: "S" }, "setup-channel-logo")}
              <div>
                <h2>Slack</h2>
                <p>@ 提及与线程消息会被转成 Second 任务;Slack 上只询问补充信息,审批保留在 Second。</p>
              </div>
              <span class="pill ${socketStatus.cls}">${escapeHtml(socketStatus.label)}</span>
            </div>
            <div class="setup-slack-grid">
              <label class="slack-check">
                <input type="checkbox" data-slack-field="socketMode" ${form.socketMode ? "checked" : ""} />
                <span>使用 Socket Mode</span>
              </label>
              <label class="slack-check">
                <input type="checkbox" data-slack-field="customizeProfileMessages" ${form.customizeProfileMessages ? "checked" : ""} />
                <span>使用用户头像发 Slack 消息</span>
              </label>
              ${secretField("botToken", "Bot User OAuth Token", slack.botTokenConfigured, slack.botTokenLabel, "xoxb-...")}
              ${secretField("appToken", "App-Level Token", slack.appTokenConfigured, slack.appTokenLabel, "xapp-...")}
              ${secretField("signingSecret", "Signing Secret", slack.signingSecretConfigured, slack.signingSecretLabel, "HTTP callback 模式使用")}
              <label class="field">
                <span>Public URL</span>
                <input data-slack-field="publicUrl" value="${escapeAttr(form.publicUrl)}" placeholder="HTTP callback 模式使用;Socket Mode 可留空" />
              </label>
              <label class="field">
                <span>决策/测试频道 ID</span>
                <input data-slack-field="decisionChannel" value="${escapeAttr(form.decisionChannel)}" placeholder="C0123456789" />
              </label>
              <label class="field">
                <span>允许频道 ID</span>
                <input data-slack-field="allowedChannels" value="${escapeAttr(form.allowedChannels)}" placeholder="可选: C123,C456" />
              </label>
            </div>
            <div class="setup-action-row">
              <button class="setup-primary-btn small" data-action="save-slack-config">${ui.busy === "slack-save" ? "保存中..." : "保存并重连 Slack"}</button>
              <button class="setup-secondary-btn" data-action="slack-reconnect">重连 Socket</button>
              <button class="setup-secondary-btn" data-action="slack-manifest">${form.socketMode ? "生成 Socket Manifest" : "生成 HTTP Manifest"}</button>
              <button class="setup-secondary-btn" data-action="slack-test">测试出站消息</button>
            </div>
            <div class="setup-footnote">已有 token 不会回显。输入框留空表示不修改;更换 token 时直接粘贴新值后保存。</div>
            ${manifestText ? `
              <div class="setup-manifest-box">
                <div><span class="section-label">Slack App Manifest</span><button class="text-link" data-action="copy-slack-manifest">复制 manifest</button></div>
                <pre class="code-block mono">${escapeHtml(manifestText)}</pre>
              </div>
            ` : ""}
          </article>
        </section>
      `;
    }

    function slackSourceGuide() {
      return `
        <section class="setup-source-guide" aria-label="Slack 配置来源">
          <div>
            <b>这些值从哪里获取?</b>
            <p>先在 Slack 后台创建或打开 App,再按下面位置复制 token、secret 和频道 ID。</p>
          </div>
          <div class="setup-source-links">
            <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer">打开 Slack App 后台</a>
            <a href="https://api.slack.com/authentication/token-types#bot" target="_blank" rel="noreferrer">Bot Token</a>
            <a href="https://api.slack.com/apis/connections/socket" target="_blank" rel="noreferrer">Socket Mode / App Token</a>
            <a href="https://api.slack.com/apis/events-api#signing_secrets" target="_blank" rel="noreferrer">Signing Secret</a>
            <a href="https://api.slack.com/reference/manifests" target="_blank" rel="noreferrer">Manifest</a>
          </div>
          <ul>
            <li><b>Bot User OAuth Token</b>: Slack App 的 OAuth & Permissions 页面,复制 <span class="mono">xoxb-</span> token。</li>
            <li><b>App-Level Token</b>: Basic Information / App-Level Tokens 创建带 <span class="mono">connections:write</span> scope 的 <span class="mono">xapp-</span> token。</li>
            <li><b>Signing Secret / Public URL</b>: 只在 HTTP callback 模式需要;Socket Mode 可留空 Public URL。</li>
            <li><b>频道 ID</b>: 在 Slack 频道详情里复制 Channel ID,用于测试消息和允许频道。</li>
          </ul>
        </section>
      `;
    }

    function mobileConnectionScreen(state, ui, facts) {
      const access = facts.publicAccess || {};
      const form = facts.publicAccessForm || {};
      const providers = Array.isArray(access.providers) && access.providers.length
        ? access.providers
        : [
            { id: "manual", label: "手动公网链接", description: "使用你自己配置好的 HTTPS 地址。" },
            { id: "cloudflared", label: "Cloudflare Quick Tunnel", description: "由 Second 启动 cloudflared 快速隧道。" },
          ];
      const provider = form.provider || access.provider || "manual";
      const manualProvider = provider === "manual";
      const activeUrl = access.activeUrl || "";
      const accessStatus = publicAccessStatus(access);
      const mobileStatus = onboardingMobileStatus(facts.mobilePwa, ui, facts.mobileSkipped);
      const connectedName = facts.slackReady ? "Slack 线程" : "消息线程";
      const pairingUrl = ui.mobilePairingUrl || "";
      return `
        <section class="setup-screen">
          ${screenHead(3, "连接手机决策端", "手机决策端必须通过手机能访问的 HTTPS 地址配对。先选择外网访问方式,再用手机相机扫码打开;暂时不需要手机决策时可以跳过。")}
          <div class="setup-mobile-grid">
            <article class="setup-public-card ${access.enabled ? "ready" : ""}">
              <div class="setup-mobile-card-head">
                <div>
                  <b>外网访问方式</b>
                  <p>二维码、Web Push 和手机决策都使用这个地址。</p>
                </div>
                <span class="pill ${accessStatus.cls}">${escapeHtml(accessStatus.label)}</span>
              </div>
              <div class="setup-public-form ${manualProvider ? "" : "single"}">
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
              <div class="setup-provider-note">
                ${providers.map((item) => `<span class="${item.id === provider ? "active" : ""}">${escapeHtml(item.label)}: ${escapeHtml(item.description || "")}</span>`).join("")}
              </div>
              <div class="setup-access-status">
                <div><b>当前地址</b><span class="mono">${activeUrl ? escapeHtml(activeUrl) : "尚未打开"}</span></div>
                <div><b>访问检测</b><span>${escapeHtml(publicAccessCheckLine(access.lastCheck))}</span></div>
              </div>
              ${access.lastError ? `<div class="public-access-error">${escapeHtml(access.lastError)}</div>` : ""}
              <div class="setup-mobile-actions">
                <button class="setup-primary-btn small" data-action="public-access-start" ${ui.busy === "public-access-start" ? "disabled" : ""}>${access.enabled ? "重新打开公网通道" : "打开公网通道"}</button>
                <div class="setup-mobile-action-links">
                  <button class="setup-secondary-btn" data-action="public-access-save">保存方式</button>
                  <button class="setup-secondary-btn" data-action="public-access-check" ${ui.busy === "public-access-check" ? "disabled" : ""}>检测访问</button>
                  <button class="setup-secondary-btn" data-action="public-access-copy-url" ${activeUrl ? "" : "disabled"}>复制地址</button>
                </div>
              </div>
            </article>
            <article class="setup-phone-card ${mobileStatus.ready ? "ready" : ""} ${facts.mobileSkipped ? "skipped" : ""}">
              <div class="setup-mobile-card-head">
                <div>
                  <b>手机连接</b>
                  <p>扫码后在手机浏览器打开,加入主屏幕后可接收系统通知。</p>
                </div>
                <span class="pill ${mobileStatus.cls}">${escapeHtml(mobileStatus.label)}</span>
              </div>
              ${facts.mobileSkipped ? `
                <div class="setup-phone-empty">
                  <b>已跳过手机连接</b>
                  <p>稍后可以在“消息端”页面重新生成二维码并开启通知。</p>
                </div>
              ` : pairingUrl ? `
                <div class="setup-pairing-box">
                  <div class="setup-pairing-qr">${ui.mobilePairingQrSvg || `<span>QR</span>`}</div>
                  <div class="setup-pairing-copy">
                    <b>手机相机扫码打开</b>
                    <p class="mono">${escapeHtml(pairingUrl)}</p>
                    <span>${escapeHtml(facts.mobilePwa?.subscriptionCount || 0)} 台设备已订阅 · 配对状态 ${facts.mobilePwa?.paired ? "已配对" : "等待手机打开"}</span>
                  </div>
                </div>
              ` : `
                <div class="setup-phone-empty">
                  <b>生成配对二维码</b>
                  <p>${activeUrl ? "会使用当前公网地址生成手机可打开的配对链接。" : "建议先打开或保存公网通道,避免二维码指向 localhost。"}</p>
                </div>
              `}
              <div class="setup-mobile-actions">
                <button class="setup-primary-btn small" data-action="mobile-refresh-pairing" ${ui.mobilePairingLoading ? "disabled" : ""}>${ui.mobilePairingLoading ? "生成中..." : pairingUrl ? "刷新配对二维码" : "生成配对二维码"}</button>
                <div class="setup-mobile-action-links">
                  <button class="setup-secondary-btn" data-action="mobile-copy-pairing-link" ${pairingUrl ? "" : "disabled"}>复制链接</button>
                  <button class="setup-secondary-btn" data-action="nav" data-view="mobile">打开消息端</button>
                  <button class="setup-secondary-btn" data-action="onboarding-skip-mobile">暂时跳过</button>
                </div>
              </div>
            </article>
          </div>
          <div class="setup-preview-label">你将看到的样子 · ${connectedName} 触发,Second 中处理</div>
          ${decisionPreview(state)}
        </section>
      `;
    }

    function decisionPreview(state) {
      return `
        <article class="setup-decision-preview">
          <div class="setup-preview-head">
            ${brandMarkSvg("#1d1b17", "setup-preview-logo")}
            <div><b>决策收件箱</b><p>Decision MCP · ${escapeHtml(state.profile?.agentName || "你的分身")}</p></div>
            <span class="pill risk-mid">中风险</span>
          </div>
          <h3>是否继续执行需要外部网络的查询?</h3>
          <p>分身已经整理背景、影响范围与推荐方案。你可以批准、拒绝,或补充更多信息后让同一 session 继续。</p>
          <div class="setup-preview-actions"><span>批准</span><span>拒绝</span><span>补充信息</span></div>
        </article>
      `;
    }

    function identityScreen(state, ui) {
      const profile = state.profile || {};
      const formName = ui.profileForm?.name ?? profile.name ?? "";
      const formRole = ui.profileForm?.roleIntro ?? profile.roleIntro ?? profile.tagline ?? "";
      return `
        <section class="setup-screen">
          ${screenHead(4, "确认你的分身身份", "在所有渠道里被 @ 到、被指派任务的,是同一个它:带同一份记忆、同一套授权,并明确标注由分身发送。")}
          <div class="setup-identity-grid">
            <div class="setup-profile-card">
              <div class="setup-profile-avatar">${profileAvatar(state)}</div>
              <div><b>${escapeHtml(profile.agentName || `${formName || "用户"}的分身`)}</b><p>${escapeHtml(formRole || "人只做决策 · 经验永不离职")}</p></div>
            </div>
            <label class="field">
              <span>用户名</span>
              <input data-profile-field="name" value="${escapeAttr(formName)}" maxlength="60" placeholder="例如: Jason" />
            </label>
            <label class="field setup-identity-role">
              <span>角色介绍</span>
              <textarea data-profile-field="roleIntro" maxlength="160" placeholder="一句话描述这个分身如何代表你工作">${escapeHtml(formRole)}</textarea>
            </label>
          </div>
          <div class="setup-action-row">
            <button class="setup-primary-btn small" data-action="save-profile">${ui.busy === "profile-save" ? "保存中..." : "保存身份"}</button>
            <button class="setup-secondary-btn" data-action="open-profile-settings">打开头像设置</button>
          </div>
          <div class="setup-flow-grid">
            <div><b>同事 @ 你</b><p>在 Slack 里像平常一样找你。</p></div>
            <span>→</span>
            <div class="hot"><b>分身先接住</b><p>授权范围内直接办,结果回原处。</p></div>
            <span>→</span>
            <div><b>只在决策点找你</b><p>办不了或越界的,带证据包来问你。</p></div>
          </div>
        </section>
      `;
    }

    function authorizationScreen(state, ui) {
      const selected = ui.onboardingAuthLevel || "balanced";
      const rules = state.rules || [];
      return `
        <section class="setup-screen">
          ${screenHead(5, "划好它替你做事的边界", "这是初始工作模式,不是静默长期授权。真正扩大授权必须进入 Second 授权页或 Decision MCP 决策链路。")}
          <div class="setup-auth-list">
            ${authOption("careful", "谨慎起步", "所有写操作与外部调用都先问你,先建立信任再放手。", "仅读取与检索", "其余全部", selected)}
            ${authOption("balanced", "平衡", "只读和本地验证自动放行;改动落盘之前经你确认。", "读文件、查日志、跑测试", "写文件、外部请求、git 操作", selected)}
            ${authOption("handoff", "放手", "常规操作交给分身,只有高风险动作需要你出现。", "读写、常规命令", "删除、部署、涉及支出", selected)}
          </div>
          <article class="setup-rules-card">
            <div><b>当前授权规则</b><span>${rules.length} 条</span></div>
            <p>${rules.length ? "已有规则会继续生效;新的规则候选仍需你确认。" : "当前还没有长期授权规则。分身会先按保守策略触发 Human Gate。"}</p>
            <button class="setup-secondary-btn" data-action="nav" data-view="auth">打开授权页</button>
          </article>
        </section>
      `;
    }

    function authOption(id, title, desc, auto, gate, selected) {
      const active = selected === id;
      return `
        <button class="setup-auth-option ${active ? "selected" : ""}" data-action="onboarding-auth-level" data-level="${escapeAttr(id)}">
          <span class="setup-choice-radio">${active ? "<span></span>" : ""}</span>
          <div>
            <div><b>${escapeHtml(title)}</b>${id === "balanced" ? `<em>推荐</em>` : ""}</div>
            <p>${escapeHtml(desc)}</p>
            <small><b>自动放行</b> ${escapeHtml(auto)} · <b>进 Human Gate</b> ${escapeHtml(gate)}</small>
          </div>
        </button>
      `;
    }

    function finishScreen(state, ui, form, facts) {
      const slackReady = facts.slackReady;
      const runtimeReady = facts.runtimeReady;
      const mobileLabel = facts.mobileSkipped
        ? "已跳过"
        : facts.mobileReady
          ? facts.mobilePwa?.subscriptionCount > 0
            ? `${facts.mobilePwa.subscriptionCount} 台设备`
            : "已配对"
          : "未连接";
      const testDisabled = runtimeReady ? "" : "disabled";
      return `
        <section class="setup-screen">
          <div class="setup-done-head">
            <span>${checkSvg()}</span>
            <h1>分身已在岗</h1>
          </div>
          <div class="setup-summary-strip">
            <span>引擎 <b>${escapeHtml(facts.defaultEngine?.name || "未选择")}</b></span>
            <span>渠道 <b>${slackReady ? "Slack 已配置" : "Slack 待配置"}</b></span>
            <span>通知 <b>${escapeHtml(mobileLabel)}</b></span>
            <span>授权 <b>${escapeHtml(authLevelName(ui.onboardingAuthLevel || "balanced"))}</b></span>
          </div>
          <article class="setup-test-card">
            <h2>试一试:模拟一条 Slack @ 消息</h2>
            <p>这会走本地渠道任务路径,创建一个带 Slack 来源信息的真实 Second 任务,再派发给默认 runtime。结果仍会在任务 Trace 中可见;如果 Slack token 可用,任务结果会回到配置的线程。</p>
            <div class="setup-test-line">
              ${renderProductLogo({ id: "slack", name: "Slack", mono: "S" }, "setup-channel-logo")}
              <div><b>Slack ${escapeHtml(form.decisionChannel || "CSECONDLOCAL")}</b><p>${escapeHtml(ui.onboardingDemoText || "帮我检查当前 Second daemon 是否可以处理来自 Slack 的任务")}</p></div>
            </div>
            <div class="setup-action-row">
              <button class="setup-primary-btn small" data-action="slack-simulate-task" ${testDisabled}>${ui.busy === "slack-simulate" ? "创建中..." : "模拟 Slack 入站任务"}</button>
              <button class="setup-secondary-btn" data-action="slack-test">发送 Slack 测试消息</button>
              <button class="setup-secondary-btn" data-action="nav" data-view="tasks">打开任务 Trace</button>
            </div>
            ${runtimeReady ? "" : `<div class="setup-block-reason">先完成 runtime 检测,才能创建并执行测试任务。</div>`}
          </article>
        </section>
      `;
    }

    function bottomNav(step, state, ui, facts) {
      const canNext = canProceed(step, state, ui, facts);
      const blockReason =
        step === 1 && !facts.runtimeReady
          ? "需要至少一个可用 runtime"
          : step === 3 && !facts.mobileReady && !ui.onboardingMobileSkipped
            ? "需要配对手机,或先跳过手机连接"
            : "";
      return `
        <div class="setup-nav-row">
          <button class="setup-secondary-btn" data-action="onboarding-back">上一步</button>
          <span></span>
          ${blockReason ? `<em>${escapeHtml(blockReason)}</em>` : ""}
          ${step === 3 && !facts.mobileReady && !ui.onboardingMobileSkipped ? `<button class="setup-secondary-btn" data-action="onboarding-skip-mobile">跳过手机连接</button>` : ""}
          <button class="setup-primary-btn small" ${canNext ? `data-action="onboarding-next"` : "disabled"}>继续</button>
        </div>
      `;
    }

    function screenHead(step, title, desc) {
      return `
        <div class="setup-kicker">第 ${step} 步 / 共 6 步</div>
        <h1>${escapeHtml(title)}</h1>
        <p class="setup-lead compact">${escapeHtml(desc)}</p>
      `;
    }

    function secretField(key, label, configured, tokenLabel, placeholder) {
      return `
        <label class="field">
          <span>${escapeHtml(label)} ${configured ? `<em class="secret-state">已配置${tokenLabel ? ` · ${escapeHtml(tokenLabel)}` : ""}</em>` : `<em class="secret-state missing">未配置</em>`}</span>
          <input type="password" autocomplete="off" data-slack-field="${escapeAttr(key)}" value="" placeholder="${escapeAttr(placeholder)}" />
        </label>
      `;
    }

    function renderProductLogo(item, extraClass = "") {
      if (productLogo) return productLogo(item, extraClass);
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
      return `<div class="${classes} settings-logo-fallback" aria-hidden="true">${escapeHtml(item?.mono || item?.name?.[0] || "?")}</div>`;
    }

    function profileAvatar(state) {
      const url = state.profile?.avatarUrl;
      if (url) return `<img src="${escapeAttr(url)}" alt="" loading="lazy" decoding="async" />`;
      return escapeHtml(state.profile?.avatar || state.profile?.name?.[0] || "S");
    }

    function brandMarkSvg(ink, className) {
      return `
        <span class="${escapeAttr(className)}" aria-hidden="true">
          <svg viewBox="0 0 96 96" fill="none" focusable="false">
            <path d="M66 26C66 26 52 20 42 26C32 32 34 42 44 46L56 51" stroke="#D9560B" stroke-width="11" stroke-linecap="round"></path>
            <path d="M40 45L52 50C62 54 64 64 54 70C44 76 30 70 30 70" stroke="${escapeAttr(ink)}" stroke-width="11" stroke-linecap="round"></path>
          </svg>
        </span>
      `;
    }

    function emptySetup(title, desc) {
      return `<div class="setup-empty"><b>${escapeHtml(title)}</b><p>${escapeHtml(desc)}</p></div>`;
    }

    function checkSvg() {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>`;
    }

    function canProceed(step, state, ui, facts) {
      if (step === 1) return facts.runtimeReady;
      if (step === 3) return facts.mobileReady || Boolean(ui.onboardingMobileSkipped);
      return true;
    }

    function isStepDone(step, state, ui) {
      if (step === 1) return Boolean(defaultRuntime(state)?.status === "ok");
      if (step === 2) return isSlackReady(state.integrations?.slack || {});
      if (step === 3) return isMobileReady(state.integrations?.mobilePwa || {}, ui) || Boolean(ui.onboardingMobileSkipped);
      if (step === 4) return Boolean(state.profile?.name);
      if (step === 5) return Boolean((state.rules || []).length || ui.onboardingAuthLevel);
      if (step === 6) return Boolean(defaultRuntime(state)?.status === "ok");
      return false;
    }

    function defaultRuntime(state) {
      const engines = state.engines || [];
      return engines.find((engine) => engine.id === state.settings?.defaultEngine) || engines.find((engine) => engine.status === "ok") || engines[0];
    }

    function isSlackReady(slack = {}) {
      if (!slack.botTokenConfigured) return false;
      if (slack.socketMode) return Boolean(slack.appTokenConfigured);
      return Boolean(slack.signingSecretConfigured && slack.publicUrl);
    }

    function isMobileReady(push = {}, ui = {}) {
      return Boolean(push.paired || push.subscriptionCount > 0 || ui.mobileMockStatus === "connected" || ui.mobileMockStatus === "sent");
    }

    function publicAccessStatus(access = {}) {
      if (!access.enabled) return { label: "未打开", cls: "kind-amber" };
      if (access.status === "online") return { label: "公网可访问", cls: "risk-low" };
      if (access.status === "starting") return { label: "启动中", cls: "kind-amber" };
      if (access.status === "error") return { label: "检测失败", cls: "risk-high" };
      if (access.activeUrl) return { label: "已配置", cls: "risk-low" };
      return { label: "待检测", cls: "kind-amber" };
    }

    function publicAccessCheckLine(check) {
      if (!check) return "尚未检测";
      if (check.ok) return `成功 · ${check.statusCode || 200} · ${relativeTime(check.at)}`;
      return `失败 · ${check.error || "无法访问"}`;
    }

    function onboardingMobileStatus(push = {}, ui = {}, skipped = false) {
      if (skipped) return { label: "已跳过", cls: "kind-amber", ready: false };
      if (push.subscriptionCount > 0) return { label: "已订阅", cls: "risk-low", ready: true };
      if (push.paired) return { label: "已配对", cls: "risk-low", ready: true };
      if (ui.mobileMockStatus === "connected" || ui.mobileMockStatus === "sent") return { label: "已连接", cls: "risk-low", ready: true };
      if (ui.mobilePairingUrl) return { label: "等待扫码", cls: "kind-amber", ready: false };
      return { label: "未连接", cls: "kind-amber", ready: false };
    }

    function runtimeInstallHint(engine = {}) {
      const id = engine.id || engine.name || "codex";
      if (id === "codex") return { command: "npm install -g @openai/codex", description: "通过 Codex CLI 执行本地任务" };
      if (id === "claude") return { command: "npm install -g @anthropic-ai/claude-code", description: "通过 Claude Code 执行本地任务" };
      if (id === "opencode") return { command: "brew install opencode", description: "本地或私有模型 runtime" };
      return { command: `${engine.command || id} --version`, description: "检查 runtime 是否在 PATH 中" };
    }

    function authLevelName(id) {
      return { careful: "谨慎起步", balanced: "平衡", handoff: "放手" }[id] || "平衡";
    }

    function clampStep(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return 0;
      return Math.max(0, Math.min(6, Math.round(number)));
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
    SETUP_STEPS,
    createOnboardingView,
  };
});
