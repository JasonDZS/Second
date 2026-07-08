#!/usr/bin/env node
"use strict";

const http = require("http");

const eventName = process.argv[2] || process.env.SECOND_HOOK_EVENT || "PreToolUse";

if (require.main === module) {
  main().catch((error) => {
    const result = {
      ok: false,
      action: "deny",
      reason: `Second authorization failed closed: ${error.message}`,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.stderr.write(`${result.reason}\n`);
    process.exit(2);
  });
}

async function main() {
  const payload = parseJson(await readStdin());
  if (process.env.SECOND_TASK_ID && !payload.taskId && !payload.task_id && !payload.secondTaskId) {
    payload.secondTaskId = process.env.SECOND_TASK_ID;
  }
  if (process.env.SECOND_DAEMON && !payload.secondDaemon) {
    payload.secondDaemon = process.env.SECOND_DAEMON;
  }
  payload.eventName = eventName;
  const result = await authorizeWithDaemon(payload);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  const exitCode = exitCodeForAuthorizationResult(result);
  if (exitCode !== 0) {
    process.stderr.write(`${result.instruction || result.reason}\n`);
    process.exit(exitCode);
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      body += chunk;
    });
    process.stdin.on("end", () => resolve(body));
    process.stdin.on("error", reject);
  });
}

function parseJson(text) {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function authorizeWithDaemon(payload) {
  const daemon = process.env.SECOND_DAEMON || payload.secondDaemon;
  if (!daemon) throw new Error("SECOND_DAEMON is not configured");
  const url = daemonUrl(daemon);
  const body = JSON.stringify({
    ...payload,
    dryRun: false,
    mode: "enforce",
  });
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 5000,
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = responseBody.trim() ? JSON.parse(responseBody) : {};
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error(parsed.error || `daemon returned ${res.statusCode}`));
              return;
            }
            if (!["allow", "gate", "deny", "human_gate"].includes(parsed.action)) {
              reject(new Error("daemon authorization response did not include a valid action"));
              return;
            }
            resolve(parsed);
          } catch (error) {
            reject(new Error(`daemon returned invalid JSON: ${error.message}`));
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("daemon authorization timed out"));
    });
    req.on("error", reject);
    req.end(body);
  });
}

function daemonUrl(value) {
  const text = String(value || "").trim();
  const base = /^https?:\/\//i.test(text) ? text : `http://${text}`;
  return new URL("/api/authorize", base);
}

function exitCodeForAuthorizationResult(result = {}) {
  return ["deny", "gate", "human_gate"].includes(result.action) ? 2 : 0;
}

module.exports = {
  daemonUrl,
  exitCodeForAuthorizationResult,
  parseJson,
};
