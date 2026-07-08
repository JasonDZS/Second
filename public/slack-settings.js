(function initSecondSlackSettings(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root || {};
  if (target) target.SecondSlackSettings = api;
  if (typeof window === "object") window.SecondSlackSettings = api;
  if (typeof globalThis === "object") globalThis.SecondSlackSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondSlackSettings() {
  const MESSAGE_CHANNEL_CONFIGS = {
    discord: {
      id: "discord",
      title: "Discord 集成",
      description: "配置 Bot Token、Application ID 和测试频道。已有 token 不会在前端回显。",
      webhookPath: "/discord/webhook",
      showWebhookPath: false,
      secrets: [
        { key: "botToken", label: "Bot Token", placeholder: "Discord Bot token" },
      ],
      fields: [
        { key: "applicationId", label: "Application ID", placeholder: "Developer Portal -> General Information" },
        { key: "messageContentIntent", type: "boolean", label: "高级: 读取未 @ 的消息内容", help: "仅当 Discord 后台已开启 Message Content privileged intent 时打开;否则 Gateway 会被 Discord 拒绝。" },
        { key: "allowedUsers", label: "允许用户 ID", placeholder: "可选: 123456789,987654321" },
        { key: "allowedChannels", label: "允许频道 ID", placeholder: "可选: 频道 ID,线程 ID" },
        { key: "testTarget", label: "测试频道 ID", placeholder: "可选: 频道 ID" },
      ],
      notes: [
        "Gateway 会在保存后自动重连。普通使用只需要 @ Bot 或私聊 Bot,不需要打开高级 intent。",
        "如果测试消息返回 Missing Access,通常是 Bot 没有加入目标服务器、测试频道 ID 错误,或频道权限缺少 View Channel / Send Messages。",
      ],
      guide: {
        title: "Discord 最少只要 3 项",
        description: "填 Bot Token 和 Application ID,Second 会生成邀请链接;再填一个测试频道 ID 用来验证发送。",
        showWebhookStep: false,
        links: [
          { label: "Developer Portal", href: "https://discord.com/developers/applications" },
        ],
        steps: [
          "Bot Token: Application / Bot 页面复制 token,保存后 Second 会启动 Gateway。",
          "Application ID: General Information 页面复制,Second 会直接生成 Bot 邀请链接。",
          "测试频道 ID: 开启 Discord 开发者模式后右键目标频道复制 ID。",
        ],
      },
    },
    telegram: {
      id: "telegram",
      title: "Telegram 集成",
      description: "配置 Bot Token、Webhook Secret、允许列表和测试 Chat ID。已有 token 不会在前端回显。",
      webhookPath: "/telegram/webhook",
      secrets: [
        { key: "botToken", label: "Bot Token", placeholder: "123456:ABC..." },
        { key: "webhookSecret", label: "Webhook Secret", placeholder: "可选: setWebhook secret_token" },
      ],
      fields: [
        { key: "allowedUsers", label: "允许用户 ID", placeholder: "可选: 123456,654321" },
        { key: "allowedChannels", label: "允许 Chat ID", placeholder: "可选: -100...,123456" },
        { key: "testTarget", label: "测试 Chat ID", placeholder: "可选: 私聊或群聊 Chat ID" },
      ],
      notes: ["Webhook Secret 会校验 x-telegram-bot-api-secret-token。"],
      guide: {
        title: "Telegram 这些值从哪里获取?",
        description: "用 BotFather 创建 Bot,再把 HTTPS webhook 指向当前 daemon 的 /telegram/webhook。",
        links: [
          { label: "BotFather", href: "https://t.me/BotFather" },
          { label: "Bot API", href: "https://core.telegram.org/bots/api" },
          { label: "setWebhook", href: "https://core.telegram.org/bots/api#setwebhook" },
        ],
        steps: [
          "Bot Token: BotFather 创建或打开 Bot 后复制形如 123456:ABC 的 token。",
          "Webhook Secret: 调用 setWebhook 时传 secret_token,这里填写同一个值。",
          "Chat ID: 私聊、群聊或 supergroup 的 id,可从 update payload 或 bot 调试工具中获得。",
          "允许列表: 填用户 ID 或 Chat ID 后,只有匹配消息会进入本地执行。",
        ],
      },
    },
    whatsapp: {
      id: "whatsapp",
      title: "WhatsApp 集成",
      description: "配置 WhatsApp Cloud API 凭据、Webhook 验证 token 和测试手机号。已有 token 不会在前端回显。",
      webhookPath: "/whatsapp/webhook",
      secrets: [
        { key: "accessToken", label: "Access Token", placeholder: "Meta Graph API token" },
        { key: "verifyToken", label: "Verify Token", placeholder: "Webhook 验证 token" },
      ],
      fields: [
        { key: "phoneNumberId", label: "Phone Number ID", placeholder: "WhatsApp phone_number_id" },
        { key: "allowedUsers", label: "允许手机号", placeholder: "可选: 15551234567,..." },
        { key: "allowedChannels", label: "允许会话", placeholder: "可选: 15551234567,..." },
        { key: "testTarget", label: "测试接收手机号", placeholder: "可选: E.164 手机号" },
      ],
      notes: ["GET /whatsapp/webhook 会返回 Meta 验证 challenge。"],
      guide: {
        title: "WhatsApp 这些值从哪里获取?",
        description: "在 Meta Developer App 的 WhatsApp Cloud API 配置 token、Phone Number ID 和 Webhook 验证 token。",
        links: [
          { label: "Meta Apps", href: "https://developers.facebook.com/apps/" },
          { label: "Cloud API", href: "https://developers.facebook.com/docs/whatsapp/cloud-api" },
          { label: "Webhooks", href: "https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks" },
        ],
        steps: [
          "Access Token: WhatsApp / API Setup 页面复制临时或长期访问 token。",
          "Phone Number ID: 同一 API Setup 页面复制 phone_number_id,用于发出回复。",
          "Verify Token: Webhook 配置时自定义一段 token,这里必须填写同一个值。",
          "测试接收手机号: 填 E.164 号码,用于发送 Cloud API 测试消息。",
        ],
      },
    },
    dingding: {
      id: "dingding",
      aliases: ["dingtalk"],
      title: "DingTalk 集成",
      description: "配置钉钉机器人 Webhook、签名 Secret 和允许列表。已有 Webhook URL 不会在前端回显。",
      webhookPath: "/dingtalk/webhook",
      secrets: [
        { key: "webhookUrl", label: "机器人 Webhook URL", placeholder: "https://oapi.dingtalk.com/robot/send?access_token=..." },
        { key: "secret", label: "签名 Secret", placeholder: "可选: SEC..." },
      ],
      fields: [
        { key: "allowedUsers", label: "允许用户 ID", placeholder: "可选: staffId,openId" },
        { key: "allowedChannels", label: "允许会话 ID", placeholder: "可选: conversationId" },
      ],
      notes: ["DingTalk 结果消息会通过机器人 Webhook 发送。"],
      guide: {
        title: "DingTalk 这些值从哪里获取?",
        description: "在钉钉群里添加自定义机器人,复制机器人 Webhook URL,需要签名时同时复制 Secret。",
        links: [
          { label: "钉钉开放平台", href: "https://open.dingtalk.com/" },
          { label: "自定义机器人", href: "https://open.dingtalk.com/document/orgapp/custom-robot-access" },
          { label: "消息回调", href: "https://open.dingtalk.com/document/orgapp/message-receiving" },
        ],
        steps: [
          "机器人 Webhook URL: 群设置 / 机器人 / 自定义机器人中复制 send URL。",
          "签名 Secret: 安全设置选择加签时复制 SEC 开头的 secret。",
          "入站 Webhook: 钉钉 outgoing 或中转服务把消息 POST 到 /dingtalk/webhook。",
          "会话 ID: conversationId 可用于允许列表;群机器人发送结果不需要测试目标。",
        ],
      },
    },
    feishu: {
      id: "feishu",
      title: "Feishu 集成",
      description: "配置飞书/Lark 事件订阅入口、机器人 Webhook 和允许列表。已有 Webhook URL 不会在前端回显。",
      webhookPath: "/feishu/webhook",
      secrets: [
        { key: "webhookUrl", label: "机器人 Webhook URL", placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/..." },
      ],
      fields: [
        { key: "allowedUsers", label: "允许用户 ID", placeholder: "可选: user_id,open_id" },
        { key: "allowedChannels", label: "允许 Chat ID", placeholder: "可选: oc_..." },
      ],
      notes: ["URL verification challenge 会由 /feishu/webhook 原样响应。"],
      guide: {
        title: "Feishu 这些值从哪里获取?",
        description: "在飞书/Lark 开发者后台配置事件订阅入口,再为结果回复准备机器人 Webhook。",
        links: [
          { label: "飞书开放平台", href: "https://open.feishu.cn/app" },
          { label: "事件订阅", href: "https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-" },
          { label: "自定义机器人", href: "https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot" },
        ],
        steps: [
          "机器人 Webhook URL: 群自定义机器人或应用机器人用于发送最终结果。",
          "事件订阅 URL: 在开放平台把 Request URL 指向 /feishu/webhook。",
          "URL verification: 飞书发出的 challenge 会由 Second 自动响应。",
          "Chat ID / 用户 ID: 从 event payload 中复制,用于允许列表。",
        ],
      },
    },
  };

  const MESSAGE_CHANNEL_ALIASES = Object.fromEntries(
    Object.values(MESSAGE_CHANNEL_CONFIGS)
      .flatMap((spec) => (spec.aliases || []).map((alias) => [alias, spec.id])),
  );

  function slackFormFromPublic(slack = {}) {
    const emptyConfig =
      !slack.botTokenConfigured &&
      !slack.appTokenConfigured &&
      !slack.signingSecretConfigured &&
      !slack.publicUrl &&
      !slack.decisionChannel;
    return {
      socketMode: emptyConfig ? true : Boolean(slack.socketMode),
      customizeProfileMessages: Boolean(slack.customizeProfileMessages),
      botToken: "",
      appToken: "",
      signingSecret: "",
      publicUrl: slack.publicUrl || "",
      decisionChannel: slack.decisionChannel || "",
      allowedUsers: slack.allowedUsers || "",
      allowedChannels: slack.allowedChannels || "",
    };
  }

  function latestSlackStatus(slack) {
    if (slack?.socketMode && !slack?.appTokenConfigured) {
      return { label: "缺少 xapp token", cls: "risk-high" };
    }
    if (slack?.socketMode && !slack?.botTokenConfigured) {
      return { label: "缺少 xoxb token", cls: "risk-high" };
    }
    const recent = slack?.recentEvents || [];
    const event = recent.find((item) => String(item.type || "").startsWith("channel.socket"));
    if (!event) return { label: slack?.socketMode ? "Socket 待连接" : "HTTP 模式", cls: "kind-amber" };
    if (event.type === "channel.socket.hello" || event.type === "channel.socket.open") {
      return { label: "Socket 已连接", cls: "risk-low" };
    }
    if (event.type === "channel.socket.connect_failed" || event.type === "channel.socket.error") {
      return { label: "Socket 连接失败", cls: "risk-high" };
    }
    if (event.type === "channel.socket.connecting") return { label: "Socket 连接中", cls: "kind-amber" };
    return { label: event.type.replace("channel.", ""), cls: "kind-amber" };
  }

  function channelMetaParts(meta) {
    return String(meta || "")
      .split(" · ")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function normalizeMessageChannelId(id) {
    const key = String(id || "").trim().toLowerCase();
    return MESSAGE_CHANNEL_ALIASES[key] || key;
  }

  function messageChannelConfigSpec(id) {
    return MESSAGE_CHANNEL_CONFIGS[normalizeMessageChannelId(id)] || null;
  }

  function isMessageChannelConfigurable(id) {
    return Boolean(messageChannelConfigSpec(id));
  }

  function messageChannelPublicConfig(state = {}, id) {
    const normalized = normalizeMessageChannelId(id);
    return state.integrations?.[normalized] || state.integrations?.channelConfigs?.[normalized] || {};
  }

  function messageChannelFormFromPublic(id, config = {}) {
    const spec = messageChannelConfigSpec(id);
    if (!spec) return {};
    const form = {};
    for (const field of spec.secrets || []) form[field.key] = "";
    for (const field of spec.fields || []) {
      form[field.key] = field.type === "boolean" ? Boolean(config[field.key]) : config[field.key] || "";
    }
    return form;
  }

  function latestMessageChannelStatus(id, config = {}, channel = {}) {
    channel = channel || {};
    const normalized = normalizeMessageChannelId(id);
    const recent = config.recentEvents || [];
    if (normalized === "discord") {
      const status = latestDiscordGatewayStatus(recent);
      if (status) return status;
    }
    if (config.configured || channel.status === "connected") return { label: "已配置", cls: "risk-low" };
    const missing = missingFieldLabels(id, config);
    if (missing.length) return { label: `缺少 ${missing.slice(0, 2).join("/")}`, cls: "risk-high" };
    return { label: "未配置", cls: "kind-amber" };
  }

  function latestDiscordGatewayStatus(recent = []) {
    let pending = null;
    for (const event of recent) {
      const type = event?.type || "";
      if (!String(type).startsWith("channel.gateway")) continue;
      if (type === "channel.gateway.ready") return pending || { label: "Gateway 已连接", cls: "risk-low" };
      if (type === "channel.gateway.auth_failed") return { label: "Bot token 无效", cls: "risk-high" };
      if (type === "channel.gateway.invalid_intents") return { label: "Intents 配置错误", cls: "risk-high" };
      if (type === "channel.gateway.disallowed_intents") return { label: "Intent 未授权", cls: "risk-high" };
      if (type === "channel.gateway.failed") return { label: "Gateway 连接失败", cls: "risk-high" };
      if (type === "channel.gateway.error" || type === "channel.gateway.close") return { label: "Gateway 异常", cls: "risk-high" };
      if (type === "channel.gateway.connecting" || type === "channel.gateway.open") {
        pending = { label: "Gateway 连接中", cls: "kind-amber" };
      }
    }
    return pending;
  }

  function discordInviteUrl(applicationId, options = {}) {
    const id = String(applicationId || "").trim();
    if (!id) return "";
    const permissions = options.threads ? "274877975552" : "68608";
    const params = new URLSearchParams({
      client_id: id,
      scope: "bot",
      permissions,
    });
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
  }

  function missingFieldLabels(id, config = {}) {
    const spec = messageChannelConfigSpec(id);
    if (!spec) return [];
    const labels = config.fieldLabels || {};
    return (config.missingFields || [])
      .map((key) => labels[key] || fieldLabel(spec, key))
      .filter(Boolean);
  }

  function fieldLabel(spec, key) {
    const all = [...(spec.secrets || []), ...(spec.fields || [])];
    return all.find((field) => field.key === key)?.label || key;
  }

  return {
    channelMetaParts,
    discordInviteUrl,
    isMessageChannelConfigurable,
    latestSlackStatus,
    latestMessageChannelStatus,
    messageChannelConfigSpec,
    messageChannelFormFromPublic,
    messageChannelPublicConfig,
    missingFieldLabels,
    normalizeMessageChannelId,
    slackFormFromPublic,
  };
});
