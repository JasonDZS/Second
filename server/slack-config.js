"use strict";

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./state");

const SECRET_DIR = path.join(DATA_DIR, "secrets");
const SLACK_CONFIG_FILE = path.join(SECRET_DIR, "slack.json");

function getSlackConfig() {
  const stored = readStoredSlackConfig();
  return {
    botToken: process.env.SLACK_BOT_TOKEN || stored.botToken || "",
    appToken: process.env.SLACK_APP_TOKEN || stored.appToken || "",
    signingSecret: process.env.SLACK_SIGNING_SECRET || stored.signingSecret || "",
    publicUrl: normalizeBaseUrl(process.env.SECOND_PUBLIC_URL || stored.publicUrl || ""),
    decisionChannel:
      process.env.SECOND_SLACK_DECISION_CHANNEL ||
      process.env.SLACK_DECISION_CHANNEL ||
      stored.decisionChannel ||
      "",
    socketMode:
      truthy(process.env.SECOND_SLACK_SOCKET_MODE || process.env.SLACK_SOCKET_MODE) ||
      Boolean(stored.socketMode),
    customizeProfileMessages:
      truthy(process.env.SECOND_SLACK_CUSTOMIZE_PROFILE || process.env.SLACK_CUSTOMIZE_PROFILE) ||
      Boolean(stored.customizeProfileMessages),
    allowedUsers:
      process.env.SECOND_SLACK_ALLOWED_USERS ||
      process.env.SLACK_ALLOWED_USERS ||
      stored.allowedUsers ||
      "",
    allowedChannels:
      process.env.SECOND_SLACK_ALLOWED_CHANNELS ||
      process.env.SLACK_ALLOWED_CHANNELS ||
      stored.allowedChannels ||
      "",
  };
}

function getPublicSlackConfig() {
  const stored = readStoredSlackConfig();
  const effective = getSlackConfig();
  return {
    mode: effective.socketMode ? "socket" : "http",
    socketMode: Boolean(effective.socketMode),
    publicUrl: effective.publicUrl,
    decisionChannel: effective.decisionChannel,
    customizeProfileMessages: Boolean(effective.customizeProfileMessages),
    allowedUsers: effective.allowedUsers,
    allowedChannels: effective.allowedChannels,
    botTokenConfigured: Boolean(effective.botToken),
    appTokenConfigured: Boolean(effective.appToken),
    signingSecretConfigured: Boolean(effective.signingSecret),
    botTokenLabel: tokenLabel(effective.botToken),
    appTokenLabel: tokenLabel(effective.appToken),
    signingSecretLabel: tokenLabel(effective.signingSecret),
    sources: {
      botToken: process.env.SLACK_BOT_TOKEN ? "env" : stored.botToken ? "local" : null,
      appToken: process.env.SLACK_APP_TOKEN ? "env" : stored.appToken ? "local" : null,
      signingSecret: process.env.SLACK_SIGNING_SECRET ? "env" : stored.signingSecret ? "local" : null,
    },
  };
}

function saveSlackConfig(input = {}) {
  const current = readStoredSlackConfig();
  const next = { ...current };
  for (const key of ["botToken", "appToken", "signingSecret"]) {
    if (typeof input[key] === "string" && input[key].trim() && !isMasked(input[key])) {
      next[key] = input[key].trim();
    }
  }
  for (const key of ["decisionChannel", "allowedUsers", "allowedChannels"]) {
    if (Object.prototype.hasOwnProperty.call(input, key)) next[key] = String(input[key] || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(input, "publicUrl")) {
    next.publicUrl = normalizeBaseUrl(input.publicUrl || "");
  }
  if (Object.prototype.hasOwnProperty.call(input, "socketMode")) {
    next.socketMode = Boolean(input.socketMode);
  }
  if (Object.prototype.hasOwnProperty.call(input, "customizeProfileMessages")) {
    next.customizeProfileMessages = Boolean(input.customizeProfileMessages);
  }
  writeStoredSlackConfig(next);
  return getPublicSlackConfig();
}

function readStoredSlackConfig() {
  try {
    return JSON.parse(fs.readFileSync(SLACK_CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeStoredSlackConfig(value) {
  fs.mkdirSync(SECRET_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SLACK_CONFIG_FILE, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(SECRET_DIR, 0o700);
    fs.chmodSync(SLACK_CONFIG_FILE, 0o600);
  } catch {
    // chmod is best-effort on non-POSIX filesystems.
  }
}

function tokenLabel(value) {
  if (!value) return "";
  const text = String(value);
  if (text.length <= 10) return "已配置";
  return `${text.slice(0, 5)}...${text.slice(-4)}`;
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function isMasked(value) {
  return /\*{2,}|…|\.{3}/.test(String(value || ""));
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

module.exports = {
  getPublicSlackConfig,
  getSlackConfig,
  saveSlackConfig,
};
