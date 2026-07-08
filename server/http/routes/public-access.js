"use strict";

async function handlePublicAccessRoutes(req, res, url, ctx) {
  const {
    broadcast,
    decorateState,
    loadState,
    publicAccess,
    readBody,
    sendJson,
  } = ctx;

  if (!publicAccess) return false;

  if (req.method === "GET" && url.pathname === "/api/public-access") {
    sendJson(res, 200, { publicAccess: publicAccess.publicConfig(loadState()) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/public-access/config") {
    const body = await readBody(req);
    const result = publicAccess.configure(body);
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, { publicAccess: result });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/public-access/start") {
    const body = await readBody(req);
    const result = await publicAccess.start(body);
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, { publicAccess: result });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/public-access/stop") {
    const result = publicAccess.stop();
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, { publicAccess: result });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/public-access/check") {
    const body = await readBody(req);
    const result = await publicAccess.check(body);
    broadcast({ type: "state", state: decorateState(loadState()) });
    sendJson(res, 200, result);
    return true;
  }

  return false;
}

module.exports = {
  handlePublicAccessRoutes,
};
