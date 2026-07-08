"use strict";

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./state");

const SECRET_DIR = path.join(DATA_DIR, "secrets");
const SLACK_CONFIG_FILE = path.join(SECRET_DIR, "slack.json");

function getSlackConfig() {
  const stored = readStoredSlackConfig();
  return effectiveSlackConfig(stored, process.env);
}

function effectiveSlackConfig(stored = {}, env = process.env) {
  return {
    botToken: env.SLACK_BOT_TOKEN || stored.botToken || "",
    appToken: env.SLACK_APP_TOKEN || stored.appToken || "",
    signingSecret: env.SLACK_SIGNING_SECRET || stored.signingSecret || "",
    publicUrl: normalizeBaseUrl(env.SECOND_PUBLIC_URL || stored.publicUrl || ""),
    decisionChannel:
      env.SECOND_SLACK_DECISION_CHANNEL ||
      env.SLACK_DECISION_CHANNEL ||
      stored.decisionChannel ||
      "",
    socketMode:
      truthy(env.SECOND_SLACK_SOCKET_MODE || env.SLACK_SOCKET_MODE) ||
      Boolean(stored.socketMode),
    customizeProfileMessages:
      truthy(env.SECOND_SLACK_CUSTOMIZE_PROFILE || env.SLACK_CUSTOMIZE_PROFILE) ||
      Boolean(stored.customizeProfileMessages),
    allowedUsers:
      env.SECOND_SLACK_ALLOWED_USERS ||
      env.SLACK_ALLOWED_USERS ||
      stored.allowedUsers ||
      "",
    allowedChannels:
      env.SECOND_SLACK_ALLOWED_CHANNELS ||
      env.SLACK_ALLOWED_CHANNELS ||
      stored.allowedChannels ||
      "",
  };
}

function getPublicSlackConfig() {
  const stored = readStoredSlackConfig();
  return publicSlackConfigFrom(stored, process.env);
}

function publicSlackConfigFrom(stored = {}, env = process.env) {
  const effective = effectiveSlackConfig(stored, env);
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
      botToken: env.SLACK_BOT_TOKEN ? "env" : stored.botToken ? "local" : null,
      appToken: env.SLACK_APP_TOKEN ? "env" : stored.appToken ? "local" : null,
      signingSecret: env.SLACK_SIGNING_SECRET ? "env" : stored.signingSecret ? "local" : null,
    },
  };
}

function saveSlackConfig(input = {}) {
  const current = readStoredSlackConfig();
  const next = nextStoredSlackConfig(current, input);
  writeStoredSlackConfig(next);
  return getPublicSlackConfig();
}

function nextStoredSlackConfig(current = {}, input = {}) {
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
  return next;
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
  effectiveSlackConfig,
  getPublicSlackConfig,
  getSlackConfig,
  nextStoredSlackConfig,
  publicSlackConfigFrom,
  saveSlackConfig,
};
