"use strict";

const test = require("node:test");
const {
  EventEmitter,
  PassThrough,
  actions,
  apiClient,
  appendDecisionReply,
  assert,
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
  os,
  path,
  prepareCodexRuntimeFiles,
  presentation,
  profileUi,
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
  assert.notEqual(first.execOpen, second.execOpen);
  assert.equal(uiStore.toggleFlag(first.execOpen, "bundle-1"), true);
  assert.equal(first.execOpen["bundle-1"], true);
  assert.equal(second.execOpen["bundle-1"], undefined);
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
      metrics: { pendingDecisions: 2, runningTasks: 1 },
      engines: [{ id: "codex", status: "ok" }],
      settings: { defaultEngine: "codex" },
    },
    { view: "tasks" },
  );
  assert.match(html, /任务/);
  assert.match(html, /nav-badge/);
  assert.match(html, /Jason/);

  const modal = shell.profileSettingsModal(profileUi.profileFormFromState({ name: "Jason" }), {});
  assert.match(modal, /data-action="random-profile-avatar"/);
  assert.doesNotMatch(modal, /data-avatar-config-field/);
  assert.doesNotMatch(modal, /头像种子/);
});

test("frontend auth view renders candidates and authorization rules", () => {
  const auth = authViewUi.createAuthView(presentation);
  const html = auth.render({
    preferences: [{ text: "中文 PR 描述", source: "PREFERENCES.md" }],
    candidates: [{ id: "C-1", confidence: "高", status: "pending", text: "允许本地测试", source: "history" }],
    rules: [{ kind: "强制 Gate", text: "生产变更必须审批", source: "AUTHORIZATION.md", fresh: true }],
  });
  assert.match(html, /授权与记忆/);
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

test("frontend mobile view renders pending decisions with phone and Slack controls", () => {
  const mobile = mobileViewUi.createMobileView({
    PRODUCT_NAME: "Second",
    ...presentation,
    brandMark: (className) => `<span class="${className}">S</span>`,
  });
  const html = mobile.render({
    profile: { agentName: "测试分身" },
    metrics: { completedTasks: 2, highRiskBlocks: 1, zeroHandoffRate: 100 },
    decisions: [
      {
        id: "D-1",
        status: "pending",
        title: "是否继续",
        risk: "中",
        taskId: "T-1",
        agent: "测试分身",
      },
    ],
  });

  assert.match(html, /轻决策/);
  assert.match(html, /data-verdict="approved"/);
  assert.match(html, /Slack · 审批按钮消息/);
});

test("frontend settings view renders engines, Slack secrets, and network toggles", () => {
  const settings = settingsViewUi.createSettingsView({
    PRODUCT_NAME: "Second",
    PRODUCT_LOGO_SOURCES: traceCore.PRODUCT_LOGO_SOURCES,
    ...presentation,
    ...slackSettingsUi,
  });
  const html = settings.render(
    {
      daemon: { port: 7317 },
      settings: { codexNetworkAccess: true, lastScan: "2026-07-07T00:00:00.000Z" },
      engines: [{ id: "codex", name: "Codex", status: "ok", version: "1.0.0", isDefault: true }],
      channels: [{ id: "slack", name: "Slack", status: "connected", notify: true, meta: "Socket Mode · 允许频道 2" }],
      integrations: { slack: { socketMode: true, botTokenConfigured: true, botTokenLabel: "xoxb-..." } },
      metrics: { pendingDecisions: 1 },
    },
    { busy: false, slackManifest: "" },
    () => ({
      socketMode: true,
      customizeProfileMessages: true,
      publicUrl: "",
      decisionChannel: "C1",
      allowedUsers: "",
      allowedChannels: "",
      botToken: "",
      appToken: "",
      signingSecret: "",
    }),
  );

  assert.match(html, /Agent 执行环境/);
  assert.match(html, /data-action="codex-network-toggle"/);
  assert.match(html, /Bot User OAuth Token/);
  assert.match(html, /Socket Mode/);
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
});

test("frontend action handler mutates UI state through injected dependencies", async () => {
  const ui = {
    view: "inbox",
    execOpen: {},
    sessionOpen: {},
    replyDrafts: {},
    taskPrompt: "say hello",
    taskWorkspace: "",
  };
  const calls = [];
  let renders = 0;
  let refreshes = 0;
  const handler = actions.createActionHandler({
    PRODUCT_NAME: "Second",
    UiStore: uiStore,
    api: async (url, options = {}) => {
      calls.push({ url, options });
      return {};
    },
    app: { querySelector: () => null },
    cssEscape: (value) => value,
    currentProfileForm: () => ({}),
    currentSlackForm: () => ({}),
    getState: () => ({ decisions: [], integrations: { slack: {} } }),
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
    slackFormFromPublic: slackSettingsUi.slackFormFromPublic,
    ui,
    updateProfileModalPreview: () => {
      calls.push({ preview: true });
    },
  });

  await handler({ action: "nav", view: "tasks" });
  assert.equal(ui.view, "tasks");
  await handler({ action: "toggle-exec", key: "bundle-1" });
  assert.equal(ui.execOpen["bundle-1"], true);
  await handler({ action: "create-task" });
  assert.equal(calls.some((call) => call.url === "/api/tasks"), true);
  assert.equal(ui.view, "runtime");
  assert.equal(refreshes, 1);
  assert.ok(renders >= 3);
});

