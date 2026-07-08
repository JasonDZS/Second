"use strict";

const codex = require("./codex");

const runtimeAdapters = [
  codex.codexRuntimeAdapter,
  {
    id: "claude",
    engineId: "claude-code",
    name: "Claude Code",
    command: "claude",
    versionArgs: ["--version"],
    status: "probe-only",
    authorization: {
      mode: "none",
      yellowZone: "deny",
      reason: "Claude adapter is probe-only until action-level hooks or an MCP proxy are configured.",
    },
    normalizeEvent(raw, context = {}) {
      return codex.normalizeAgentRuntimeEvent("claude", raw, context);
    },
  },
].filter(Boolean);

function listRuntimeAdapters() {
  return runtimeAdapters.map((adapter) => ({ ...adapter }));
}

function getRuntimeAdapter(id) {
  const key = String(id || "").toLowerCase();
  return runtimeAdapters.find((adapter) => adapter.id === key || adapter.engineId === key) || null;
}

function runtimeEngineAdapters() {
  return runtimeAdapters.filter((adapter) => adapter.engineId && adapter.command);
}

module.exports = {
  getRuntimeAdapter,
  listRuntimeAdapters,
  runtimeEngineAdapters,
};
