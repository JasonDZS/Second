#!/usr/bin/env node
"use strict";

const path = require("path");

const secondRoot = process.env.SECOND_ROOT || path.resolve(__dirname, "../..");
const { handleHookInvocation } = require(path.join(secondRoot, "server", "policy"));

const eventName = process.argv[2] || process.env.SECOND_HOOK_EVENT || "PreToolUse";

readStdin()
  .then((text) => {
    const payload = parseJson(text);
    if (process.env.SECOND_TASK_ID && !payload.taskId && !payload.task_id && !payload.secondTaskId) {
      payload.secondTaskId = process.env.SECOND_TASK_ID;
    }
    if (process.env.SECOND_DAEMON && !payload.secondDaemon) {
      payload.secondDaemon = process.env.SECOND_DAEMON;
    }
    const result = handleHookInvocation(eventName, payload);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.action === "deny" || result.action === "human_gate") {
      process.stderr.write(`${result.instruction || result.reason}\n`);
      process.exit(2);
    }
  })
  .catch((error) => {
    process.stderr.write(`Second hook failed: ${error.message}\n`);
    process.exit(1);
  });

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
