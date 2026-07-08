"use strict";

function createChannelController(deps = {}) {
  const {
    appendEvent,
    broadcast,
    channelProcessor,
    decorateState,
    getChannelAdapter,
    loadState,
    readRawBody,
    saveState,
    sendJson,
    startChannelTransports,
  } = deps;

  let activeChannelTransports = null;

  async function refreshSlackChannelNames() {
    const adapter = getChannelAdapter("slack");
    if (typeof adapter?.resolveChannelInfo !== "function") return;
    const state = loadState();
    let changed = false;
    const ids = new Set();
    for (const task of state.tasks || []) {
      const external = task.channel?.external || task.slack || {};
      if (task.channel?.id === "slack" && external.channel && !external.channelName) ids.add(external.channel);
    }
    for (const channelId of ids) {
      const info = await adapter.resolveChannelInfo(channelId);
      if (!info?.name) continue;
      for (const task of state.tasks || []) {
        const external = task.channel?.external || task.slack || {};
        if (task.channel?.id !== "slack" || external.channel !== channelId) continue;
        if (task.channel?.external) {
          task.channel.external.channelName = info.name;
          task.channel.external.channelLabel = info.label || `#${info.name}`;
        }
        if (task.slack) {
          task.slack.channelName = info.name;
          task.slack.channelLabel = info.label || `#${info.name}`;
        }
        task.source = `Slack ${info.label || `#${info.name}`}`;
        if (task.sourceMessage?.external) {
          task.sourceMessage.external.channelName = info.name;
          task.sourceMessage.external.channelLabel = info.label || `#${info.name}`;
        }
        changed = true;
      }
    }
    if (!changed) return;
    saveState(state);
    broadcast({ type: "state", state: decorateState(state) });
  }

  function restartChannelTransports() {
    stopChannelTransports();
    activeChannelTransports = startChannelTransports({
      getProfile: () => loadState().profile,
      isKnownThread: (event) => isKnownChannelThread(event),
      processEnvelope: (adapter, envelope) => processChannelEnvelope(adapter, envelope),
      onStatus: (event) => {
        const latest = loadState();
        appendEvent(latest, {
          type: `channel.${event.type}`,
          text: event.text || `channel.${event.type}`,
          channelId: event.channelId,
        });
        saveState(latest);
        broadcast({ type: "state", state: decorateState(latest) });
      },
    });
    return activeChannelTransports;
  }

  function stopChannelTransports() {
    if (!activeChannelTransports) return;
    activeChannelTransports.stop();
    activeChannelTransports = null;
  }

  async function handleChannel(req, res, url, adapter) {
    const rawBody = await readRawBody(req);
    const envelope = await adapter.receiveHttp({
      req,
      url,
      rawBody,
      profile: loadState().profile,
      isKnownThread: (event) => isKnownChannelThread(event),
    });
    if (!envelope || envelope.kind === "response") {
      return sendChannelResponse(res, envelope || { response: { status: 200, body: { ok: true } } });
    }
    const result = processChannelEnvelope(adapter, envelope);
    return sendChannelResponse(res, envelope, result);
  }

  function processChannelEnvelope(adapter, envelope) {
    return channelProcessor.processChannelEnvelope(adapter, envelope);
  }

  function isKnownChannelThread(event = {}) {
    return channelProcessor.isKnownChannelThread(event);
  }

  function findChannelThreadTask(state, input = {}) {
    return channelProcessor.findChannelThreadTask(state, input);
  }

  function sendChannelResponse(res, envelope, data = {}) {
    const response =
      typeof envelope.response === "function"
        ? envelope.response(data)
        : envelope.response || { status: 200, body: { ok: true } };
    if (Object.prototype.hasOwnProperty.call(response, "rawBody")) {
      res.writeHead(response.status || 200, {
        "Content-Type": response.contentType || "text/plain; charset=utf-8",
      });
      res.end(String(response.rawBody ?? ""));
      return;
    }
    return sendJson(res, response.status || 200, response.body || { ok: true });
  }

  return {
    findChannelThreadTask,
    handleChannel,
    isKnownChannelThread,
    processChannelEnvelope,
    refreshSlackChannelNames,
    restartChannelTransports,
    sendChannelResponse,
    stopChannelTransports,
  };
}

module.exports = {
  createChannelController,
};
