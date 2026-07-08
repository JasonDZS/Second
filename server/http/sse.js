"use strict";

function createSseHub({ decorateState, loadState } = {}) {
  const clients = new Set();

  function handleEvents(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: state\ndata: ${JSON.stringify(decorateState(loadState()))}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  }

  function broadcast(payload) {
    const body = `event: ${payload.type || "message"}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) {
      client.write(body);
    }
  }

  return {
    broadcast,
    clients,
    handleEvents,
  };
}

module.exports = {
  createSseHub,
};
