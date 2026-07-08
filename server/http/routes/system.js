"use strict";

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

async function handleSystemRoutes(req, res, url, ctx) {
  const {
    appendEvent,
    broadcast,
    decorateState,
    detectEngines,
    getRunningTasks,
    listChannelAdapters,
    loadState,
    nowIso,
    readBody,
    saveState,
    sendJson,
    updateProfile,
  } = ctx;

  if (req.method === "GET" && url.pathname === "/api/health") {
    const state = loadState();
    state.daemon.heartbeatAt = nowIso();
    saveState(state);
    sendJson(res, 200, {
      ok: true,
      daemon: state.daemon,
      runningTasks: getRunningTasks(),
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    const state = loadState();
    state.daemon.heartbeatAt = nowIso();
    saveState(state);
    sendJson(res, 200, decorateState(state));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/profile") {
    const body = await readBody(req);
    const state = loadState();
    const profile = updateProfile(state, body);
    appendEvent(state, {
      type: "profile.update",
      text: `profile.update ${profile.name}`,
    });
    saveState(state);
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, { profile });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/codex-network") {
    const body = await readBody(req);
    const state = loadState();
    state.settings.codexNetworkAccess = Boolean(body.enabled);
    appendEvent(state, {
      type: "settings.codex_network",
      text: `settings.codex_authorized_network_proxy ${state.settings.codexNetworkAccess ? "enabled" : "disabled"}`,
    });
    saveState(state);
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, { settings: state.settings });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/channel-adapters") {
    sendJson(res, 200, { adapters: listChannelAdapters() });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/engines/detect") {
    const state = loadState();
    const engines = detectEngines(state);
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, { engines });
    return true;
  }

  const engineDefaultMatch = url.pathname.match(/^\/api\/engines\/([^/]+)\/default$/);
  if (req.method === "POST" && engineDefaultMatch) {
    const id = decodeURIComponent(engineDefaultMatch[1]);
    const state = loadState();
    if (!state.engines.some((item) => item.id === id)) {
      sendJson(res, 404, { error: "Engine not found" });
      return true;
    }
    state.settings.defaultEngine = id;
    state.engines = state.engines.map((engine) => ({ ...engine, isDefault: engine.id === id }));
    appendEvent(state, {
      type: "engine.default",
      text: `engine.default ${id}`,
    });
    saveState(state);
    broadcast({ type: "state", state: decorateState(state) });
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

module.exports = {
  handleSystemRoutes,
  truthy,
};
