"use strict";

const test = require("node:test");
const { handleIntegrationRoutes } = require("../../server/http/routes/integrations");
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
  httpMobileRoutes,
  httpStatic,
  inboxViewUi,
  mobilePush,
  mobileViewUi,
  os,
  path,
  prepareCodexRuntimeFiles,
  presentation,
  profileUi,
  publicAccess,
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

test("policy allows normal read-only commands and gates production mutations", () => {
  assert.equal(evaluateToolUse({ tool: "Bash", command: "rg TODO server" }).decision, "allow");

  const gated = evaluateToolUse({ tool: "Bash", command: "psql prod -c 'update orders set status=1'" });
  assert.equal(gated.decision, "human_gate");
  assert.equal(gated.risk, "高");

  const denied = evaluateToolUse({ tool: "Bash", command: "cat .env" });
  assert.equal(denied.decision, "deny");
});

test("phase1 metrics are computed from decisions and tasks", () => {
  const metrics = computePhase1Metrics({
    tasks: [
      { id: "T-1", status: "done", channel: { id: "slack" } },
      { id: "T-2", status: "failed" },
      { id: "T-3", status: "done", codexSessionId: "019f3a9b-e38c-7650-8fd6-98c6eaf05f8f" },
    ],
    decisions: [
      {
        id: "D-1",
        taskId: "T-3",
        status: "approved",
        createdAt: "2026-07-07T00:00:00.000Z",
        decidedAt: "2026-07-07T00:04:00.000Z",
      },
      {
        id: "D-2",
        taskId: "T-1",
        status: "approved",
        createdAt: "2026-07-07T00:00:00.000Z",
        decidedAt: "2026-07-07T00:08:00.000Z",
      },
    ],
  });

  assert.equal(metrics.zeroHandoffRate, 50);
  assert.equal(metrics.taskSuccessRate, 67);
  assert.equal(metrics.decisionInterruptionDensity, 0.67);
  assert.equal(metrics.medianDecisionLatency, "6m");
});

test("decision domain helpers normalize supplemental replies", () => {
  assert.equal(
    decisionDomain.cleanReplyMessage("  hello  \n\n\n\nworld  ", 100),
    "hello\n\n\nworld",
  );
  assert.equal(decisionDomain.shortId("1234567890abcdef"), "12345678...cdef");
});

test("HTTP static helpers return stable content types", () => {
  assert.equal(httpStatic.contentType("index.html"), "text/html; charset=utf-8");
  assert.equal(httpStatic.contentType("app.js"), "application/javascript; charset=utf-8");
  assert.equal(httpStatic.contentType("manifest.webmanifest"), "application/manifest+json; charset=utf-8");
  assert.equal(httpStatic.contentType("logo.png"), "image/png");
  assert.equal(httpStatic.contentType("unknown.bin"), "application/octet-stream");
});

test("mobile Web Push helpers generate browser-compatible VAPID keys", () => {
  const vapid = mobilePush.generateVapid();
  const publicKey = mobilePush.vapidPublicKey(vapid);
  const decoded = Buffer.from(publicKey, "base64url");
  assert.equal(decoded.length, 65);
  assert.equal(decoded[0], 0x04);
  assert.match(mobilePush.vapidJwt("https://push.example.test", vapid), /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(mobilePush.redactPushText("api_key=sk-testsecretsecretsecret"), "api_key=已隐藏");
  assert.equal(mobilePush.bearerToken("Bearer mobile-token"), "mobile-token");
  assert.equal(mobilePush.isLocalHostHeader("127.0.0.1:7318"), true);
  assert.equal(mobilePush.isLocalHostHeader("second.example.com"), false);
  assert.equal(mobilePush.hashToken("abc"), mobilePush.hashToken("abc"));
  assert.equal(
    mobilePush.mobilePublicBaseUrl({ SECOND_MOBILE_PUBLIC_URL: "https://mobile.example.com/base/" }),
    "https://mobile.example.com/base",
  );
  assert.equal(
    mobilePush.mobilePublicBaseUrl(
      { SECOND_MOBILE_PUBLIC_URL: "https://env.example.com/" },
      () => "https://settings.example.com/",
    ),
    "https://settings.example.com",
  );
  assert.equal(
    mobilePush.pairingBaseUrl({ headers: { host: "127.0.0.1:7318" } }, { SECOND_PUBLIC_URL: "https://second.example.com/" }),
    "https://second.example.com",
  );
  assert.equal(
    mobilePush.pairingBaseUrl({ headers: { host: "second.example.com", "x-forwarded-proto": "https" } }, {}),
    "https://second.example.com",
  );
  assert.equal(
    mobilePush.requestBaseUrl({ headers: { host: "192.168.1.20:7318" } }),
    "http://192.168.1.20:7318",
  );
  assert.equal(
    mobilePush.configuredVapidSubject({ SECOND_MOBILE_PUBLIC_URL: "https://second.example.com/" }),
    "https://second.example.com",
  );
  assert.equal(mobilePush.normalizeVapidSubject("ops@example.com"), "mailto:ops@example.com");
  assert.equal(
    mobilePush.shouldReplaceVapidSubject("mailto:second-local@example.invalid", "https://second.example.com"),
    true,
  );
  assert.equal(
    mobilePush.shouldReplaceVapidSubject("mailto:ops@example.com", "https://second.example.com"),
    false,
  );
  assert.equal(mobilePush.mobileManifest("pair token").start_url, "/mobile.html?pair=pair%20token");
  assert.equal(mobilePush.mobileManifest("").start_url, "/mobile.html");
  const subscription = mobilePush.mobileSubscriptionPacket({
    id: "sub-1",
    endpoint: "https://web.push.apple.com/secret-token",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1",
    device: { ios: true, notificationActions: true, notificationMaxActions: 2 },
    createdAt: "2026-07-08T00:00:00.000Z",
    lastSeenAt: "2026-07-08T00:05:00.000Z",
  });
  assert.equal(subscription.id, "sub-1");
  assert.equal(subscription.label, "iOS · Safari");
  assert.equal(subscription.endpointHost, "web.push.apple.com");
  assert.equal(subscription.notificationActions, false);
  assert.equal(subscription.notificationMaxActions, 2);
  assert.doesNotMatch(JSON.stringify(subscription), /secret-token|p256dh|auth/);
  const androidSubscription = mobilePush.mobileSubscriptionPacket({
    endpoint: "https://fcm.googleapis.com/fcm/send/secret-token",
    userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
    device: { notificationActions: true, notificationMaxActions: 2 },
  });
  assert.equal(androidSubscription.label, "Android · Chrome");
  assert.equal(androidSubscription.notificationActions, true);
  const notification = mobilePush.decisionNotificationPayload(
    {
      id: "D-1",
      taskId: "T-1",
      title: "请求生产数据库写权限",
      risk: "高",
      agent: "李哲的分身",
      createdAt: "2026-07-08T00:00:00.000Z",
    },
    { title: "修复订单重复扣款" },
  );
  assert.equal(notification.title, "Second · 决策请求");
  assert.match(notification.body, /请求生产数据库写权限 · 高风险/);
  assert.match(notification.body, /T-1 · 修复订单重复扣款 · 李哲的分身/);
  assert.deepEqual(notification.actions.map((action) => action.action), ["approved", "rejected", "more"]);
  assert.equal(notification.replyUrl, "/mobile.html?decision=D-1&compose=1");
  assert.match(notification.actionHint, /批准、拒绝或补充更多/);
  assert.equal(notification.requireInteraction, true);
});

test("public access service abstracts manual URLs and cloudflared tunnels", async () => {
  let state = { settings: {}, events: [] };
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => child.emit("close", 0);
  const spawns = [];
  const service = publicAccess.createPublicAccessService({
    appendEvent: (target, event) => target.events.push(event),
    checkImpl: async (url) => ({ ok: url.startsWith("https://"), statusCode: 200 }),
    getLocalUrl: () => "http://127.0.0.1:7318",
    loadState: () => state,
    nowIso: () => "2026-07-08T00:00:00.000Z",
    saveState: (next) => {
      state = JSON.parse(JSON.stringify(next));
    },
    spawnImpl: (command, args) => {
      spawns.push({ command, args });
      return child;
    },
  });

  const manual = service.configure({
    enabled: true,
    provider: "manual",
    manualUrl: "https://second.example.com/mobile/",
  });
  assert.equal(manual.enabled, true);
  assert.equal(manual.provider, "manual");
  assert.equal(manual.activeUrl, "https://second.example.com/mobile");
  assert.equal(service.publicBaseUrl(), "https://second.example.com/mobile");

  const checked = await service.check({ url: "https://second.example.com/mobile" });
  assert.equal(checked.check.ok, true);
  assert.equal(checked.publicAccess.status, "online");

  const started = service.start({ provider: "cloudflared" });
  child.stderr.emit("data", "Your quick Tunnel has been created! https://fiber-hwy-insight.trycloudflare.com");
  const cloudflared = await started;
  assert.equal(spawns[0].command, "cloudflared");
  assert.deepEqual(spawns[0].args.slice(0, 5), ["tunnel", "--protocol", "http2", "--url", "http://127.0.0.1:7318"]);
  assert.equal(cloudflared.provider, "cloudflared");
  assert.equal(cloudflared.activeUrl, "https://fiber-hwy-insight.trycloudflare.com");
  assert.equal(service.publicBaseUrl(), "https://fiber-hwy-insight.trycloudflare.com");

  const stopped = service.stop();
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.activeUrl, "");
  assert.equal(state.events.some((event) => event.type === "public_access.online"), true);
});

test("mobile decision packets omit reply bodies and redact token-shaped text", () => {
  const packet = httpMobileRoutes.mobileDecisionPacket({
    id: "D-1",
    status: "pending",
    title: "使用 sk-or-v1-secretsecretsecret",
    summary: "api key: sk-testsecretsecretsecret",
    options: [{ id: "a", label: "批准", description: "token xoxb-123456789012-abcdef" }],
    replies: [{ message: "sk-or-v1-should-not-appear" }],
  });
  assert.equal(packet.replyCount, 1);
  assert.equal(packet.replies, undefined);
  assert.doesNotMatch(JSON.stringify(packet), /secretsecret|should-not-appear|123456789012/);
});

test("HTTP JSON helpers parse request bodies and send JSON responses", async () => {
  const req = new PassThrough();
  const parsed = httpJson.readBody(req);
  req.end("{\"ok\":true}");
  assert.deepEqual(await parsed, { ok: true });

  const rawReq = new PassThrough();
  const raw = httpJson.readRawBody(rawReq);
  rawReq.end("raw body");
  assert.equal(await raw, "raw body");

  const response = {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
  httpJson.sendJson(response, 201, { saved: true });
  assert.equal(response.status, 201);
  assert.match(response.headers["Content-Type"], /application\/json/);
  assert.equal(response.body, "{\"saved\":true}");
});

test("mobile route deletes a subscribed push device by id", async () => {
  const req = new PassThrough();
  req.method = "DELETE";
  const res = {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
  const calls = [];
  const handled = await httpMobileRoutes.handleMobileRoutes(
    req,
    res,
    new URL("http://localhost/api/mobile/push/subscriptions/sub-1"),
    {
      broadcast: (message) => calls.push({ broadcast: message }),
      decorateState: (state) => ({ decorated: state }),
      loadState: () => ({ events: [] }),
      mobilePush: {
        deleteSubscription: (state, id) => {
          calls.push({ state, id });
          return { removed: 1, push: { subscriptionCount: 0, subscriptions: [] } };
        },
      },
      sendJson: httpJson.sendJson,
    },
  );

  assert.equal(handled, true);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).push.subscriptionCount, 0);
  assert.equal(calls.some((call) => call.id === "sub-1"), true);
  assert.equal(calls.some((call) => call.broadcast?.type === "state"), true);
});

test("mobile route appends a human reply to a paired decision", async () => {
  const req = new PassThrough();
  req.method = "POST";
  req.headers = { authorization: "Bearer pair-token" };
  const res = {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
  const state = { tasks: [{ id: "T-1", codexSessionId: "session-1", status: "needs_human" }], decisions: [{ id: "D-1", taskId: "T-1", status: "pending", replies: [] }] };
  const calls = [];
  const handled = httpMobileRoutes.handleMobileRoutes(
    req,
    res,
    new URL("http://localhost/api/mobile/decisions/D-1/reply"),
    {
      appendDecisionReply: (loadedState, id, body) => {
        calls.push({ id, body });
        const reply = { id: "R-1", at: "2026-07-08T00:00:00.000Z", actor: body.actor, message: body.message, role: body.role };
        loadedState.decisions[0].replies.push(reply);
        return { decision: loadedState.decisions[0], reply, task: loadedState.tasks[0], shouldResumeCodex: true };
      },
      broadcast: (message) => calls.push({ broadcast: message }),
      decorateState: (value) => ({ decorated: value }),
      loadState: () => state,
      mobilePush: { verifyToken: () => true },
      readBody: httpJson.readBody,
      resumeCodexTask: (loadedState, taskId, decisionId, options) => {
        calls.push({ resume: { taskId, decisionId, options } });
        return { alreadyRunning: false };
      },
      saveState: () => {},
      sendJson: httpJson.sendJson,
      shouldCompleteClarificationDecision: () => false,
    },
  );
  req.end(JSON.stringify({ message: "请先说明凭证读取路径" }));

  assert.equal(await handled, true);
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.reply.id, "R-1");
  assert.equal(payload.decision.replyCount, 1);
  assert.equal(payload.resume, "started");
  assert.equal(calls[0].body.actor, "手机决策端");
  assert.equal(calls.some((call) => call.resume?.options?.mode === "reply"), true);
  assert.equal(calls.some((call) => call.broadcast?.type === "state"), true);
});

test("Slack simulate route creates a local channel task envelope", async () => {
  const req = new PassThrough();
  req.method = "POST";
  const res = {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
  const calls = [];
  const handled = handleIntegrationRoutes(
    req,
    res,
    new URL("http://localhost/api/integrations/slack/simulate-task"),
    {
      getChannelAdapter: () => slack,
      getPublicSlackConfig: () => ({ decisionChannel: "C1" }),
      loadState: () => ({ profile: { agentName: "测试分身" } }),
      nowIso: () => "2026-07-08T00:00:00.000Z",
      processChannelEnvelope: (adapter, envelope) => {
        calls.push({ adapter, envelope });
        return { task: { id: "T-sim", channel: envelope.taskInput.channel, sourceMessage: envelope.taskInput.sourceMessage } };
      },
      readBody: httpJson.readBody,
      sendJson: httpJson.sendJson,
    },
  );
  req.end(JSON.stringify({ text: "检查 Slack 入站任务", channel: "C1" }));

  assert.equal(await handled, true);
  assert.equal(res.status, 201);
  const payload = JSON.parse(res.body);
  assert.equal(payload.task.id, "T-sim");
  assert.equal(calls[0].envelope.kind, "task.requested");
  assert.equal(calls[0].envelope.taskInput.channel.id, "slack");
  assert.equal(calls[0].envelope.taskInput.agent, "测试分身");
  assert.equal(calls[0].envelope.taskInput.sourceMessage.label, "Slack");
});

test("state decorator filters archived items and exposes runtime metadata", () => {
  const decorateState = stateViewDomain.createStateDecorator({
    DATA_DIR: "/tmp/second",
    DEFAULT_PORT: 7317,
    computePhase1Metrics: () => ({ zeroHandoffRate: 100 }),
    getPublicSlackConfig: () => ({ socketMode: true, botTokenConfigured: true, appTokenConfigured: true }),
    getRunningTasks: () => ["T-running"],
    listChannelAdapters: () => [
      { id: "assistant", kind: "local-adapter", status: "implemented" },
      { id: "slack", kind: "http-adapter", status: "implemented" },
      { id: "linear", kind: "placeholder", status: "not_implemented" },
    ],
  });
  const decorated = decorateState({
    daemon: {},
    channels: [
      { id: "assistant", name: "对话助手", status: "connected", notify: true },
      { id: "slack", name: "Slack", status: "connected", notify: true },
      { id: "linear", name: "Linear", status: "connected", notify: true },
    ],
    events: [
      { type: "channel.socket.connected", text: "ok" },
      { type: "task.created", text: "ignored" },
    ],
    tasks: [
      { id: "T-running", status: "running" },
      { id: "T-done", status: "done" },
      { id: "T-archived", archivedAt: "2026-07-07T00:00:00.000Z" },
    ],
    decisions: [
      { id: "D-pending", status: "pending", risk: "高" },
      { id: "D-archived", archivedAt: "2026-07-07T00:00:00.000Z" },
    ],
  });

  assert.deepEqual(decorated.tasks.map((task) => task.id), ["T-running", "T-done"]);
  assert.equal(decorated.archived.tasks, 1);
  assert.equal(decorated.metrics.pendingDecisions, 1);
  assert.equal(decorated.metrics.runningTasks, 1);
  assert.equal(decorated.runtime.port, 7317);
  assert.equal(decorated.integrations.slack.recentEvents.length, 1);
  assert.equal(decorated.channels.find((channel) => channel.id === "assistant").status, "connected");
  assert.equal(decorated.channels.find((channel) => channel.id === "slack").status, "connected");
  assert.equal(decorated.channels.find((channel) => channel.id === "linear").status, "not_configured");
  assert.equal(decorated.channels.find((channel) => channel.id === "linear").notify, false);
  assert.match(decorated.channels.find((channel) => channel.id === "linear").meta, /适配层未接入/);
});

test("profile updates generate a bounded Nice Avatar", () => {
  const state = {
    profile: {
      name: "旧用户",
      avatar: "旧",
      agentName: "旧用户的分身",
      tagline: "旧介绍",
      avatarStyle: "nice-avatar",
      avatarShape: "circle",
      avatarSeed: "old",
    },
  };

  const profile = updateProfile(state, {
    name: " 新用户 ",
    roleIntro: " 负责把复杂任务转成可审计执行链路  ",
    avatarSeed: "operator-01",
    avatarShape: "rounded",
    avatarConfig: { sex: "woman", hairStyle: "womanLong", shirtColor: "#6BD9E9" },
  });

  assert.equal(profile.name, "新用户");
  assert.equal(profile.avatar, "新");
  assert.equal(profile.agentName, "新用户的分身");
  assert.equal(profile.roleIntro, "负责把复杂任务转成可审计执行链路");
  assert.equal(profile.tagline, profile.roleIntro);
  assert.equal(profile.avatarStyle, "nice-avatar");
  assert.equal(profile.avatarProvider, "nice-avatar");
  assert.equal(profile.avatarShape, "rounded");
  assert.equal(profile.avatarConfig.sex, "woman");
  assert.match(profile.avatarUrl, /^data:image\/svg\+xml;charset=UTF-8,/);

  const fallback = updateProfile(state, {
    name: "Another",
    avatarShape: "javascript:alert(1)",
    avatarConfig: { sex: "robot", bgColor: "javascript:alert(1)" },
    avatarSeed: "x".repeat(120),
  });
  assert.equal(fallback.avatarStyle, "nice-avatar");
  assert.equal(fallback.avatarShape, "rounded");
  assert.equal(fallback.avatarConfig.sex, "woman");
  assert.equal(fallback.avatarSeed.length, 80);
});

test("decision replies are recorded and mark resumable tasks for clarification", () => {
  const state = {
    decisions: [
      {
        id: "D-clarify",
        status: "pending",
        taskId: "T-clarify",
        title: "Need approval",
        replies: [],
      },
    ],
    tasks: [
      {
        id: "T-clarify",
        status: "needs_human",
        codexSessionId: "019f3a9b-e38c-7650-8fd6-98c6eaf05f8f",
        agent: "测试分身",
        trace: [],
      },
    ],
    events: [],
  };

  const result = appendDecisionReply(state, "D-clarify", {
    role: "human",
    actor: "Tester",
    message: "请补充回滚方式。\n以及影响范围。",
    persist: false,
  });

  assert.equal(result.shouldResumeCodex, true);
  assert.equal(result.decision.replies.length, 1);
  assert.equal(result.decision.replies[0].role, "human");
  assert.match(result.decision.replies[0].message, /回滚方式/);
  assert.equal(result.task.status, "pending_resume");
  assert.equal(result.task.trace[0].title, "人类补充信息");
});
