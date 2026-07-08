"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const { URL } = require("node:url");

const channels = require("../../server/channels");
const channelController = require("../../server/channels/controller");
const { getPublicChannelConfig, saveChannelConfig } = require("../../server/channel-config");
const { parseClosePayload } = require("../../server/channels/ws-client");
const httpJson = require("../../server/http/json");
const { handleIntegrationRoutes } = require("../../server/http/routes/integrations");
const stateViewDomain = require("../../server/domain/state-view");
const traceCore = require("../../public/timeline-core");

test("message platform adapters are registered as implemented sources", () => {
  const adapters = channels.listChannelAdapters();
  for (const id of ["discord", "telegram", "whatsapp", "dingding", "feishu"]) {
    const adapter = adapters.find((item) => item.id === id);
    assert.equal(adapter.status, "implemented");
    assert.equal(adapter.supports.taskIntake, true);
    assert.equal(adapter.supports.resultReply, true);
  }
});

test("Discord gateway avoids privileged intents by default and classifies terminal closes", () => {
  const discord = channels.getChannelAdapter("discord");
  assert.equal(discord.discordGatewayIntents({}), 4609);
  assert.equal(discord.discordGatewayIntents({ messageContentIntent: true }), 37377);
  assert.deepEqual(discord.classifyGatewayClose({ code: 4014 }), {
    type: "gateway.disallowed_intents",
    text: "discord.gateway.disallowed_intents privileged intent is not enabled",
    retry: false,
  });
  assert.deepEqual(parseClosePayload(Buffer.from([0x0f, 0xae])), { code: 4014, reason: "" });
  const annotated = discord.annotateDiscordSendResult({
    ok: false,
    statusCode: 403,
    response: { message: "Missing Access", code: 50001 },
    error: "Missing Access",
  });
  assert.match(annotated.error, /Bot 无法访问测试频道/);
  assert.match(annotated.hint, /View Channel/);
});

test("Discord public config carries the optional message content intent switch", () => {
  const previous = process.env.SECOND_DISCORD_MESSAGE_CONTENT_INTENT;
  process.env.SECOND_DISCORD_MESSAGE_CONTENT_INTENT = "1";
  try {
    const config = getPublicChannelConfig("discord");
    assert.equal(config.messageContentIntent, true);
    assert.equal(config.sources.messageContentIntent, "env");
  } finally {
    if (previous == null) delete process.env.SECOND_DISCORD_MESSAGE_CONTENT_INTENT;
    else process.env.SECOND_DISCORD_MESSAGE_CONTENT_INTENT = previous;
  }
});

test("Telegram webhook updates normalize into channel task envelopes", async () => {
  const adapter = channels.getChannelAdapter("telegram");
  const envelope = await adapter.receiveHttp({
    req: { method: "POST", headers: {} },
    url: new URL("http://localhost/telegram/webhook"),
    rawBody: JSON.stringify({
      message: {
        message_id: 42,
        date: 1783419239,
        message_thread_id: 7,
        chat: { id: -1001, type: "supergroup", title: "ops" },
        from: { id: 88, username: "alice" },
        text: "检查今天的发布风险",
      },
    }),
    profile: { agentName: "测试分身" },
    config: {},
  });

  assert.equal(envelope.kind, "task.requested");
  assert.equal(envelope.channelId, "telegram");
  assert.equal(envelope.taskInput.channel.id, "telegram");
  assert.equal(envelope.taskInput.channel.external.channel, "-1001");
  assert.equal(envelope.taskInput.channel.external.threadTs, "7");
  assert.equal(envelope.taskInput.messageText, "检查今天的发布风险");
  assert.match(envelope.taskInput.prompt, /external Telegram message/);
  assert.match(envelope.taskInput.prompt, /Do not use messaging connector tools/);
});

test("Discord, DingTalk, Feishu, and WhatsApp payloads share the source envelope shape", async () => {
  const cases = [
    {
      id: "discord",
      url: "http://localhost/discord/webhook",
      body: {
        id: "m1",
        channel_id: "C1",
        thread_id: "TH1",
        guild_id: "G1",
        author: { id: "U1", username: "alice" },
        content: "查一下 CI",
      },
    },
    {
      id: "dingding",
      url: "http://localhost/dingtalk/webhook",
      body: {
        msgId: "m2",
        conversationId: "cid-1",
        senderStaffId: "u2",
        senderNick: "Bob",
        text: { content: "同步项目状态" },
      },
    },
    {
      id: "feishu",
      url: "http://localhost/feishu/webhook",
      body: {
        event: {
          sender: { sender_id: { user_id: "u3" } },
          message: {
            chat_id: "oc_1",
            message_id: "om_1",
            root_id: "om_root",
            content: JSON.stringify({ text: "看一下回归结果" }),
          },
        },
      },
    },
    {
      id: "whatsapp",
      url: "http://localhost/whatsapp/webhook",
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "pn1" },
                  contacts: [{ wa_id: "15551234567", profile: { name: "Carol" } }],
                  messages: [{ id: "wamid.1", from: "15551234567", timestamp: "1783419239", text: { body: "检查账单异常" } }],
                },
              },
            ],
          },
        ],
      },
    },
  ];

  for (const item of cases) {
    const envelope = await channels.getChannelAdapter(item.id).receiveHttp({
      req: { method: "POST", headers: {} },
      url: new URL(item.url),
      rawBody: JSON.stringify(item.body),
      profile: { agentName: "测试分身" },
      config: {},
    });
    assert.equal(envelope.kind, "task.requested", item.id);
    assert.equal(envelope.channelId, item.id, item.id);
    assert.equal(envelope.taskInput.channel.id, item.id, item.id);
    assert.equal(envelope.taskInput.agent, "测试分身", item.id);
    assert.ok(envelope.taskInput.messageText, item.id);
  }
});

test("platform webhook verification responses are preserved through the channel controller", async () => {
  const adapter = channels.getChannelAdapter("whatsapp");
  const controller = channelController.createChannelController({
    channelProcessor: { processChannelEnvelope: () => ({}) },
    loadState: () => ({ profile: {} }),
    readRawBody: async () => "",
    sendJson: httpJson.sendJson,
  });
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

  await controller.handleChannel(
    { method: "GET", headers: {} },
    res,
    new URL("http://localhost/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test&hub.challenge=ok"),
    adapter,
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers["Content-Type"], "text/plain; charset=utf-8");
  assert.equal(res.body, "ok");
});

test("Feishu url verification returns the platform challenge", async () => {
  const response = await channels.getChannelAdapter("feishu").receiveHttp({
    req: { method: "POST", headers: {} },
    url: new URL("http://localhost/feishu/webhook"),
    rawBody: JSON.stringify({ type: "url_verification", challenge: "feishu-challenge" }),
  });

  assert.equal(response.kind, "response");
  assert.deepEqual(response.response.body, { challenge: "feishu-challenge" });
});

test("implemented platform adapters decorate disconnected or configured channel state", () => {
  const decorateState = stateViewDomain.createStateDecorator({
    listChannelAdapters: () => [
      { id: "telegram", name: "Telegram", status: "implemented", configured: true, meta: "Bot token 已配置" },
      { id: "discord", name: "Discord", status: "implemented", configured: false, meta: "缺少 DISCORD_BOT_TOKEN" },
    ],
  });
  const decorated = decorateState({
    daemon: {},
    events: [],
    tasks: [],
    decisions: [],
    channels: [
      { id: "telegram", name: "Telegram", status: "disconnected", notify: true },
      { id: "discord", name: "Discord", status: "disconnected", notify: true },
    ],
  });

  assert.equal(decorated.channels.find((item) => item.id === "telegram").status, "connected");
  assert.equal(decorated.channels.find((item) => item.id === "telegram").notify, true);
  assert.equal(decorated.channels.find((item) => item.id === "discord").status, "disconnected");
  assert.equal(decorated.channels.find((item) => item.id === "discord").notify, false);
});

test("generic integration config routes save public platform channel settings", async () => {
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
  let saved = null;
  let restarted = false;
  const handled = handleIntegrationRoutes(
    req,
    res,
    new URL("http://localhost/api/integrations/telegram/config"),
    {
      appendEvent: () => {},
      broadcast: () => {},
      decorateState: (state) => state,
      getPublicChannelConfig: (id) => ({ id, label: "Telegram" }),
      loadState: () => ({ events: [] }),
      readBody: httpJson.readBody,
      restartChannelTransports: () => {
        restarted = true;
      },
      saveChannelConfig: (id, body) => {
        saved = { id, body };
        return {
          id,
          label: "Telegram",
          configured: true,
          botTokenConfigured: true,
          allowedChannels: body.allowedChannels,
        };
      },
      saveState: () => {},
      sendJson: httpJson.sendJson,
    },
  );
  req.end(JSON.stringify({ botToken: "123:abc", allowedChannels: "-1001" }));

  assert.equal(await handled, true);
  assert.equal(res.status, 200);
  assert.equal(saved.id, "telegram");
  assert.equal(saved.body.botToken, "123:abc");
  assert.equal(restarted, true);
  assert.deepEqual(JSON.parse(res.body).channel, {
    id: "telegram",
    label: "Telegram",
    configured: true,
    botTokenConfigured: true,
    allowedChannels: "-1001",
  });
});

test("generic integration test-message routes keep platform failures in the JSON result", async () => {
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

  const handled = handleIntegrationRoutes(
    req,
    res,
    new URL("http://localhost/api/integrations/discord/test-message"),
    {
      getChannelAdapter: () => ({
        sendTestMessage: async ({ channel }) => ({
          ok: false,
          statusCode: 403,
          error: `Missing Access: ${channel}`,
        }),
      }),
      readBody: httpJson.readBody,
      sendJson: httpJson.sendJson,
    },
  );
  req.end(JSON.stringify({ channel: "1234567890" }));

  assert.equal(await handled, true);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), {
    result: {
      ok: false,
      statusCode: 403,
      error: "Missing Access: 1234567890",
    },
  });
});

test("channel config helpers merge env sources without exposing secret values", () => {
  const previous = process.env.SECOND_DISCORD_BOT_TOKEN;
  process.env.SECOND_DISCORD_BOT_TOKEN = "discord-secret-token";
  try {
    const config = getPublicChannelConfig("discord");
    assert.equal(config.configured, true);
    assert.equal(config.botTokenConfigured, true);
    assert.equal(config.sources.botToken, "env");
    assert.equal(config.botTokenLabel, "disco...oken");
    assert.equal(config.botToken, undefined);
  } finally {
    if (previous == null) delete process.env.SECOND_DISCORD_BOT_TOKEN;
    else process.env.SECOND_DISCORD_BOT_TOKEN = previous;
  }

  assert.equal(typeof saveChannelConfig, "function");
});

test("TraceCore exposes source render adapters for the new platforms", () => {
  assert.equal(traceCore.sourceChannelAdapter("discord").label, "Discord");
  assert.equal(traceCore.sourceChannelAdapter("telegram").label, "Telegram");
  assert.equal(traceCore.sourceChannelAdapter("whatsapp").label, "WhatsApp");
  assert.equal(traceCore.sourceChannelAdapter("dingding").label, "DingTalk");
  assert.equal(traceCore.sourceChannelAdapter("feishu").label, "Feishu");
});
