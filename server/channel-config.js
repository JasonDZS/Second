"use strict";

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./state");

const SECRET_DIR = path.join(DATA_DIR, "secrets");

const CHANNEL_CONFIGS = {
  discord: {
    label: "Discord",
    webhookPath: "/discord/webhook",
    required: ["botToken"],
    fields: [
      { key: "botToken", secret: true, label: "Bot Token", env: ["DISCORD_BOT_TOKEN", "SECOND_DISCORD_BOT_TOKEN"] },
      { key: "applicationId", label: "Application ID", env: ["DISCORD_APPLICATION_ID", "SECOND_DISCORD_APPLICATION_ID"] },
      { key: "messageContentIntent", type: "boolean", label: "启用 Message Content Intent", env: ["SECOND_DISCORD_MESSAGE_CONTENT_INTENT", "DISCORD_MESSAGE_CONTENT_INTENT"] },
      { key: "allowedUsers", label: "允许用户 ID", env: ["SECOND_DISCORD_ALLOWED_USERS", "DISCORD_ALLOWED_USERS"] },
      { key: "allowedChannels", label: "允许频道 ID", env: ["SECOND_DISCORD_ALLOWED_CHANNELS", "DISCORD_ALLOWED_CHANNELS"] },
      { key: "testTarget", label: "测试频道 ID" },
    ],
  },
  telegram: {
    label: "Telegram",
    webhookPath: "/telegram/webhook",
    required: ["botToken"],
    fields: [
      { key: "botToken", secret: true, label: "Bot Token", env: ["TELEGRAM_BOT_TOKEN", "SECOND_TELEGRAM_BOT_TOKEN"] },
      { key: "webhookSecret", secret: true, label: "Webhook Secret", env: ["TELEGRAM_WEBHOOK_SECRET", "SECOND_TELEGRAM_WEBHOOK_SECRET"] },
      { key: "allowedUsers", label: "允许用户 ID", env: ["SECOND_TELEGRAM_ALLOWED_USERS", "TELEGRAM_ALLOWED_USERS"] },
      { key: "allowedChannels", label: "允许 Chat ID", env: ["SECOND_TELEGRAM_ALLOWED_CHATS", "TELEGRAM_ALLOWED_CHATS"] },
      { key: "testTarget", label: "测试 Chat ID" },
    ],
  },
  whatsapp: {
    label: "WhatsApp",
    webhookPath: "/whatsapp/webhook",
    required: ["accessToken", "phoneNumberId"],
    fields: [
      { key: "accessToken", secret: true, label: "Access Token", env: ["WHATSAPP_ACCESS_TOKEN", "SECOND_WHATSAPP_ACCESS_TOKEN"] },
      { key: "verifyToken", secret: true, label: "Verify Token", env: ["WHATSAPP_VERIFY_TOKEN", "SECOND_WHATSAPP_VERIFY_TOKEN"] },
      { key: "phoneNumberId", label: "Phone Number ID", env: ["WHATSAPP_PHONE_NUMBER_ID", "SECOND_WHATSAPP_PHONE_NUMBER_ID"] },
      { key: "allowedUsers", label: "允许手机号", env: ["SECOND_WHATSAPP_ALLOWED_USERS", "WHATSAPP_ALLOWED_USERS"] },
      { key: "allowedChannels", label: "允许会话", env: ["SECOND_WHATSAPP_ALLOWED_CHATS", "WHATSAPP_ALLOWED_CHATS"] },
      { key: "testTarget", label: "测试接收手机号" },
    ],
  },
  dingding: {
    label: "DingTalk",
    aliases: ["dingtalk"],
    webhookPath: "/dingtalk/webhook",
    required: ["webhookUrl"],
    fields: [
      { key: "webhookUrl", secret: true, label: "机器人 Webhook URL", env: ["DINGTALK_WEBHOOK_URL", "SECOND_DINGTALK_WEBHOOK_URL"] },
      { key: "secret", secret: true, label: "签名 Secret", env: ["DINGTALK_SECRET", "SECOND_DINGTALK_SECRET"] },
      { key: "allowedUsers", label: "允许用户 ID", env: ["SECOND_DINGTALK_ALLOWED_USERS", "DINGTALK_ALLOWED_USERS"] },
      { key: "allowedChannels", label: "允许会话 ID", env: ["SECOND_DINGTALK_ALLOWED_CONVERSATIONS", "DINGTALK_ALLOWED_CONVERSATIONS"] },
    ],
  },
  feishu: {
    label: "Feishu",
    webhookPath: "/feishu/webhook",
    required: ["webhookUrl"],
    fields: [
      { key: "webhookUrl", secret: true, label: "机器人 Webhook URL", env: ["FEISHU_WEBHOOK_URL", "LARK_WEBHOOK_URL", "SECOND_FEISHU_WEBHOOK_URL"] },
      { key: "allowedUsers", label: "允许用户 ID", env: ["SECOND_FEISHU_ALLOWED_USERS", "FEISHU_ALLOWED_USERS"] },
      { key: "allowedChannels", label: "允许 Chat ID", env: ["SECOND_FEISHU_ALLOWED_CHATS", "FEISHU_ALLOWED_CHATS"] },
    ],
  },
};

const ALIASES = Object.fromEntries(
  Object.entries(CHANNEL_CONFIGS).flatMap(([id, spec]) => (spec.aliases || []).map((alias) => [alias, id])),
);

function getChannelConfig(id) {
  const normalized = normalizeChannelConfigId(id);
  const spec = CHANNEL_CONFIGS[normalized];
  if (!spec) return {};
  const stored = readStoredChannelConfig(normalized);
  const config = {};
  for (const field of spec.fields) {
    if (field.type === "boolean") {
      const envValue = firstEnv(field.env);
      config[field.key] = envValue ? truthy(envValue) : Boolean(stored[field.key]);
    } else {
      config[field.key] = firstEnv(field.env) || stored[field.key] || "";
    }
  }
  return config;
}

function getPublicChannelConfig(id) {
  const normalized = normalizeChannelConfigId(id);
  const spec = CHANNEL_CONFIGS[normalized];
  if (!spec) return null;
  const stored = readStoredChannelConfig(normalized);
  const effective = getChannelConfig(normalized);
  const publicConfig = {
    id: normalized,
    label: spec.label,
    webhookPath: spec.webhookPath || "",
    configured: (spec.required || []).every((key) => Boolean(effective[key])),
    missingFields: (spec.required || []).filter((key) => !effective[key]),
    fieldLabels: Object.fromEntries(spec.fields.map((field) => [field.key, field.label || field.key])),
    sources: {},
  };

  for (const field of spec.fields) {
    const value = effective[field.key] || "";
    const source = sourceForField(field, stored);
    publicConfig.sources[field.key] = source;
    if (field.secret) {
      publicConfig[`${field.key}Configured`] = Boolean(value);
      publicConfig[`${field.key}Label`] = tokenLabel(value);
    } else if (field.type === "boolean") {
      publicConfig[field.key] = Boolean(value);
    } else {
      publicConfig[field.key] = value;
    }
  }
  return publicConfig;
}

function getPublicChannelConfigs() {
  return Object.fromEntries(listChannelConfigIds().map((id) => [id, getPublicChannelConfig(id)]));
}

function saveChannelConfig(id, input = {}) {
  const normalized = normalizeChannelConfigId(id);
  const spec = CHANNEL_CONFIGS[normalized];
  if (!spec) {
    const error = new Error("Channel integration is not configurable");
    error.statusCode = 404;
    throw error;
  }
  const current = readStoredChannelConfig(normalized);
  const next = { ...current };
  for (const field of spec.fields) {
    if (!Object.prototype.hasOwnProperty.call(input, field.key)) continue;
    const value = String(input[field.key] || "").trim();
    if (field.type === "boolean") {
      next[field.key] = Boolean(input[field.key]);
    } else if (field.secret) {
      if (value && !isMasked(value)) next[field.key] = value;
    } else {
      next[field.key] = value;
    }
  }
  writeStoredChannelConfig(normalized, next);
  return getPublicChannelConfig(normalized);
}

function isConfigurableChannel(id) {
  return Boolean(CHANNEL_CONFIGS[normalizeChannelConfigId(id)]);
}

function getChannelConfigSpec(id) {
  return CHANNEL_CONFIGS[normalizeChannelConfigId(id)] || null;
}

function listChannelConfigIds() {
  return Object.keys(CHANNEL_CONFIGS);
}

function normalizeChannelConfigId(id) {
  const key = String(id || "").trim().toLowerCase();
  return ALIASES[key] || key;
}

function readStoredChannelConfig(id) {
  try {
    return JSON.parse(fs.readFileSync(channelConfigFile(id), "utf8"));
  } catch {
    return {};
  }
}

function writeStoredChannelConfig(id, value) {
  fs.mkdirSync(SECRET_DIR, { recursive: true, mode: 0o700 });
  const file = channelConfigFile(id);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(SECRET_DIR, 0o700);
    fs.chmodSync(file, 0o600);
  } catch {
    // chmod is best-effort on non-POSIX filesystems.
  }
}

function channelConfigFile(id) {
  return path.join(SECRET_DIR, `${normalizeChannelConfigId(id)}.json`);
}

function firstEnv(names = []) {
  for (const name of names || []) {
    if (process.env[name]) return process.env[name];
  }
  return "";
}

function sourceForField(field, stored = {}) {
  if (firstEnv(field.env)) return "env";
  if (stored[field.key]) return "local";
  return null;
}

function tokenLabel(value) {
  if (!value) return "";
  const text = String(value);
  if (text.length <= 10) return "已配置";
  return `${text.slice(0, 5)}...${text.slice(-4)}`;
}

function isMasked(value) {
  return /\*{2,}|…|\.{3}/.test(String(value || ""));
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

module.exports = {
  getChannelConfig,
  getChannelConfigSpec,
  getPublicChannelConfig,
  getPublicChannelConfigs,
  isConfigurableChannel,
  listChannelConfigIds,
  normalizeChannelConfigId,
  saveChannelConfig,
};
