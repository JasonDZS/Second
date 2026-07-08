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

test("Slack decision blocks preserve evidence options as button values", () => {
  const blocks = slack.decisionBlocks({
    id: "D-1",
    title: "Choose a path",
    summary: "Need direction",
    risk: "中",
    taskId: "T-1",
    source: "test",
    options: [
      { id: "a", label: "方案 A", description: "safe", recommended: true },
      { id: "manual", label: "人工执行", description: "manual fallback" },
    ],
  });

  const actions = blocks.find((block) => block.type === "actions");
  const values = actions.elements.map((element) => JSON.parse(element.value));
  assert.deepEqual(values.map((value) => value.optionId), ["a", "manual"]);
  assert.deepEqual(values.map((value) => value.verdict), ["approved", "rejected"]);
});

test("Slack decision blocks can include the configured profile avatar", () => {
  const blocks = slack.decisionBlocks(
    {
      id: "D-2",
      title: "Approve profile avatar",
      summary: "Need a decision",
      risk: "低",
      taskId: "T-2",
      source: "test",
      options: [{ id: "a", label: "批准", description: "ok" }],
    },
    {
      name: "Jason",
      agentName: "Jason 的分身",
      avatarUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=jason",
    },
  );

  assert.equal(blocks[0].accessory.type, "image");
  assert.equal(blocks[0].accessory.image_url, "https://api.dicebear.com/9.x/thumbs/svg?seed=jason");
  assert.equal(blocks[1].type, "context");
  assert.match(blocks[1].elements[0].text, /Jason 的分身/);
});

test("Slack manifest adds chat:write.customize when profile message identity is enabled", () => {
  const defaultScopes = slack.manifest({
    socketMode: true,
    customizeProfileMessages: false,
  }).oauth_config.scopes.bot;
  assert.equal(defaultScopes.includes("chat:write.customize"), false);

  const customScopes = slack.manifest({
    socketMode: true,
    customizeProfileMessages: true,
  }).oauth_config.scopes.bot;
  assert.equal(customScopes.includes("chat:write.customize"), true);
});

test("Slack manifest includes channel metadata read scopes for source labels", () => {
  const scopes = slack.manifest({ socketMode: true }).oauth_config.scopes.bot;
  assert.equal(scopes.includes("channels:read"), true);
  assert.equal(scopes.includes("groups:read"), true);
  assert.equal(scopes.includes("im:read"), true);
  assert.equal(scopes.includes("mpim:read"), true);
});

test("Slack text helpers sanitize mentions and chunk long replies", () => {
  assert.equal(slackText.cleanSlackText("<@USECOND>  hello   world"), "hello world");
  assert.equal(slackText.escapeSlack("a & <b>"), "a &amp; &lt;b&gt;");
  const chunks = slackText.chunkSlackText("first paragraph\n\nsecond paragraph", 20);
  assert.deepEqual(chunks, ["first paragraph", "second paragraph"]);
});

test("Slack event helpers normalize task and decision envelopes", async () => {
  const taskEnvelope = await slackEvents.receiveSocketEnvelope(
    {
      type: "events_api",
      payload: {
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C1",
          user: "U1",
          text: "<@USECOND> say hi",
          ts: "1783419239.992019",
        },
      },
    },
    { profile: { agentName: "测试分身" } },
  );

  assert.equal(taskEnvelope.kind, "task.requested");
  assert.equal(taskEnvelope.channelId, "slack");
  assert.equal(taskEnvelope.taskInput.title, "say hi");
  assert.equal(taskEnvelope.taskInput.agent, "测试分身");
  assert.equal(taskEnvelope.taskInput.channel.external.threadTs, "1783419239.992019");
  assert.match(taskEnvelope.taskInput.prompt, /Do not use messaging connector tools/);

  const ignored = await slackEvents.receiveSocketEnvelope({
    type: "events_api",
    payload: {
      type: "event_callback",
      event: { type: "message", channel: "C1", user: "U1", text: "unaddressed", ts: "1.0" },
    },
  });
  assert.equal(ignored.kind, "response");
  assert.equal(ignored.response.body.reason, "message_not_addressed");

  const decisionEnvelope = await slackEvents.receiveSocketEnvelope({
    type: "interactive",
    payload: {
      user: { id: "U1" },
      actions: [{ value: JSON.stringify({ decisionId: "D-1", verdict: "approved", optionId: "ok" }) }],
    },
  });
  assert.equal(decisionEnvelope.kind, "decision.resolved");
  assert.equal(decisionEnvelope.decisionId, "D-1");
  assert.equal(decisionEnvelope.optionId, "ok");
});

test("Slack socket helper acknowledges envelopes and forwards normalized decisions", async () => {
  const sent = [];
  const processed = [];
  const statuses = [];
  const socket = {
    sendJson: (payload) => sent.push(payload),
    close: () => statuses.push({ type: "closed" }),
  };
  const adapter = { id: "slack" };

  slackSocket.handleSocketMessage(
    JSON.stringify({
      type: "interactive",
      envelope_id: "E-1",
      payload: {
        type: "block_actions",
        user: { id: "U1" },
        actions: [{ value: JSON.stringify({ decisionId: "D-1", verdict: "rejected" }) }],
      },
    }),
    socket,
    {
      onStatus: (event) => statuses.push(event),
      processEnvelope: (receivedAdapter, envelope) => processed.push({ adapter: receivedAdapter, envelope }),
    },
    adapter,
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(sent, [{ envelope_id: "E-1" }]);
  assert.equal(processed[0].adapter, adapter);
  assert.equal(processed[0].envelope.kind, "decision.resolved");
  assert.equal(processed[0].envelope.verdict, "rejected");

  slackSocket.handleSocketMessage("{", socket, { onStatus: (event) => statuses.push(event) }, adapter);
  assert.equal(statuses.some((event) => event.type === "socket.invalid_json"), true);
});

test("Slack does not receive decision events", async () => {
  const approval = await slack.sendDecisionRequested({
    id: "D-approval",
    type: "审批",
    title: "Approve spending limit change",
  });
  assert.equal(approval.skipped, true);
  assert.match(approval.reason, /Second only/);

  const clarification = await slack.sendDecisionRequested({
    id: "D-clarify-slack",
    type: "补充",
    title: "需要 key 列表",
    summary: "缺少待查询的 key 列表。",
    options: [{ id: "provide", label: "补充 key 列表", description: "在线程里回复 key 列表或文件位置。" }],
  });
  assert.equal(clarification.skipped, true);
  assert.match(clarification.reason, /Second only/);

  const resolved = await slack.sendDecisionResolved({ id: "D-approval", status: "approved" });
  assert.equal(resolved.skipped, true);
});

test("Slack thread follow-ups can target an existing Codex session", () => {
  const state = {
    tasks: [
      {
        id: "T-newer",
        codexSessionId: "019f3be5-1cdd-7a60-9c86-888f5f61151d",
        channel: { id: "slack", external: { channel: "C1", threadTs: "100.1" } },
      },
      {
        id: "T-other",
        codexSessionId: "019f3be5-1cdd-7a60-9c86-888f5f61151e",
        channel: { id: "slack", external: { channel: "C1", threadTs: "200.1" } },
      },
    ],
  };

  const task = findChannelThreadTask(state, {
    channel: { external: { channel: "C1", threadTs: "100.1" } },
  });

  assert.equal(task.id, "T-newer");
  assert.equal(
    channelProcessor.findChannelThreadTask(state, {
      external: { channel: "C1", threadTs: "100.1" },
    }).id,
    "T-newer",
  );
});

test("channel controller refreshes Slack labels and owns transport lifecycle", async () => {
  const state = {
    profile: { name: "Tester" },
    events: [],
    tasks: [
      {
        id: "T-slack-label",
        source: "Slack C1",
        channel: { id: "slack", external: { channel: "C1", threadTs: "100.1" } },
        sourceMessage: { external: { channel: "C1" } },
      },
    ],
  };
  const broadcasts = [];
  let stopped = false;
  const controller = channelController.createChannelController({
    appendEvent: (target, event) => target.events.push(event),
    broadcast: (event) => broadcasts.push(event),
    channelProcessor: {
      findChannelThreadTask: (target, input) => target.tasks.find((task) => task.channel.external.threadTs === input.external?.threadTs),
      isKnownChannelThread: (event) => event.channel?.external?.threadTs === "100.1",
      processChannelEnvelope: () => ({ accepted: true }),
    },
    decorateState: (target) => ({ decorated: target.tasks[0].source }),
    getChannelAdapter: () => ({
      async resolveChannelInfo(channelId) {
        return { id: channelId, name: "baton-test", label: "#baton-test" };
      },
    }),
    loadState: () => state,
    readRawBody: async () => "",
    saveState: () => {},
    sendJson: (res, status, body) => {
      res.status = status;
      res.body = body;
    },
    startChannelTransports: ({ onStatus }) => {
      onStatus({ type: "socket.connected", text: "connected", channelId: "slack" });
      return {
        stop() {
          stopped = true;
        },
      };
    },
  });

  await controller.refreshSlackChannelNames();
  assert.equal(state.tasks[0].channel.external.channelName, "baton-test");
  assert.equal(state.tasks[0].source, "Slack #baton-test");
  assert.equal(broadcasts[0].state.decorated, "Slack #baton-test");

  controller.restartChannelTransports();
  assert.equal(state.events[0].type, "channel.socket.connected");
  controller.stopChannelTransports();
  assert.equal(stopped, true);

  assert.equal(controller.isKnownChannelThread({ channel: { external: { threadTs: "100.1" } } }), true);
  assert.equal(controller.findChannelThreadTask(state, { external: { threadTs: "100.1" } }).id, "T-slack-label");
});

test("channel follow-up prompt keeps Slack thread work in the same session", () => {
  const input = slack.slackEventToTaskInput(
    {
      type: "app_mention",
      channel: "C1",
      thread_ts: "100.1",
      ts: "101.1",
      user: "U1",
      text: "<@USECOND> 继续查每个 key 的使用情况",
    },
    { agentName: "测试分身" },
  );
  assert.equal(input.messageText, "继续查每个 key 的使用情况");

  const prompt = buildChannelFollowupPrompt(
    { id: "T-thread", title: "原始任务" },
    { message: input.messageText, external: input.channel.external },
  );

  assert.match(prompt, /same external Slack thread/);
  assert.match(prompt, /Continue from the existing Codex session/);
  assert.match(prompt, /继续查每个 key 的使用情况/);
  assert.match(prompt, /decision_request with type "补充"/);
});

