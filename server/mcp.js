"use strict";

const http = require("http");
const readline = require("readline");
const {
  appendAuthorizationAudit,
  appendDecisionLog,
  appendEvent,
  loadState,
  makeId,
  nowIso,
  saveState,
} = require("./state");
const { authorizeToolUse } = require("./authorization/service");
const { createMcpDecisionRequest, resolveDecision } = require("./app");

const PRODUCT_NAME = "Second";
const TOOLS = [
  {
    name: "decision_request",
    description: `Create a ${PRODUCT_NAME} decision request and return its id.`,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        type: { type: "string" },
        risk: { type: "string", enum: ["低", "中", "高"] },
        taskId: { type: "string" },
        taskTitle: { type: "string" },
        source: { type: "string" },
        agent: { type: "string" },
        engine: { type: "string" },
        summary: { type: "string" },
        impact: { type: "array", items: { type: "string" } },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              description: { type: "string" },
              recommended: { type: "boolean" },
            },
          },
        },
      },
      required: ["title", "summary"],
    },
  },
  {
    name: "decision_list",
    description: `List ${PRODUCT_NAME} decisions, newest first.`,
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
      },
    },
  },
  {
    name: "decision_result",
    description: `Read one ${PRODUCT_NAME} decision by id.`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "decision_resolve",
    description: `Approve or reject one ${PRODUCT_NAME} decision.`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        verdict: { type: "string", enum: ["approved", "rejected"] },
        optionId: { type: "string" },
      },
      required: ["id", "verdict"],
    },
  },
  {
    name: "decision_reply",
    description: `Append a reply or evidence note to one ${PRODUCT_NAME} decision.`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        message: { type: "string" },
      },
      required: ["id", "message"],
    },
  },
  {
    name: "authorization_check",
    description: `Evaluate a tool payload through ${PRODUCT_NAME} authorization. In enforce mode, gate/deny stops the caller and may create a Human Gate decision.`,
    inputSchema: {
      type: "object",
      properties: {
        tool: { type: "string" },
        command: { type: "string" },
        taskId: { type: "string" },
        dryRun: { type: "boolean" },
        mode: { type: "string", enum: ["dry_run", "enforce"] },
        payload: { type: "object" },
      },
      required: ["tool"],
    },
  },
  {
    name: "authorized_http_request",
    description: `Make an outbound HTTP request through the ${PRODUCT_NAME} daemon authorization proxy. Gate/deny responses do not touch the network.`,
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string" },
        url: { type: "string" },
        headers: { type: "object" },
        body: {},
        taskId: { type: "string" },
      },
      required: ["url"],
    },
  },
];

function serveMcp({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }
    Promise.resolve(handle(req))
      .then((result) => {
        output.write(`${JSON.stringify(result)}\n`);
      })
      .catch((error) => {
        output.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32000, message: error.message },
          })}\n`,
        );
      });
  });
}

async function handle(req) {
  const method = req.method;
  if (method === "initialize") {
    return response(req.id, {
      protocolVersion: req.params?.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "second-decision", version: "0.1.0" },
    });
  }
  if (method === "notifications/initialized") {
    return { jsonrpc: "2.0", id: req.id, result: {} };
  }
  if (method === "tools/list") {
    return response(req.id, { tools: TOOLS });
  }
  if (method === "tools/call") {
    const name = req.params?.name;
    const args = req.params?.arguments || {};
    return response(req.id, await callTool(name, args));
  }
  return {
    jsonrpc: "2.0",
    id: req.id,
    error: { code: -32601, message: `Unknown method: ${method}` },
  };
}

async function callTool(name, args, options = {}) {
  if (name === "decision_request") {
    const result = (await tryDaemonRequest("/api/mcp/decision-request", args)) || createMcpDecisionRequest(loadState(), args);
    return textContent(
      JSON.stringify(
        {
          id: result.id,
          status: result.status,
          instruction: result.instruction,
        },
        null,
        2,
      ),
    );
  }

  if (name === "decision_list") {
    const state = loadState();
    const list = state.decisions.filter((item) => !item.archivedAt && (!args.status || item.status === args.status));
    return textContent(JSON.stringify(list, null, 2));
  }

  if (name === "decision_result") {
    const state = loadState();
    const decision = state.decisions.find((item) => item.id === args.id && !item.archivedAt);
    return textContent(JSON.stringify(decision || null, null, 2));
  }

  if (name === "decision_resolve") {
    const payload = {
      verdict: args.verdict,
      optionId: args.optionId,
    };
    const result =
      (await tryDaemonRequest(`/api/decisions/${encodeURIComponent(args.id)}/resolve`, payload)) ||
      resolveDecision(loadState(), args.id, payload);
    return textContent(JSON.stringify(result.decision, null, 2));
  }

  if (name === "decision_reply") {
    const daemonResult = await tryDaemonRequest(`/api/decisions/${encodeURIComponent(args.id)}/reply`, {
      message: args.message,
      role: "agent",
      actor: "agent",
      resume: false,
    });
    if (daemonResult) return textContent(JSON.stringify({ ok: true, reply: daemonResult.reply }, null, 2));

    const state = loadState();
    const decision = state.decisions.find((item) => item.id === args.id && !item.archivedAt);
    if (!decision) throw new Error("Decision not found");
    decision.replies = decision.replies || [];
    decision.replies.push({ at: nowIso(), role: "agent", actor: "agent", message: args.message });
    appendEvent(state, {
      type: "decision.reply",
      text: `decision.reply ${decision.id}`,
      taskId: decision.taskId,
      decisionId: decision.id,
    });
    saveState(state);
    return textContent(JSON.stringify({ ok: true }, null, 2));
  }

  if (name === "authorization_check") {
    const payload = {
      ...(args.payload || {}),
      ...args,
      dryRun: args.dryRun === true || args.mode === "dry_run",
      source: args.source || "Second MCP authorization proxy",
    };
    delete payload.payload;
    const base = Object.prototype.hasOwnProperty.call(options, "daemonUrl") ? options.daemonUrl : daemonUrl();
    const requestDaemon = options.daemonRequest || daemonRequest;
    let result;
    if (base) {
      try {
        result = await requestDaemon(base, "/api/authorize", payload);
      } catch (error) {
        result = authorizationTransportFailure(error);
      }
    } else {
      result = authorizeToolUse(payload, {
        appendAuthorizationAudit,
        appendDecisionLog,
        appendEvent,
        loadState,
        makeId,
        nowIso,
        saveState,
      });
    }
    return textContent(JSON.stringify(result, null, 2));
  }

  if (name === "authorized_http_request") {
    return textContent(JSON.stringify(await callAuthorizedHttpRequest(args, options), null, 2));
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function callAuthorizedHttpRequest(args = {}, options = {}) {
  const payload = {
    method: args.method || "GET",
    url: args.url,
    headers: args.headers || {},
    body: args.body,
    taskId: args.taskId,
    tool: "HTTP",
    source: args.source || "Second MCP authorized HTTP proxy",
  };
  const base = Object.prototype.hasOwnProperty.call(options, "daemonUrl") ? options.daemonUrl : daemonUrl();
  const requestDaemon = options.daemonRequest || daemonRequest;
  if (!base) return authorizationTransportFailure(new Error("SECOND_DAEMON is not configured"), payload.source);
  try {
    return await requestDaemon(base, "/api/proxy/http", payload);
  } catch (error) {
    if (error.response) return error.response;
    return authorizationTransportFailure(error, payload.source);
  }
}

function tryDaemonRequest(pathname, payload) {
  const base = daemonUrl();
  if (!base) return Promise.resolve(null);
  return daemonRequest(base, pathname, payload).catch(() => null);
}

function daemonUrl() {
  const raw = process.env.SECOND_DAEMON;
  if (!raw) return null;
  try {
    return new URL(raw.startsWith("http://") || raw.startsWith("https://") ? raw : `http://${raw}`);
  } catch {
    return null;
  }
}

function daemonRequest(base, pathname, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const req = http.request(
      {
        hostname: base.hostname,
        port: base.port || 80,
        path: pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = text.trim() ? JSON.parse(text) : {};
          } catch (error) {
            reject(error);
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const error = new Error(`${PRODUCT_NAME} daemon returned HTTP ${res.statusCode}: ${text}`);
            error.statusCode = res.statusCode;
            error.response = parsed;
            reject(error);
            return;
          }
          resolve(parsed);
        });
      },
    );
    req.setTimeout(5000, () => {
      req.destroy(new Error(`${PRODUCT_NAME} daemon request timed out`));
    });
    req.on("error", reject);
    req.end(body);
  });
}

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function textContent(text) {
  return {
    content: [{ type: "text", text }],
  };
}

function authorizationTransportFailure(error, source = "Second MCP authorization proxy") {
  return {
    ok: false,
    action: "deny",
    decision: "deny",
    risk: "高",
    reason: `${PRODUCT_NAME} MCP authorization request failed closed: ${error.message}`,
    ruleId: "deny.authorization_transport",
    source,
  };
}

module.exports = { TOOLS, callTool, serveMcp };
