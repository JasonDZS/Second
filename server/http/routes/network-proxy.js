"use strict";

const http = require("http");
const https = require("https");
const { authorizeToolUse } = require("../../authorization/service");

const MAX_PROXY_RESPONSE_BYTES = 128 * 1024;

async function handleNetworkProxyRoutes(req, res, url, ctx) {
  const {
    appendAuthorizationAudit,
    appendDecisionLog,
    appendEvent,
    broadcast,
    decorateState,
    httpProxyRequest = defaultHttpProxyRequest,
    loadState,
    makeId,
    notifyDecisionRequested,
    nowIso,
    readBody,
    saveState,
    sendJson,
  } = ctx;

  if (req.method === "POST" && url.pathname === "/api/proxy/http") {
    const body = await readBody(req);
    const authorization = authorizeToolUse(
      {
        ...body,
        tool: body.tool || "HTTP",
        source: body.source || "Second network proxy",
      },
      {
        appendAuthorizationAudit,
        appendDecisionLog,
        appendEvent,
        loadState,
        makeId,
        nowIso,
        notifyDecisionRequested,
        saveState,
      },
    );
    if (!authorization.dryRun) broadcast({ type: "state", state: decorateState(loadState()) });
    if (authorization.action !== "allow") {
      sendJson(res, authorization.action === "gate" ? 202 : 403, { authorization });
      return true;
    }
    const response = await httpProxyRequest(sanitizeProxyRequest(body));
    sendJson(res, 200, { ok: true, authorization, response });
    return true;
  }

  return false;
}

function sanitizeProxyRequest(input = {}) {
  const method = String(input.method || "GET").toUpperCase();
  const parsed = new URL(input.url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw Object.assign(new Error("Only http and https proxy URLs are supported"), { statusCode: 400 });
  const headers = {};
  for (const [key, value] of Object.entries(input.headers || {})) {
    const lower = key.toLowerCase();
    if (["authorization", "cookie", "proxy-authorization", "x-api-key"].includes(lower)) continue;
    if (["connection", "content-length", "host", "transfer-encoding"].includes(lower)) continue;
    headers[key] = String(value);
  }
  return {
    body: typeof input.body === "string" ? input.body : input.body == null ? "" : JSON.stringify(input.body),
    headers,
    method,
    url: parsed,
  };
}

function defaultHttpProxyRequest(request) {
  return new Promise((resolve, reject) => {
    const client = request.url.protocol === "https:" ? https : http;
    const req = client.request(
      request.url,
      {
        method: request.method,
        headers: request.headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (Buffer.byteLength(body) > MAX_PROXY_RESPONSE_BYTES) req.destroy(new Error("Proxy response exceeded size limit"));
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            headers: publicResponseHeaders(res.headers),
            body,
          });
        });
      },
    );
    req.on("error", reject);
    if (request.body && request.method !== "GET" && request.method !== "HEAD") req.write(request.body);
    req.end();
  });
}

function publicResponseHeaders(headers = {}) {
  const out = {};
  for (const key of ["content-type", "etag", "last-modified"]) {
    if (headers[key]) out[key] = headers[key];
  }
  return out;
}

module.exports = {
  defaultHttpProxyRequest,
  handleNetworkProxyRoutes,
  sanitizeProxyRequest,
};
