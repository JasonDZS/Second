"use strict";

const fs = require("fs");
const path = require("path");
const {
  NICE_AVATAR_SOURCE_URL,
  niceAvatarConfigFromSeed,
  niceAvatarDataUrl,
  normalizeNiceAvatarConfig,
  normalizeNiceAvatarShape,
} = require("../public/profile");
const { seedState, traceT2087 } = require("./state/seed");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, ".second");
const RUNS_DIR = path.join(DATA_DIR, "runs");
const PROFILE_DIR = path.join(DATA_DIR, "profile");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const PREFERENCES_FILE = path.join(PROFILE_DIR, "PREFERENCES.md");
const AUTHORIZATION_FILE = path.join(PROFILE_DIR, "AUTHORIZATION.md");
const DECISIONS_LOG_FILE = path.join(PROFILE_DIR, "DECISIONS.log");

function ensureDataDirs() {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  ensureDataDirs();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (error) {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // Cleanup failure should not hide the original persistence error.
    }
    throw error;
  }
}

function writeIfMissing(file, value) {
  ensureDataDirs();
  if (!fs.existsSync(file)) fs.writeFileSync(file, value);
}

function makeId(prefix) {
  const n = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${n}${r}`;
}

function loadState() {
  ensureDataDirs();
  ensureProfileFiles();
  if (!fs.existsSync(STATE_FILE)) {
    const seeded = seedState();
    saveState(seeded);
    return seeded;
  }
  const state = readJson(STATE_FILE);
  return normalizeState(state);
}

function saveState(state) {
  state.updatedAt = nowIso();
  writeJson(STATE_FILE, state);
}

function appendEvent(state, event) {
  const entry = {
    id: makeId("E"),
    at: nowIso(),
    ...event,
  };
  state.events.unshift(entry);
  state.events = state.events.slice(0, 500);
  return entry;
}

function ensureProfileFiles() {
  writeIfMissing(
    PREFERENCES_FILE,
    [
      "# Second Preferences",
      "",
      "- PR 描述使用中文,附风险清单与回滚方式。",
      "- 报表结论先行,数据放附录; SKU 统计按去重口径。",
      "- 优先复用现有工具函数,避免新增依赖。",
      "",
    ].join("\n"),
  );
  writeIfMissing(
    AUTHORIZATION_FILE,
    [
      "# Second Authorization",
      "",
      "## Allow",
      "",
      "- Read and write files inside the assigned Second run workspace.",
      "- Run local tests, linters, formatters, and read-only repository inspection commands.",
      "- Send Slack messages to configured task or decision channels when Slack credentials are present.",
      "",
      "## Human Gate Required",
      "",
      "- Production database writes or migrations.",
      "- Publishing packages, deploying services, or modifying remote infrastructure.",
      "- Mutating remote git/GitHub state: push, merge, release, or destructive branch operations.",
      "- Reading or writing outside the assigned workspace.",
      "",
      "## Deny",
      "",
      "- Read `.env`, private keys, SSH keys, token files, or files containing secrets unless the user explicitly provides them for this task.",
      "- Destructive filesystem operations such as `rm -rf /`, wiping home directories, or deleting unrelated repositories.",
      "",
    ].join("\n"),
  );
  writeIfMissing(DECISIONS_LOG_FILE, "");
  return {
    preferencesFile: PREFERENCES_FILE,
    authorizationFile: AUTHORIZATION_FILE,
    decisionsLogFile: DECISIONS_LOG_FILE,
  };
}

function readProfileContext() {
  ensureProfileFiles();
  return {
    preferences: fs.readFileSync(PREFERENCES_FILE, "utf8"),
    authorization: fs.readFileSync(AUTHORIZATION_FILE, "utf8"),
  };
}

function appendDecisionLog(entry) {
  ensureProfileFiles();
  fs.appendFileSync(DECISIONS_LOG_FILE, `${JSON.stringify({ at: nowIso(), ...entry })}\n`);
}

function mergeById(defaultItems, currentItems) {
  const byId = new Map((currentItems || []).map((item) => [item.id, item]));
  const merged = defaultItems.map((item) => ({ ...item, ...(byId.get(item.id) || {}) }));
  const defaultIds = new Set(defaultItems.map((item) => item.id));
  for (const item of currentItems || []) {
    if (!defaultIds.has(item.id)) merged.push(item);
  }
  return merged;
}

function normalizeState(state) {
  const seeded = seedState();
  return {
    ...seeded,
    ...state,
    profile: normalizeProfile({ ...seeded.profile, ...(state.profile || {}) }),
    daemon: { ...seeded.daemon, ...(state.daemon || {}) },
    settings: { ...seeded.settings, ...(state.settings || {}) },
    engines: state.engines || seeded.engines,
    channels: mergeById(seeded.channels, state.channels),
    assistant: normalizeAssistantState({ ...seeded.assistant, ...(state.assistant || {}) }),
    decisions: state.decisions || seeded.decisions,
    tasks: state.tasks || seeded.tasks,
    rules: state.rules || seeded.rules,
    preferences: state.preferences || seeded.preferences,
    candidates: state.candidates || seeded.candidates,
    events: state.events || seeded.events,
  };
}

function normalizeAssistantState(assistant = {}) {
  return {
    activeConversationId: assistant.activeConversationId || "local-assistant",
    messages: Array.isArray(assistant.messages) ? assistant.messages : [],
  };
}

function normalizeProfile(profile = {}) {
  const seed = profile.avatarSeed || profile.name || profile.avatar || "Second";
  const avatarConfig = normalizeNiceAvatarConfig(profile.avatarConfig || niceAvatarConfigFromSeed(seed), seed);
  const avatarShape = normalizeNiceAvatarShape(profile.avatarShape || profile.avatarConfig?.shape || "circle");
  return {
    ...profile,
    avatarStyle: "nice-avatar",
    avatarProvider: "nice-avatar",
    avatarSourceUrl: NICE_AVATAR_SOURCE_URL,
    avatarShape,
    avatarConfig,
    avatarUrl: niceAvatarDataUrl(avatarConfig, avatarShape),
  };
}

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  PROFILE_DIR,
  RUNS_DIR,
  STATE_FILE,
  PREFERENCES_FILE,
  AUTHORIZATION_FILE,
  DECISIONS_LOG_FILE,
  appendDecisionLog,
  appendEvent,
  ensureDataDirs,
  ensureProfileFiles,
  loadState,
  makeId,
  nowIso,
  readProfileContext,
  saveState,
  traceT2087,
};
