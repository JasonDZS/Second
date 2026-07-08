"use strict";

const test = require("node:test");
const {
  EventEmitter,
  PassThrough,
  actions,
  apiClient,
  appendDecisionReply,
  assert,
  assistantWidgetUi,
  authViewUi,
  buildChannelFollowupPrompt,
  buildInitialPrompt,
  buildResumePrompt,
  channelController,
  channelProcessor,
  codexEvents,
  codexNetworkArgs,
  codexProcessClose,
  codexPrompts,
  codexResultHelpers,
  codexRuntimeFiles,
  codexTasks,
  computePhase1Metrics,
  createRuntimeManager,
  decisionDomain,
  evaluateToolUse,
  findChannelThreadTask,
  fs,
  httpJson,
  httpStatic,
  inboxViewUi,
  mobileViewUi,
  onboardingViewUi,
  os,
  path,
  prepareCodexRuntimeFiles,
  presentation,
  profileUi,
  qrCodeUi,
  renderSignatureUi,
  runtimeRecovery,
  runtimeResume,
  runtimeTaskExecutor,
  runtimeViewUi,
  runtimes,
  settingsViewUi,
  shellViewUi,
  slack,
  slackEvents,
  slackSettingsUi,
  slackSocket,
  slackText,
  stateViewDomain,
  taskTraceAgentViewUi,
  taskTraceFormatUi,
  taskTraceSourceViewUi,
  taskTraceViewUi,
  traceCore,
  uiStore,
  updateProfile,
} = require("../helpers/phase1-context");

test("TraceCore hides structural events and folds completion into agent bundles", () => {
  const segments = traceCore.taskTimelineSegments({
    id: "T-trace",
    trace: [
      { kind: "entry", title: "任务创建", description: "internal" },
      { kind: "runtime", title: "分身开始执行", description: "started" },
      { kind: "out", title: "执行完成", description: "saved" },
    ],
    agentEvents: [
      {
        id: "evt-1",
        seq: 1,
        runtime: "codex",
        phase: "run",
        runId: "run-1",
        rawType: "turn_started",
        kind: "system",
        title: "Turn Started",
      },
      {
        id: "evt-2",
        seq: 2,
        runtime: "codex",
        phase: "run",
        runId: "run-1",
        rawType: "turn_completed",
        kind: "success",
        title: "Turn Completed",
      },
    ],
  });

  assert.equal(segments.some((segment) => segment.event?.title === "任务创建"), false);
  const bundle = segments.find((segment) => segment.type === "agent-bundle");
  assert.equal(bundle.completionEvent.title, "执行完成");
});

test("TraceCore aligns repeated resume context events with matching runtime groups", () => {
  const resumeOne = { kind: "runtime", title: "分身继续执行", description: "Human Gate resume 1" };
  const resumeTwo = { kind: "runtime", title: "分身继续执行", description: "Human Gate resume 2" };
  const segments = traceCore.taskTimelineSegments({
    id: "T-resume",
    trace: [resumeOne, resumeTwo],
    agentEvents: [
      {
        id: "r1-start",
        seq: 1,
        runtime: "codex",
        phase: "resume",
        runId: "resume-1",
        rawType: "thread_started",
        kind: "system",
        title: "Thread Started",
      },
      {
        id: "r2-start",
        seq: 2,
        runtime: "codex",
        phase: "resume",
        runId: "resume-2",
        rawType: "thread_started",
        kind: "system",
        title: "Thread Started",
      },
    ],
  });

  const bundles = segments.filter((segment) => segment.type === "agent-bundle");
  assert.equal(bundles.length, 2);
  assert.equal(bundles[0].runId, "resume-1");
  assert.equal(bundles[0].contextEvents[0], resumeOne);
  assert.equal(bundles[1].runId, "resume-2");
  assert.equal(bundles[1].contextEvents[0], resumeTwo);
});

test("frontend API client serializes JSON and surfaces server errors", async () => {
  const calls = [];
  const ok = await apiClient.request(
    "/api/example",
    { method: "POST", body: { ok: true } },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          async json() {
            return { saved: true };
          },
        };
      },
    },
  );

  assert.deepEqual(ok, { saved: true });
  assert.equal(calls[0].url, "/api/example");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.body, "{\"ok\":true}");

  await assert.rejects(
    () =>
      apiClient.request("/api/fail", {}, {
        fetchImpl: async () => ({
          ok: false,
          status: 409,
          async json() {
            return { error: "Conflict" };
          },
        }),
      }),
    /Conflict/,
  );
});

test("frontend UI store creates isolated state containers", () => {
  const first = uiStore.createInitialState();
  const second = uiStore.createInitialState();
  assert.equal(first.view, "inbox");
  assert.equal(first.busy, false);
  assert.equal(first.assistantOpen, false);
  assert.equal(first.assistantConversationId, "local-assistant");
  assert.equal(first.mobilePairingUrl, "");
  assert.deepEqual(first.mobileReplyDrafts, {});
  assert.deepEqual(first.mobileReplyOpen, {});
  assert.equal(first.onboardingMobileSkipped, false);
  assert.notEqual(first.execOpen, second.execOpen);
  assert.equal(uiStore.toggleFlag(first.execOpen, "bundle-1"), true);
  assert.equal(first.execOpen["bundle-1"], true);
  assert.equal(second.execOpen["bundle-1"], undefined);
});

test("frontend QR helper renders a scannable SVG for mobile pairing links", () => {
  const svg = qrCodeUi.toSvg("http://127.0.0.1:7318/mobile.html?pair=test", {
    className: "mobile-qr-svg",
    title: "Second mobile pairing",
  });

  assert.match(svg, /^<svg/);
  assert.match(svg, /viewBox="0 0 57 57"/);
  assert.match(svg, /class="mobile-qr-svg"/);
  assert.match(svg, /<path fill="#1d1b17"/);
  assert.match(svg, /Second mobile pairing/);
});

test("frontend assistant widget renders floating chat history and pending task state", () => {
  const widget = assistantWidgetUi.createAssistantWidget(presentation);
  const state = {
    assistant: {
      activeConversationId: "local-assistant",
      messages: [
        {
          id: "AM-1",
          role: "user",
          actor: "你",
          text: "总结今天的阻塞项",
          at: "2026-07-08T08:00:00.000Z",
          conversationId: "local-assistant",
        },
        {
          id: "AM-2",
          role: "assistant",
          actor: "测试分身",
          text: "状态正常。\n\n- 时间: `2026-07-08 12:07:43 CST`\n- 系统: **macOS**\n\n<img src=x onerror=alert(1)>",
          at: "2026-07-08T08:00:02.000Z",
          conversationId: "local-assistant",
          inReplyTo: "AM-1",
        },
      ],
    },
    tasks: [
      {
        id: "T-assistant",
        status: "running",
        agent: "测试分身",
        startedAt: "2026-07-08T08:00:01.000Z",
        channel: { id: "assistant", external: { messageId: "AM-1" } },
      },
    ],
  };

  const launcher = widget.render(state, { assistantOpen: false });
  assert.match(launcher, /assistant-launcher/);
  assert.match(launcher, /assistant-launcher-badge/);

  const panel = widget.render(state, { assistantOpen: true, assistantDraft: "继续" });
  assert.match(panel, /assistant-panel/);
  assert.match(panel, /总结今天的阻塞项/);
  assert.match(panel, /<ul><li>时间: <code>2026-07-08 12:07:43 CST<\/code><\/li><li>系统: <strong>macOS<\/strong><\/li><\/ul>/);
  assert.match(panel, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(panel, /<img src=x/);
  assert.match(panel, /data-assistant-field="draft"/);
});

test("frontend assistant markdown renderer supports code blocks and ordered lists safely", () => {
  const html = assistantWidgetUi.renderAssistantMarkdown([
    "## 检查结果",
    "",
    "1. `daemon` 在线",
    "2. **API** 正常",
    "",
    "```",
    "<script>alert(1)</script>",
    "```",
  ].join("\n"));

  assert.match(html, /<h2>检查结果<\/h2>/);
  assert.match(html, /<ol><li><code>daemon<\/code> 在线<\/li><li><strong>API<\/strong> 正常<\/li><\/ol>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("frontend presentation helpers format status, exec rows, and escaping", () => {
  assert.deepEqual(presentation.taskStatus({ status: "pending_resume" }), {
    label: "等待恢复",
    cls: "kind-amber",
  });
  assert.equal(presentation.escapeHtml("<b>\"Second\"</b>"), "&lt;b&gt;&quot;Second&quot;&lt;/b&gt;");
  assert.deepEqual(presentation.normalizeExec([["now", "BASH", "npm test"]]), [
    { time: "now", tool: "BASH", text: "npm test" },
  ]);
  assert.equal(
    presentation.shortPath("/Volumes/Samsung_T5/project/Second/.second/tasks/T-1"),
    ".second/tasks/T-1",
  );
});

test("frontend render signatures ignore unrelated runtime noise for inbox view", () => {
  const baseState = {
    profile: { name: "Jason", avatar: "J", agentName: "Jason 的分身" },
    rules: [{ id: "R-1" }],
    metrics: { pendingDecisions: 1, runningTasks: 0 },
    decisions: [{ id: "D-1", status: "pending", title: "Need approval", options: [] }],
    tasks: [],
    events: [{ type: "heartbeat", text: "old" }],
  };
  const ui = { view: "inbox", selectedDecision: "D-1" };
  const first = renderSignatureUi.renderSignature(baseState, ui);
  const second = renderSignatureUi.renderSignature(
    { ...baseState, events: [{ type: "heartbeat", text: "new" }] },
    ui,
  );
  assert.equal(first, second);
  assert.notEqual(
    first,
    renderSignatureUi.renderSignature(
      { ...baseState, decisions: [{ ...baseState.decisions[0], title: "Changed" }] },
      ui,
    ),
  );

  const mobileUi = { view: "mobile" };
  const mobileBase = {
    ...baseState,
    metrics: { pendingDecisions: 0 },
    integrations: { mobilePwa: { subscriptionCount: 0, subscriptions: [] } },
  };
  const mobileFirst = renderSignatureUi.renderSignature(mobileBase, mobileUi);
  const mobileSecond = renderSignatureUi.renderSignature(
    {
      ...mobileBase,
      integrations: {
        mobilePwa: {
          subscriptionCount: 1,
          subscriptions: [{ id: "sub-1", label: "iOS · Safari", endpointHost: "web.push.apple.com" }],
        },
      },
    },
    mobileUi,
  );
  assert.notEqual(mobileFirst, mobileSecond);
});

test("frontend onboarding render signatures ignore message channel event churn", () => {
  const ui = { view: "onboarding", onboardingStep: 2, onboardingChannel: "discord" };
  const baseDiscord = {
    id: "discord",
    label: "Discord",
    configured: true,
    missingFields: [],
    botTokenConfigured: true,
    botTokenLabel: "abc...xyz",
    messageContentIntent: false,
    recentEvents: [{ type: "channel.gateway.connecting", at: "2026-07-08T00:00:00.000Z" }],
  };
  const baseState = {
    profile: { name: "Jason", avatar: "J", agentName: "Jason 的分身" },
    rules: [],
    metrics: { pendingDecisions: 0, runningTasks: 0 },
    decisions: [],
    tasks: [],
    daemon: { port: 7317 },
    engines: [{ id: "codex", status: "ok" }],
    settings: { defaultEngine: "codex" },
    integrations: {
      slack: {
        socketMode: true,
        botTokenConfigured: true,
        appTokenConfigured: true,
        recentEvents: [{ type: "channel.socket.connecting", at: "2026-07-08T00:00:00.000Z" }],
      },
      discord: baseDiscord,
      channelConfigs: { discord: baseDiscord },
    },
  };

  const first = renderSignatureUi.renderSignature(baseState, ui);
  const eventOnly = renderSignatureUi.renderSignature(
    {
      ...baseState,
      integrations: {
        ...baseState.integrations,
        slack: {
          ...baseState.integrations.slack,
          recentEvents: [{ type: "channel.socket.error", at: "2026-07-08T00:00:02.000Z" }],
        },
        discord: {
          ...baseDiscord,
          recentEvents: [{ type: "channel.gateway.error", at: "2026-07-08T00:00:02.000Z" }],
        },
        channelConfigs: {
          discord: {
            ...baseDiscord,
            recentEvents: [{ type: "channel.gateway.error", at: "2026-07-08T00:00:02.000Z" }],
          },
        },
      },
    },
    ui,
  );
  assert.equal(first, eventOnly);

  assert.notEqual(
    first,
    renderSignatureUi.renderSignature(
      {
        ...baseState,
        integrations: {
          ...baseState.integrations,
          discord: { ...baseDiscord, configured: false, missingFields: ["botToken"] },
          channelConfigs: {
            discord: { ...baseDiscord, configured: false, missingFields: ["botToken"] },
          },
        },
      },
      ui,
    ),
  );
});

test("frontend shell view renders navigation and profile modal through a focused module", () => {
  const shell = shellViewUi.createShellView({
    PRODUCT_NAME: "Second",
    ...presentation,
    ...profileUi,
  });
  const html = shell.sidebar(
    {
      profile: { name: "Jason", tagline: "主要做算法/模型/智能体" },
      rules: [{ id: "R-1" }, { id: "R-2" }],
      metrics: { pendingDecisions: 2, runningTasks: 99 },
      tasks: [
        { id: "T-1", status: "running" },
        { id: "T-2", status: "needs_human" },
        { id: "T-3", status: "paused" },
        { id: "T-4", status: "done" },
      ],
      engines: [{ id: "codex", status: "ok" }],
      settings: { defaultEngine: "codex" },
    },
    { view: "tasks" },
  );
  assert.match(html, /<span>任<\/span><span>务<\/span>/);
  assert.match(html, /nav-label short/);
  assert.match(html, /nav-fill/);
  assert.match(html, /nav-badge/);
  assert.match(html, /nav-inbox[\s\S]*?<span class="nav-badge">2<\/span>/);
  assert.match(html, /nav-tasks[\s\S]*?<span class="nav-badge">2<\/span>/);
  assert.equal(shellViewUi.activeTaskCount({ tasks: [{ status: "running" }, { status: "paused" }, { status: "needs_human" }] }), 2);
  assert.equal(shellViewUi.activeTaskCount({ metrics: { runningTasks: 3 } }), 3);
  assert.match(html, /Jason/);
  assert.doesNotMatch(html, /主要做算法/);
  assert.match(html, /初始化引导/);
  assert.match(html, /真实手机端/);
  assert.doesNotMatch(html, /手机端 mock/);
  assert.doesNotMatch(html, /本地分身 adapter/);
  assert.doesNotMatch(html, /run 队列/);
  assert.match(html, /data-view="onboarding"/);
  assert.doesNotMatch(html, /setup-entry-count/);

  const modal = shell.profileSettingsModal(profileUi.profileFormFromState({ name: "Jason" }), {});
  assert.match(modal, /data-action="random-profile-avatar"/);
  assert.doesNotMatch(modal, /data-avatar-config-field/);
  assert.doesNotMatch(modal, /头像种子/);
});

test("frontend auth view renders candidates and authorization rules", () => {
  const auth = authViewUi.createAuthView(presentation);
  const html = auth.render({
    preferences: [{ text: "中文 PR 描述", source: "PREFERENCES.md" }],
    tasks: [{ id: "T-auth", title: "授权测试任务", workspace: "/tmp/workspace" }],
    decisions: [{ id: "D-auth", status: "pending", authorization: { fingerprint: "abc123" } }],
    authorization: { grants: [{ id: "G-1", status: "active", fingerprint: "abc123" }] },
    candidates: [{ id: "C-1", confidence: "高", status: "pending", text: "允许本地测试", source: "history" }],
    rules: [{ kind: "强制 Gate", text: "生产变更必须审批", source: "AUTHORIZATION.md", fresh: true }],
  }, {
    authLab: {
      input: "cat .env",
      result: {
        action: "deny",
        reason: "Reading secrets is never allowed.",
        ruleId: "deny.expose_credentials",
        fingerprint: "abc123",
        intent: {
          action: "read",
          target: { type: "path", value: ".env" },
          environment: "local",
          reversibility: "reversible",
          identity: "agent",
        },
      },
    },
  });
  assert.match(html, /授权与记忆/);
  assert.match(html, /Authorization Lab/);
  assert.match(html, /授权控制台/);
  assert.match(html, /data-action="auth-lab-submit"/);
  assert.match(html, /data-action="auth-overview-refresh"/);
  assert.match(html, /data-action="auth-audit-refresh"/);
  assert.match(html, /data-action="authorization-grant-revoke"/);
  assert.match(html, /data-auth-lab-field="taskId"/);
  assert.match(html, /data-auth-lab-field="workspace"/);
  assert.match(html, /data-auth-lab-field="environment"/);
  assert.match(html, /deny\.expose_credentials/);
  assert.match(html, /Grant ledger/);
  assert.match(html, /Grant 管理/);
  assert.match(html, /审计日志/);
  assert.match(html, /data-action="candidate"/);
  assert.match(html, /生产变更必须审批/);
});

test("frontend inbox view renders decisions, options, and reply composer", () => {
  const inbox = inboxViewUi.createInboxView({
    ...presentation,
    emptyPage: (title, message) => `<div>${title}:${message}</div>`,
  });
  const html = inbox.render(
    {
      metrics: { pendingDecisions: 1 },
      decisions: [
        {
          id: "D-1",
          type: "补充",
          risk: "低",
          title: "需要 OpenRouter 凭据",
          source: "Slack #baton-test",
          agent: "测试分身",
          taskId: "T-1",
          taskTitle: "查额度",
          engine: "Codex CLI",
          status: "pending",
          selectedOption: "provide",
          summary: "缺少 API key。",
          impact: ["不会写入文件"],
          options: [
            {
              id: "provide",
              label: "提供信息",
              description: "补充 key 或余额截图",
              recommended: true,
            },
          ],
          artifacts: [{ label: "trace" }],
          replies: [
            {
              role: "human",
              actor: "你",
              at: "2026-07-07T00:00:00.000Z",
              message: "这里是补充信息",
            },
          ],
        },
      ],
    },
    { selectedDecision: "D-1", replyDrafts: { "D-1": "继续补充" }, busy: false },
  );

  assert.match(html, /决策收件箱/);
  assert.match(html, /data-action="resolve-decision"/);
  assert.match(html, /data-action="select-option"/);
  assert.match(html, /data-reply-field/);
  assert.match(html, /查看完整 Trace/);
});

test("frontend mobile view renders PWA push controls and pending decisions", () => {
  const mobile = mobileViewUi.createMobileView({
    PRODUCT_NAME: "Second",
    ...presentation,
    brandMark: (className) => `<span class="${className}">S</span>`,
  });
  const pairingUrl = "https://second.example.com/mobile.html?pair=test";
  const pairingQrSvg = qrCodeUi.toSvg(pairingUrl, { className: "mobile-qr-svg" });
  const html = mobile.render({
    profile: { agentName: "测试分身" },
    metrics: { completedTasks: 2, highRiskBlocks: 1, zeroHandoffRate: 100 },
    integrations: {
      publicAccess: {
        enabled: true,
        activeUrl: "https://second.example.com",
        status: "online",
      },
      mobilePwa: {
        subscriptionCount: 1,
        subscriptions: [
          {
            id: "sub-1",
            label: "iOS · Safari",
            endpointHost: "web.push.apple.com",
            lastSeenAt: "2026-07-08T00:05:00.000Z",
          },
        ],
      },
    },
    decisions: [
      {
        id: "D-1",
        status: "pending",
        title: "是否继续",
        risk: "中",
        taskId: "T-1",
        agent: "测试分身",
        selectedOption: "a",
        options: [
          { id: "a", label: "批准", description: "继续当前方案", recommended: true },
          { id: "b", label: "拒绝", description: "要求调整" },
        ],
      },
    ],
  }, {
    busy: false,
    mobileExpanded: { "D-1": true },
    mobileReplyDrafts: { "D-1": "请补充凭证位置" },
    mobileReplyOpen: { "D-1": true },
    mobilePairingQrSvg: pairingQrSvg,
    mobilePairingUrl: pairingUrl,
  }, { available: true, permission: "default" });

  assert.match(html, /消息端/);
  assert.match(html, /手机决策端/);
  assert.match(html, /mobile-phone-device/);
  assert.match(html, /mobile-notification-center/);
  assert.match(html, /Second · 决策请求/);
  assert.match(html, /mobile-lock-hint/);
  assert.match(html, /点开处理/);
  assert.doesNotMatch(html, /mobile-lock-action primary/);
  assert.match(html, /mobile-sticky-top/);
  assert.match(html, /mobile-settings-bar/);
  assert.match(html, /mobile-card-detail/);
  assert.match(html, /mobile-device-card/);
  assert.match(html, /mobile-public-access-card ready/);
  assert.match(html, /手机公网通道/);
  assert.match(html, /iOS · Safari/);
  assert.match(html, /web\.push\.apple\.com/);
  assert.match(html, /data-action="mobile-delete-subscription"/);
  assert.match(html, /mobile-card-carousel/);
  assert.match(html, /mobile-carousel-dots/);
  assert.match(html, /data-action="mobile-push-subscribe"/);
  assert.match(html, /data-action="mobile-push-test"/);
  assert.match(html, /data-action="mobile-copy-pairing-link"/);
  assert.match(html, /data-action="mobile-refresh-pairing"/);
  assert.match(html, /data-action="mobile-toggle-decision"/);
  assert.match(html, /data-action="mobile-toggle-reply"/);
  assert.match(html, /data-action="mobile-send-decision-reply"/);
  assert.match(html, /发送给智能体/);
  assert.match(html, /data-mobile-reply-field/);
  assert.match(html, /请补充凭证位置/);
  assert.match(html, /data-action="mobile-resolve-decision"/);
  assert.match(html, /data-verdict="approved"/);
  assert.match(html, /继续当前方案/);
  assert.match(html, /mobile-evidence-drawer/);
  assert.match(html, /mobile-pairing-card/);
  assert.match(html, /mobile-qr-svg/);
  assert.match(html, /手机相机扫描/);
  assert.match(html, /公开服务地址/);
  const css = fs.readFileSync(path.join(__dirname, "../../public/styles.css"), "utf8");
  assert.match(css, /\.mobile-card-detail\s*\{[^}]*overflow-y: auto/s);
  assert.match(css, /\.mobile-card-carousel\s*\{[^}]*max-width: 100%/s);
  assert.match(css, /\.mobile-card-carousel > \.mobile-decision-card\s*\{[^}]*max-width: 100%/s);
  assert.match(css, /\.mobile-decision-card\.resolved\s*\{[^}]*max-height: 248px/s);
  assert.match(css, /\.mobile-reply-composer textarea\s*\{[^}]*font-size: 16px/s);
  assert.match(css, /\.mobile-app-surface input,\s*\.mobile-app-surface textarea,\s*\.mobile-app-surface select\s*\{[^}]*font-size: 16px/s);
  assert.doesNotMatch(css, /\.mobile-card-carousel\s*\{[^}]*margin: 0 -16px/s);
  assert.doesNotMatch(css, /\.mobile-decision-list\.secondary \.mobile-decision-card\.resolved p\s*\{[^}]*-webkit-line-clamp/s);
  const serviceWorker = fs.readFileSync(path.join(__dirname, "../../public/service-worker.js"), "utf8");
  assert.match(serviceWorker, /OPEN_ACTIONS = new Set\(\["more", "open"\]\)/);
  assert.match(serviceWorker, /notificationBody\(payload, \[\]\)/);
  assert.match(serviceWorker, /function isIosWorker\(\)/);
  assert.match(serviceWorker, /Math\.min\(actions\.length, 2\)/);
  const mobileApp = fs.readFileSync(path.join(__dirname, "../../public/mobile-app.js"), "utf8");
  assert.match(mobileApp, /syncReplySendButton\(id, event\.target\.value\)/);
  const desktopApp = fs.readFileSync(path.join(__dirname, "../../public/app.js"), "utf8");
  assert.match(desktopApp, /syncMobileReplySendButton\(id, event\.target\.value\)/);

  const handset = mobile.render({ decisions: [], integrations: { mobilePwa: {} } }, { busy: false }, { available: true }, { surface: "handset" });
  assert.match(handset, /mobile-app-surface/);
  assert.doesNotMatch(handset, /mobile-phone-device/);

  const iosHandset = mobile.render(
    { decisions: [], integrations: { mobilePwa: { paired: true, subscriptionCount: 0 } } },
    { busy: false },
    { available: false, ios: true, standalone: false, reason: "iPhone 需要先添加到主屏幕" },
    { surface: "handset" },
  );
  assert.match(iosHandset, /系统通知/);
  assert.match(iosHandset, /需从主屏幕打开/);
  assert.match(iosHandset, /未订阅/);
  assert.match(iosHandset, /添加到主屏幕/);

  const pairing = mobile.render({ mobilePairingRequired: true });
  assert.match(pairing, /需要配对/);
  assert.doesNotMatch(pairing, /data-action="mobile-resolve-decision"/);
});

test("frontend onboarding view renders real setup actions and mobile connection flow", () => {
  const onboarding = onboardingViewUi.createOnboardingView({
    PRODUCT_NAME: "Second",
    PRODUCT_LOGO_SOURCES: traceCore.PRODUCT_LOGO_SOURCES,
    ...presentation,
    ...slackSettingsUi,
  });
  const state = {
    daemon: { port: 7317 },
    profile: { name: "Jason", agentName: "Jason 的分身" },
    rules: [],
    settings: { defaultEngine: "codex", codexNetworkAccess: false },
    engines: [{ id: "codex", name: "Codex CLI", command: "codex", status: "ok" }],
    channels: [
      { id: "slack", name: "Slack", status: "disconnected", notify: true },
      { id: "telegram", name: "Telegram", status: "connected", notify: true },
      { id: "discord", name: "Discord", status: "disconnected", notify: true },
    ],
    integrations: {
      publicAccess: {
        enabled: true,
        provider: "cloudflared",
        activeUrl: "https://second.example.com",
        status: "online",
        providers: [
          { id: "manual", label: "手动公网链接", description: "使用自有公网地址。" },
          { id: "cloudflared", label: "Cloudflare Quick Tunnel", description: "启动 cloudflared。" },
        ],
        lastCheck: { ok: true, at: "2026-07-08T00:00:00.000Z", statusCode: 200 },
      },
      mobilePwa: { paired: false, subscriptionCount: 0, subscriptions: [] },
      slack: {
        socketMode: true,
        botTokenConfigured: true,
        botTokenLabel: "xoxb-...",
        appTokenConfigured: false,
      },
      telegram: {
        id: "telegram",
        label: "Telegram",
        webhookPath: "/telegram/webhook",
        configured: true,
        missingFields: [],
        fieldLabels: { botToken: "Bot Token" },
        botTokenConfigured: true,
        botTokenLabel: "12345...abcd",
        webhookSecretConfigured: false,
        allowedUsers: "88",
        allowedChannels: "-1001",
        testTarget: "-1001",
        sources: { botToken: "local" },
      },
      discord: {
        id: "discord",
        label: "Discord",
        webhookPath: "/discord/webhook",
        configured: true,
        missingFields: [],
        fieldLabels: { botToken: "Bot Token", applicationId: "Application ID" },
        botTokenConfigured: true,
        botTokenLabel: "abc...xyz",
        applicationId: "123456789012345678",
        messageContentIntent: false,
        sources: { botToken: "local", applicationId: "local" },
      },
    },
  };
  const form = () => ({
    socketMode: true,
    customizeProfileMessages: true,
    botToken: "",
    appToken: "",
    decisionChannel: "C1",
    allowedChannels: "C1",
  });
  const publicAccessForm = () => ({
    provider: "cloudflared",
    manualUrl: "https://second.example.com",
  });
  const channelForm = (id) => slackSettingsUi.messageChannelFormFromPublic(id, state.integrations[id] || {});
  const pairingUrl = "https://second.example.com/mobile.html?pair=test";
  const pairingQrSvg = qrCodeUi.toSvg(pairingUrl, { className: "mobile-qr-svg" });
  const welcome = onboarding.render(state, { busy: false, mobileMockStatus: "idle", onboardingStep: 0 }, form);
  const runtime = onboarding.render(state, { busy: false, mobileMockStatus: "idle", onboardingStep: 1 }, form);
  const channel = onboarding.render(state, { busy: false, mobileMockStatus: "idle", onboardingStep: 2 }, form, publicAccessForm, channelForm);
  const telegramChannel = onboarding.render(
    state,
    { busy: false, mobileMockStatus: "idle", onboardingStep: 2, onboardingChannel: "telegram" },
    form,
    publicAccessForm,
    channelForm,
  );
  const mobileConnection = onboarding.render(
    state,
    { busy: false, mobileMockStatus: "idle", onboardingStep: 3, mobilePairingUrl: pairingUrl, mobilePairingQrSvg: pairingQrSvg },
    form,
    publicAccessForm,
  );
  const skipped = onboarding.render(
    state,
    { busy: false, mobileMockStatus: "idle", onboardingStep: 3, onboardingMobileSkipped: true },
    form,
    publicAccessForm,
  );
  const finish = onboarding.render(state, { busy: false, mobileMockStatus: "idle", onboardingStep: 6, onboardingMobileSkipped: true }, form, publicAccessForm);

  assert.match(welcome, /把你的分身接进来/);
  assert.match(runtime, /data-action="detect-engines"/);
  assert.match(channel, /data-action="save-slack-config"/);
  assert.match(channel, /data-slack-field="botToken"/);
  assert.match(channel, /data-action="onboarding-channel" data-id="discord"/);
  assert.match(channel, /data-action="onboarding-channel" data-id="telegram"/);
  assert.match(channel, /data-action="onboarding-channel" data-id="whatsapp"/);
  assert.match(channel, /data-action="onboarding-channel" data-id="dingding"/);
  assert.match(channel, /data-action="onboarding-channel" data-id="feishu"/);
  assert.match(channel, /data-onboarding-channel-status="slack"/);
  assert.match(channel, /data-onboarding-channel-status="discord"/);
  assert.match(channel, /Slack 最少只要 3 项/);
  assert.match(channel, /https:\/\/api\.slack\.com\/apps/);
  assert.match(channel, /App-Level Token/);
  assert.match(channel, /高级设置/);
  assert.match(channel, /aria-current="step"/);
  assert.match(channel, /onboarding-current-label">当前/);
  assert.match(telegramChannel, /Telegram 这些值从哪里获取/);
  assert.match(telegramChannel, /https:\/\/core\.telegram\.org\/bots\/api/);
  assert.match(telegramChannel, /data-channel-field="botToken"/);
  assert.match(telegramChannel, /data-channel-field="webhookSecret"/);
  assert.match(telegramChannel, /data-action="save-channel-config" data-id="telegram"/);
  assert.match(telegramChannel, /\/telegram\/webhook/);
  const discordChannel = onboarding.render(
    state,
    { busy: false, mobileMockStatus: "idle", onboardingStep: 2, onboardingChannel: "discord" },
    form,
    publicAccessForm,
    channelForm,
  );
  assert.match(discordChannel, /Discord 最少只要 3 项/);
  assert.match(discordChannel, /data-channel-field="applicationId"/);
  assert.match(discordChannel, /data-channel-field="messageContentIntent"/);
  assert.match(discordChannel, /discord\.com\/oauth2\/authorize\?client_id=123456789012345678/);
  assert.match(discordChannel, /复制基础邀请链接/);
  assert.doesNotMatch(discordChannel, /\/discord\/webhook/);
  assert.match(discordChannel, /Missing Access/);
  assert.match(mobileConnection, /连接手机决策端/);
  assert.match(mobileConnection, /外网访问方式/);
  assert.match(mobileConnection, /data-public-access-field="provider"/);
  assert.doesNotMatch(mobileConnection, /data-public-access-field="manualUrl"/);
  assert.match(mobileConnection, /data-action="public-access-start"/);
  assert.match(mobileConnection, /data-action="public-access-check"/);
  assert.match(mobileConnection, /data-action="mobile-refresh-pairing"/);
  assert.match(mobileConnection, /data-action="mobile-copy-pairing-link"/);
  assert.match(mobileConnection, /data-action="onboarding-skip-mobile"/);
  assert.match(mobileConnection, /mobile-qr-svg/);
  assert.match(mobileConnection, /需要配对手机,或先跳过手机连接/);
  assert.match(skipped, /已跳过手机连接/);
  assert.match(finish, /通知 <b>已跳过<\/b>/);
  assert.match(finish, /data-action="slack-simulate-task"/);
  const css = fs.readFileSync(path.join(__dirname, "../../public/styles.css"), "utf8");
  assert.match(css, /\.setup-channel-picker\s*\{/);
  assert.match(css, /\.setup-mobile-grid\s*\{/);
  assert.match(css, /\.setup-mobile-actions\s*\{/);
  assert.match(css, /\.setup-mobile-action-links\s*\{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.setup-public-form\.single\s*\{/);
});

test("frontend settings view renders engines, channel details, and network toggles", () => {
  const settings = settingsViewUi.createSettingsView({
    PRODUCT_NAME: "Second",
    PRODUCT_LOGO_SOURCES: traceCore.PRODUCT_LOGO_SOURCES,
    ...presentation,
    ...slackSettingsUi,
  });
  const state = {
    daemon: { port: 7317 },
    settings: { codexNetworkAccess: true, lastScan: "2026-07-07T00:00:00.000Z" },
    engines: [{ id: "codex", name: "Codex", status: "ok", version: "1.0.0", isDefault: true }],
    channels: [
      { id: "assistant", name: "对话助手", status: "connected", notify: true, meta: "本地浮动消息助手 · 右下角常驻" },
      { id: "slack", name: "Slack", status: "connected", notify: true, meta: "Socket Mode · 允许频道 2" },
      { id: "telegram", name: "Telegram", status: "connected", notify: true, meta: "Bot token 已配置 · webhook 入口 /telegram/webhook" },
      { id: "linear", name: "Linear", status: "not_configured", notify: false, meta: "连接后支持 issue 同步" },
    ],
    integrations: {
      publicAccess: {
        enabled: true,
        provider: "manual",
        providerLabel: "手动公网链接",
        manualUrl: "https://second.example.com",
        activeUrl: "https://second.example.com",
        status: "online",
        providers: [
          { id: "manual", label: "手动公网链接", description: "使用自有公网地址。" },
          { id: "cloudflared", label: "Cloudflare Quick Tunnel", description: "启动 cloudflared。" },
        ],
        lastCheck: { ok: true, at: "2026-07-08T00:00:00.000Z", statusCode: 200 },
      },
      slack: { socketMode: true, botTokenConfigured: true, botTokenLabel: "xoxb-..." },
      telegram: {
        id: "telegram",
        label: "Telegram",
        webhookPath: "/telegram/webhook",
        configured: true,
        missingFields: [],
        fieldLabels: { botToken: "Bot Token" },
        botTokenConfigured: true,
        botTokenLabel: "12345...abcd",
        webhookSecretConfigured: false,
        allowedUsers: "88",
        allowedChannels: "-1001",
        testTarget: "-1001",
        sources: { botToken: "local" },
      },
    },
    metrics: { pendingDecisions: 1 },
  };
  const slackForm = () => ({
    socketMode: true,
    customizeProfileMessages: true,
    publicUrl: "",
    decisionChannel: "C1",
    allowedUsers: "",
    allowedChannels: "",
    botToken: "",
    appToken: "",
    signingSecret: "",
  });
  const channelForm = (id) => slackSettingsUi.messageChannelFormFromPublic(id, state.integrations[id] || {});
  const html = settings.render(
    state,
    { busy: false, slackManifest: "" },
    slackForm,
    () => ({
      provider: "manual",
      manualUrl: "https://second.example.com",
    }),
  );

  assert.match(html, /Agent 执行环境/);
  assert.match(html, /手机公网通道/);
  assert.match(html, /logo-assistant/);
  assert.match(html, /settings-icon-proxy/);
  assert.doesNotMatch(html, /settings-logo-fallback[^>]*>\s*A\s*</);
  assert.match(html, /data-public-access-field="provider"/);
  assert.match(html, /data-public-access-field="manualUrl"/);
  assert.match(html, /data-action="public-access-save"/);
  assert.match(html, /data-action="public-access-start"/);
  assert.match(html, /data-action="public-access-check"/);
  assert.match(html, /data-action="public-access-copy-url"/);
  assert.match(html, /data-action="public-access-stop"/);
  assert.match(html, /https:\/\/second\.example\.com/);
  assert.match(html, /data-action="codex-network-toggle"/);
  assert.match(html, /本地智能体网络代理/);
  assert.match(html, /SECOND_AUTH_PROXY/);
  assert.doesNotMatch(html, /Codex CLI 网络访问/);
  assert.doesNotMatch(html, /检测方式/);
  assert.match(html, /data-action="channel-config" data-id="slack"/);
  assert.match(html, /data-action="channel-config" data-id="assistant"/);
  assert.match(html, /data-action="channel-config" data-id="telegram"/);
  assert.match(html, /data-action="channel-config" data-id="linear"/);
  assert.match(html, /channel-processing-toggle/);
  assert.doesNotMatch(html, /data-action="channel-status"/);
  assert.doesNotMatch(html, />断开</);
  assert.match(html, /配置/);
  assert.doesNotMatch(html, /Bot User OAuth Token/);

  const cloudflareHtml = settings.render(
    state,
    { busy: false, slackManifest: "" },
    slackForm,
    () => ({
      provider: "cloudflared",
      manualUrl: "https://second.example.com",
    }),
  );
  assert.match(cloudflareHtml, /Cloudflare Quick Tunnel/);
  assert.doesNotMatch(cloudflareHtml, /data-public-access-field="manualUrl"/);

  const modalHtml = settings.render(
    state,
    { busy: false, slackManifest: "", settingsChannelConfig: "slack" },
    slackForm,
    () => ({
      provider: "manual",
      manualUrl: "https://second.example.com",
    }),
    channelForm,
  );
  assert.match(modalHtml, /settings-channel-modal/);
  assert.match(modalHtml, /data-action="close-settings-channel-config"/);
  assert.match(modalHtml, /Bot User OAuth Token/);
  assert.match(modalHtml, /Socket Mode/);

  const telegramModalHtml = settings.render(
    state,
    { busy: false, slackManifest: "", settingsChannelConfig: "telegram" },
    slackForm,
    () => ({
      provider: "manual",
      manualUrl: "https://second.example.com",
    }),
    channelForm,
  );
  assert.match(telegramModalHtml, /Telegram 集成/);
  assert.match(telegramModalHtml, /data-channel-field="botToken"/);
  assert.match(telegramModalHtml, /data-channel-field="webhookSecret"/);
  assert.match(telegramModalHtml, /data-action="save-channel-config" data-id="telegram"/);
  assert.match(telegramModalHtml, /data-action="channel-test-message" data-id="telegram"/);
  assert.match(telegramModalHtml, /\/telegram\/webhook/);

  const css = fs.readFileSync(path.join(__dirname, "../../public/styles.css"), "utf8");
  assert.match(css, /\.public-access-grid\s*\{/);
  assert.match(css, /\.public-access-grid\.single\s*\{/);
  assert.match(css, /\.settings-layout\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/s);
  assert.match(css, /\.field input,\s*\.field textarea,\s*\.field select\s*\{/);
});

test("frontend task trace format sanitizes secrets and runtime noise", () => {
  const format = taskTraceFormatUi.createTaskTraceFormat({ PRODUCT_NAME: "Second" });
  assert.equal(format.sanitizeTraceText("pid 123 · workspace /tmp/run"), "分身已接管任务。");
  assert.equal(format.sanitizeTraceText("api_key=sk-or-v1-abcdef1234567890"), "api_key=已隐藏");
  assert.equal(format.sanitizeTraceMeta("pid 123 workspace /tmp/run"), "");
  assert.equal(format.sanitizeAgentCardText('{"session_id":"019f3be5-1cdd-7a60-9c86-888f5f61151d"}'), '{"session_id":"已隐藏"}');
  assert.equal(format.appendText("one", "two"), "one\ntwo");
});

test("frontend task trace view renders source events and agent bundles", () => {
  const traceFormat = taskTraceFormatUi.createTaskTraceFormat({ PRODUCT_NAME: "Second" });
  const sourceView = taskTraceSourceViewUi.createTaskTraceSourceView({
    TraceCore: traceCore,
    DEFAULT_SOURCE_CHANNEL: traceCore.DEFAULT_SOURCE_CHANNEL,
    ...presentation,
  });
  let taskTrace = null;
  const agentView = taskTraceAgentViewUi.createTaskTraceAgentView({
    TraceCore: traceCore,
    ...presentation,
    displayTraceEvent: (event, task) => taskTrace.displayTraceEvent(event, task),
    getUi: () => ({ execOpen: {} }),
    traceFormat,
  });
  taskTrace = taskTraceViewUi.createTaskTraceView({
    PRODUCT_NAME: "Second",
    TraceCore: traceCore,
    DEFAULT_SOURCE_CHANNEL: traceCore.DEFAULT_SOURCE_CHANNEL,
    ...presentation,
    agentView,
    sourceView,
    traceFormat,
  });
  const html = taskTrace.render(
    {
      events: [{ type: "codex.start", taskId: "T-trace", at: "2026-07-07T00:00:00.000Z" }],
      tasks: [
        {
          id: "T-trace",
          title: "查看额度",
          source: "Slack #baton-test",
          agent: "测试分身",
          status: "running",
          startedAt: "2026-07-07T00:00:00.000Z",
          channel: { id: "slack", external: { channel: "C1", channelLabel: "#baton-test", user: "U1", eventTs: "1783419239.992019" } },
          messageText: "帮我看下 OpenRouter 额度",
          trace: [{ kind: "runtime", title: "分身开始执行", description: "pid 123 · workspace /tmp/run" }],
          agentEvents: [
            {
              key: "A-1",
              seq: 1,
              runtime: "codex",
              phase: "run",
              runId: "run-1",
              kind: "assistant",
              title: "Turn Completed",
              text: "完成查询",
            },
          ],
        },
      ],
    },
    { selectedTask: "T-trace", execOpen: {} },
  );

  assert.match(html, /任务与 Trace/);
  assert.match(html, /Slack/);
  assert.match(html, /帮我看下 OpenRouter 额度/);
  assert.match(html, /测试分身执行流/);
  assert.match(taskTrace.displayEventLogText({ type: "codex.session", taskId: "T-trace" }), /codex\.session\.ready/);
});

test("frontend task trace view renders assistant source and follow-up messages as cards", () => {
  const traceFormat = taskTraceFormatUi.createTaskTraceFormat({ PRODUCT_NAME: "Second" });
  const sourceView = taskTraceSourceViewUi.createTaskTraceSourceView({
    TraceCore: traceCore,
    DEFAULT_SOURCE_CHANNEL: traceCore.DEFAULT_SOURCE_CHANNEL,
    ...presentation,
  });
  let taskTrace = null;
  const agentView = taskTraceAgentViewUi.createTaskTraceAgentView({
    TraceCore: traceCore,
    ...presentation,
    displayTraceEvent: (event, task) => taskTrace.displayTraceEvent(event, task),
    getUi: () => ({ execOpen: {} }),
    traceFormat,
  });
  taskTrace = taskTraceViewUi.createTaskTraceView({
    PRODUCT_NAME: "Second",
    TraceCore: traceCore,
    DEFAULT_SOURCE_CHANNEL: traceCore.DEFAULT_SOURCE_CHANNEL,
    ...presentation,
    agentView,
    sourceView,
    traceFormat,
  });
  const html = taskTrace.render(
    {
      events: [],
      tasks: [
        {
          id: "T-assistant-trace",
          title: "看本机状态",
          source: "对话助手",
          agent: "Jason的分身",
          status: "running",
          channel: {
            id: "assistant",
            name: "对话助手",
            external: {
              channel: "assistant",
              threadTs: "local-assistant",
              conversationId: "local-assistant",
              user: "Jason",
              eventTs: "2026-07-08T04:07:43.000Z",
            },
          },
          messageText: "看下本机的状态",
          trace: [
            { kind: "entry", actor: "对话助手", time: "刚刚", title: "会话新消息", description: "本机存储利用情况", meta: "conversation · assistant:local-assistant" },
          ],
          agentEvents: [],
        },
      ],
    },
    { selectedTask: "T-assistant-trace", execOpen: {} },
  );

  assert.equal(traceCore.sourceChannelAdapter("assistant").label, "对话助手");
  assert.match(html, /source-event-badge/);
  assert.match(html, /source-icon-assistant/);
  assert.match(html, /source-assistant-robot/);
  assert.match(html, /对话助手/);
  assert.match(html, /输入消息/);
  assert.match(html, /继续输入/);
  assert.match(html, /看下本机的状态/);
  assert.match(html, /本机存储利用情况/);
  assert.match(html, /conversation local-assistant/);
  assert.doesNotMatch(html, />信息源</);
});

test("frontend runtime view renders launcher, running rows, and event logs", () => {
  const runtime = runtimeViewUi.createRuntimeView({
    PRODUCT_NAME: "Second",
    ...presentation,
    agentEventsForTask: (task) => task.agentEvents || [],
    displayEventLogText: (event) => event.text || event.type,
    displayTraceEvent: (event) => ({ title: event.title || event.kind }),
  });
  const html = runtime.render(
    {
      daemon: { startedAt: "2026-07-07T00:00:00.000Z", version: "0.1.0", port: 7317 },
      profile: { agentName: "测试分身" },
      engines: [{ id: "codex", status: "ok" }],
      metrics: { zeroHandoffRate: 100, medianDecisionLatency: "1m", decisionInterruptionDensity: 0.5 },
      archived: { tasks: 1, decisions: 0 },
      decisions: [{ risk: "高" }],
      events: [{ type: "codex.start", text: "started" }],
      tasks: [
        {
          id: "T-runtime",
          title: "运行任务",
          status: "running",
          agent: "测试分身",
          startedAt: "2026-07-07T00:00:00.000Z",
          trace: [{ kind: "runtime", title: "开始执行", time: "刚刚" }],
          agentEvents: [{ id: "A-1" }],
        },
      ],
    },
    {
      busy: false,
      sessionOpen: { "T-runtime": true },
      taskPrompt: "hello",
      taskWorkspace: "",
    },
  );

  assert.match(html, /运行时/);
  assert.match(html, /data-action="create-task"/);
  assert.match(html, /T-runtime/);
  assert.match(html, /Agent 事件/);
  assert.match(html, /started/);
});

test("frontend profile helpers normalize forms and Nice Avatar assets", () => {
  const form = profileUi.profileFormFromState({
    name: "Jason",
    tagline: "主要做算法/模型/智能体",
    avatarConfig: { sex: "woman", hairStyle: "womanLong", shirtColor: "#6BD9E9" },
    avatarShape: "rounded",
  });

  assert.equal(form.name, "Jason");
  assert.equal(form.roleIntro, "主要做算法/模型/智能体");
  assert.equal(form.avatarSeed, "Jason");
  assert.equal(form.avatarShape, "rounded");
  assert.equal(form.avatarConfig.sex, "woman");
  assert.equal(form.avatarConfig.hairStyle, "womanLong");
  assert.match(profileUi.niceAvatarDataUrl(form.avatarConfig, form.avatarShape), /^data:image\/svg\+xml;charset=UTF-8,/);

  const seed = profileUi.randomProfileSeed(1_783_419_200_000, (() => {
    const values = [0, 0.123456];
    let index = 0;
    return () => values[index++] ?? 0.5;
  })());
  assert.match(seed, /^atlas-[a-z0-9]+-[a-z0-9]+$/);
});

test("frontend Slack settings helpers build safe forms and status labels", () => {
  const empty = slackSettingsUi.slackFormFromPublic({});
  assert.equal(empty.socketMode, true);
  assert.equal(empty.botToken, "");

  const configured = slackSettingsUi.slackFormFromPublic({
    socketMode: false,
    botTokenConfigured: true,
    publicUrl: "https://example.com",
    allowedChannels: "C1,C2",
  });
  assert.equal(configured.socketMode, false);
  assert.equal(configured.publicUrl, "https://example.com");
  assert.equal(configured.allowedChannels, "C1,C2");

  assert.deepEqual(slackSettingsUi.latestSlackStatus({ socketMode: true, appTokenConfigured: false }), {
    label: "缺少 xapp token",
    cls: "risk-high",
  });
  assert.deepEqual(slackSettingsUi.channelMetaParts("Socket Mode · 允许频道 2"), ["Socket Mode", "允许频道 2"]);

  const telegramForm = slackSettingsUi.messageChannelFormFromPublic("telegram", {
    botTokenConfigured: true,
    allowedChannels: "-1001",
    testTarget: "-1001",
  });
  assert.equal(telegramForm.botToken, "");
  assert.equal(telegramForm.allowedChannels, "-1001");
  const discordForm = slackSettingsUi.messageChannelFormFromPublic("discord", {
    applicationId: "123456789012345678",
    messageContentIntent: true,
  });
  assert.equal(discordForm.applicationId, "123456789012345678");
  assert.equal(discordForm.messageContentIntent, true);
  assert.equal(
    slackSettingsUi.discordInviteUrl("123456789012345678"),
    "https://discord.com/oauth2/authorize?client_id=123456789012345678&scope=bot&permissions=68608",
  );
  assert.equal(
    slackSettingsUi.discordInviteUrl("123456789012345678", { threads: true }),
    "https://discord.com/oauth2/authorize?client_id=123456789012345678&scope=bot&permissions=274877975552",
  );
  assert.equal(slackSettingsUi.isMessageChannelConfigurable("telegram"), true);
  assert.equal(slackSettingsUi.normalizeMessageChannelId("dingtalk"), "dingding");
  assert.deepEqual(slackSettingsUi.latestMessageChannelStatus("telegram", { missingFields: ["botToken"], fieldLabels: { botToken: "Bot Token" } }), {
    label: "缺少 Bot Token",
    cls: "risk-high",
  });
  assert.deepEqual(slackSettingsUi.latestMessageChannelStatus("discord", {
    recentEvents: [
      { type: "channel.gateway.connecting" },
      { type: "channel.gateway.error" },
    ],
  }), {
    label: "Gateway 异常",
    cls: "risk-high",
  });
  assert.deepEqual(slackSettingsUi.latestMessageChannelStatus("discord", {
    recentEvents: [{ type: "channel.gateway.failed" }],
  }), {
    label: "Gateway 连接失败",
    cls: "risk-high",
  });
});

test("frontend action handler mutates UI state through injected dependencies", async () => {
  const ui = {
    view: "inbox",
    execOpen: {},
    sessionOpen: {},
    replyDrafts: {},
    mobileExpanded: {},
    mobileReplyDrafts: {},
    mobileReplyOpen: {},
    channelForms: {},
    taskPrompt: "say hello",
    taskWorkspace: "",
  };
  const calls = [];
  const copied = [];
  let renders = 0;
  let refreshes = 0;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (text) => copied.push(text) } },
  });
  const handler = actions.createActionHandler({
    MobilePwa: {
      subscribe: async (request) => request("/api/mobile/push/subscribe", { method: "POST", body: { subscription: { endpoint: "https://push.example/sub" } } }),
      unsubscribe: async (request) => request("/api/mobile/push/unsubscribe", { method: "POST", body: { endpoint: "https://push.example/sub" } }),
    },
    PRODUCT_NAME: "Second",
    QrCode: qrCodeUi,
    UiStore: uiStore,
    api: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === "/api/mobile/pairing") return { url: "https://second.example.com/mobile.html?pair=test" };
      if (url === "/api/integrations/telegram/config") {
        return {
          channel: {
            id: "telegram",
            label: "Telegram",
            botTokenConfigured: true,
            webhookSecretConfigured: false,
            allowedChannels: "-1001",
            testTarget: "-1001",
          },
        };
      }
      if (url === "/api/integrations/telegram/test-message") return { result: { ok: true } };
      return {};
    },
    app: { querySelector: () => null },
    cssEscape: (value) => value,
    currentProfileForm: () => ({}),
    currentChannelForm: (id) => ui.channelForms[id] || {},
    currentSlackForm: () => ({}),
    getState: () => ({
      decisions: [{ id: "D-1", selectedOption: "a" }],
      integrations: {
        slack: {},
        telegram: {
          id: "telegram",
          label: "Telegram",
          botTokenConfigured: false,
          webhookSecretConfigured: false,
          allowedChannels: "-1001",
          testTarget: "-1001",
        },
      },
    }),
    profileFormFromState: () => ({ name: "Tester" }),
    randomProfileSeed: () => "seed",
    refresh: async () => {
      refreshes += 1;
    },
    render: () => {
      renders += 1;
    },
    showToast: (message) => {
      calls.push({ toast: message });
    },
    isMessageChannelConfigurable: slackSettingsUi.isMessageChannelConfigurable,
    messageChannelFormFromPublic: slackSettingsUi.messageChannelFormFromPublic,
    messageChannelPublicConfig: slackSettingsUi.messageChannelPublicConfig,
    normalizeMessageChannelId: slackSettingsUi.normalizeMessageChannelId,
    slackFormFromPublic: slackSettingsUi.slackFormFromPublic,
    ui,
    updateProfileModalPreview: () => {
      calls.push({ preview: true });
    },
  });

  await handler({ action: "nav", view: "tasks" });
  assert.equal(ui.view, "tasks");
  await handler({ action: "onboarding-channel", id: "telegram" });
  assert.equal(ui.onboardingChannel, "telegram");
  assert.equal(ui.channelForms.telegram.allowedChannels, "-1001");
  await handler({ action: "channel-config", id: "slack" });
  assert.equal(ui.settingsChannelConfig, "slack");
  await handler({ action: "close-settings-channel-config" });
  assert.equal(ui.settingsChannelConfig, null);
  await handler({ action: "channel-config", id: "assistant" });
  assert.equal(calls.some((call) => call.toast === "对话助手无需额外配置，可用开关控制是否处理本地对话"), true);
  await handler({ action: "channel-config", id: "telegram" });
  assert.equal(ui.settingsChannelConfig, "telegram");
  ui.channelForms.telegram.botToken = "123:abc";
  await handler({ action: "save-channel-config", id: "telegram" });
  assert.equal(calls.some((call) => call.url === "/api/integrations/telegram/config" && call.options.body.botToken === "123:abc"), true);
  await handler({ action: "channel-test-message", id: "telegram" });
  assert.equal(calls.some((call) => call.url === "/api/integrations/telegram/test-message" && call.options.body.channel === "-1001"), true);
  await handler({ action: "channel-toggle", id: "assistant", notify: "false" });
  assert.equal(calls.some((call) => call.url === "/api/channels/assistant" && call.options.body.notify === false), true);
  await handler({ action: "noop" });
  ui.onboardingStep = 3;
  await handler({ action: "onboarding-skip-mobile" });
  assert.equal(ui.onboardingMobileSkipped, true);
  assert.equal(ui.onboardingStep, 4);
  await handler({ action: "toggle-exec", key: "bundle-1" });
  assert.equal(ui.execOpen["bundle-1"], true);
  await handler({ action: "mobile-mock-connect" });
  assert.equal(ui.mobileMockStatus, "connected");
  await handler({ action: "mobile-push-subscribe" });
  assert.equal(calls.some((call) => call.url === "/api/mobile/push/subscribe"), true);
  await handler({ action: "mobile-delete-subscription", id: "sub-1" });
  assert.equal(calls.some((call) => call.url === "/api/mobile/push/subscriptions/sub-1" && call.options.method === "DELETE"), true);
  await handler({ action: "mobile-copy-pairing-link" });
  assert.equal(copied.includes("https://second.example.com/mobile.html?pair=test"), true);
  assert.equal(ui.mobilePairingUrl, "https://second.example.com/mobile.html?pair=test");
  assert.match(ui.mobilePairingQrSvg, /mobile-qr-svg/);
  await handler({ action: "mobile-refresh-pairing" });
  assert.match(ui.mobilePairingQrSvg, /Second mobile pairing/);
  await handler({ action: "mobile-toggle-decision", id: "D-1" });
  assert.equal(ui.mobileExpanded["D-1"], true);
  await handler({ action: "mobile-toggle-reply", id: "D-1" });
  assert.equal(ui.mobileReplyOpen["D-1"], true);
  ui.mobileReplyDrafts["D-1"] = "请补充更多证据";
  await handler({ action: "mobile-send-decision-reply", id: "D-1" });
  assert.equal(calls.some((call) => call.url === "/api/decisions/D-1/reply" && call.options.body.message === "请补充更多证据"), true);
  assert.equal(ui.mobileReplyOpen["D-1"], false);
  await handler({ action: "mobile-resolve-decision", id: "D-1", verdict: "approved" });
  assert.equal(calls.some((call) => call.url === "/api/decisions/D-1/resolve"), true);
  ui.assistantDraft = "本地对话";
  await handler({ action: "assistant-send" });
  assert.equal(calls.some((call) => call.url === "/assistant/messages"), true);
  assert.equal(ui.assistantDraft, "");
  assert.equal(ui.assistantOpen, true);
  await handler({ action: "create-task" });
  assert.equal(calls.some((call) => call.url === "/api/tasks"), true);
  assert.equal(ui.view, "runtime");
  assert.equal(refreshes, 8);
  assert.ok(renders >= 3);
  if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
  else delete globalThis.navigator;
});

test("frontend authorization lab submits dry-run requests to daemon API", async () => {
  const ui = {
    authLab: {
      input: "psql prod -c 'update orders set status=1'",
      taskId: "T-auth",
      workspace: "/tmp/second-auth-workspace",
      environment: "prod",
      result: null,
      error: "",
    },
  };
  const calls = [];
  let renders = 0;
  const handler = actions.createActionHandler({
    PRODUCT_NAME: "Second",
    api: async (url, options = {}) => {
      calls.push({ url, options });
      return {
        action: "gate",
        ruleId: "gate.prod_write",
        fingerprint: "fp1",
        intent: { action: "write" },
      };
    },
    app: { querySelector: () => null },
    currentProfileForm: () => ({}),
    currentPublicAccessForm: () => ({}),
    currentSlackForm: () => ({}),
    getState: () => ({
      decisions: [],
      integrations: {},
      tasks: [{ id: "T-auth", workspace: "/tmp/second-auth-workspace" }],
    }),
    profileFormFromState: () => ({}),
    refresh: async () => {},
    render: () => {
      renders += 1;
    },
    showToast: () => {},
    slackFormFromPublic: slackSettingsUi.slackFormFromPublic,
    ui,
    updateProfileModalPreview: () => {},
  });

  await handler({ action: "auth-lab-submit" });
  assert.equal(calls[0].url, "/api/authorize");
  assert.equal(calls[0].options.body.dryRun, true);
  assert.equal(calls[0].options.body.mode, "dry_run");
  assert.equal(calls[0].options.body.command, "psql prod -c 'update orders set status=1'");
  assert.equal(calls[0].options.body.taskId, "T-auth");
  assert.equal(calls[0].options.body.workspace, "/tmp/second-auth-workspace");
  assert.equal(calls[0].options.body.task_ctx.workspace, "/tmp/second-auth-workspace");
  assert.equal(calls[0].options.body.runtime_ctx.environment, "prod");
  assert.equal(ui.authLab.result.action, "gate");
  assert.ok(renders >= 2);

  await handler({ action: "auth-lab-example", example: "deny" });
  assert.equal(ui.authLab.input, "cat .env");
  assert.equal(ui.authLab.result, null);
});

test("frontend authorization console refreshes overview, audit, grants, and candidates", async () => {
  const ui = {
    authLab: { input: "rg TODO server" },
    authOverview: null,
    authAudit: null,
  };
  const calls = [];
  let refreshes = 0;
  let renders = 0;
  const handler = actions.createActionHandler({
    PRODUCT_NAME: "Second",
    api: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === "/api/authorization/overview") {
        return {
          policy: { defaults: { unknown_action: "gate" }, counts: { allow: 1, gate: 2, deny: 3 } },
          grants: { active: 1, total: 1, items: [] },
          decisions: { pending: 0, total: 0, recent: [] },
          audit: [{ event: "authorization.allow" }],
        };
      }
      if (url === "/api/authorization/audit?limit=100") return { audit: [{ event: "authorization.gate" }] };
      if (url === "/api/candidates/extract") return { candidates: [{ id: "RC-1" }] };
      return { grant: { id: "G-1", status: "revoked" } };
    },
    app: { querySelector: () => null },
    currentProfileForm: () => ({}),
    currentPublicAccessForm: () => ({}),
    currentSlackForm: () => ({}),
    getState: () => ({ decisions: [], integrations: {}, tasks: [] }),
    profileFormFromState: () => ({}),
    refresh: async () => {
      refreshes += 1;
    },
    render: () => {
      renders += 1;
    },
    showToast: () => {},
    slackFormFromPublic: slackSettingsUi.slackFormFromPublic,
    ui,
    updateProfileModalPreview: () => {},
  });

  await handler({ action: "auth-overview-refresh" });
  assert.equal(ui.authOverview.grants.active, 1);
  assert.equal(ui.authAudit[0].event, "authorization.allow");

  await handler({ action: "auth-audit-refresh" });
  assert.equal(ui.authAudit[0].event, "authorization.gate");

  await handler({ action: "authorization-grant-revoke", id: "G-1" });
  assert.equal(calls.some((call) => call.url === "/api/authorization/grants/G-1/revoke"), true);

  await handler({ action: "candidates-extract" });
  assert.equal(calls.some((call) => call.url === "/api/candidates/extract"), true);
  assert.equal(refreshes, 2);
  assert.ok(renders >= 4);
});
