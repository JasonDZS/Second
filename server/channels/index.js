"use strict";

const slack = require("./slack");
const { placeholderAdapters } = require("./placeholders");

const adapters = new Map(
  [
    slack,
    ...placeholderAdapters,
  ].map((adapter) => [adapter.id, adapter]),
);

function getChannelAdapter(id) {
  return adapters.get(id) || null;
}

function listChannelAdapters() {
  return Array.from(adapters.values()).map((adapter) => ({
    id: adapter.id,
    name: adapter.name,
    kind: adapter.kind || "adapter",
    status: adapter.status || "available",
    httpPrefix: adapter.httpPrefix || null,
    supports: adapter.supports || {},
    description: adapter.description || "",
  }));
}

function startChannelTransports(options = {}) {
  const running = [];
  for (const adapter of adapters.values()) {
    if (typeof adapter.startTransport !== "function") continue;
    const transport = adapter.startTransport(options);
    if (transport) running.push({ adapter, transport });
  }
  return {
    stop() {
      for (const item of running) {
        try {
          item.transport.stop?.();
        } catch {
          // Transport shutdown should not block daemon shutdown.
        }
      }
    },
    running,
  };
}

function findHttpChannelAdapter(pathname) {
  const normalized = normalizePathname(pathname);
  return Array.from(adapters.values()).find(
    (adapter) => adapter.httpPrefix && normalized.startsWith(adapter.httpPrefix),
  );
}

function normalizePathname(pathname) {
  return String(pathname || "/").replace(/\/{2,}/g, "/");
}

async function notifyTaskAccepted(task) {
  return callTaskAdapter(task, "sendTaskAccepted", [task]);
}

async function notifyTaskResult(task, result = {}) {
  return callTaskAdapter(task, "sendTaskResult", [task, result]);
}

async function notifyDecisionRequested(decision, task) {
  const adapter =
    adapterForDecision(decision, task) ||
    getChannelAdapter(process.env.SECOND_DEFAULT_CHANNEL || "slack");
  if (!adapter?.sendDecisionRequested) return skipped("No channel adapter can send decision requests");
  return adapter.sendDecisionRequested(decision, task);
}

async function notifyDecisionResolved(decision, task) {
  const adapter =
    adapterForDecision(decision, task) ||
    getChannelAdapter(process.env.SECOND_DEFAULT_CHANNEL || "slack");
  if (!adapter?.sendDecisionResolved) return skipped("No channel adapter can send decision resolution updates");
  return adapter.sendDecisionResolved(decision, task);
}

function callTaskAdapter(task, method, args) {
  const adapter = adapterForTask(task);
  if (!adapter?.[method]) return skipped(`No channel adapter can handle ${method}`);
  return adapter[method](...args);
}

function adapterForDecision(decision, task) {
  const channelId =
    decision?.channel?.id ||
    task?.channel?.id ||
    legacyChannelId(decision) ||
    legacyChannelId(task);
  return channelId ? getChannelAdapter(channelId) : null;
}

function adapterForTask(task) {
  const channelId = task?.channel?.id || legacyChannelId(task);
  return channelId ? getChannelAdapter(channelId) : null;
}

function legacyChannelId(value) {
  if (value?.slack) return "slack";
  return null;
}

function skipped(reason) {
  return Promise.resolve({ ok: false, skipped: true, reason });
}

module.exports = {
  findHttpChannelAdapter,
  getChannelAdapter,
  listChannelAdapters,
  normalizePathname,
  notifyDecisionRequested,
  notifyDecisionResolved,
  notifyTaskAccepted,
  notifyTaskResult,
  startChannelTransports,
};
