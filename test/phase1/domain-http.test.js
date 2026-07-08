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
  assert.equal(httpStatic.contentType("logo.png"), "image/png");
  assert.equal(httpStatic.contentType("unknown.bin"), "application/octet-stream");
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

test("state decorator filters archived items and exposes runtime metadata", () => {
  const decorateState = stateViewDomain.createStateDecorator({
    DATA_DIR: "/tmp/second",
    DEFAULT_PORT: 7317,
    computePhase1Metrics: () => ({ zeroHandoffRate: 100 }),
    getPublicSlackConfig: () => ({ socketMode: true }),
    getRunningTasks: () => ["T-running"],
  });
  const decorated = decorateState({
    daemon: {},
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

