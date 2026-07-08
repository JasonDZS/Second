"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT_DIR } = require("../state");

function prepareCodexRuntimeFiles(task, state = {}) {
  const codexDir = path.join(task.workspace, ".codex");
  const hooksDir = path.join(codexDir, "hooks");
  const rulesDir = path.join(codexDir, "rules");
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(rulesDir, { recursive: true });

  const hookSource = path.join(ROOT_DIR, ".codex", "hooks", "second_policy_hook.js");
  const hookTarget = path.join(hooksDir, "second_policy_hook.js");
  if (fs.existsSync(hookSource)) fs.copyFileSync(hookSource, hookTarget);

  const rulesSource = path.join(ROOT_DIR, ".codex", "rules", "second.rules");
  const rulesTarget = path.join(rulesDir, "second.rules");
  if (fs.existsSync(rulesSource)) fs.copyFileSync(rulesSource, rulesTarget);

  const daemon = daemonAddress(state);
  const sandboxLines = codexNetworkAccessEnabled(state)
    ? ["", "[sandbox_workspace_write]", "network_access = true"]
    : [];
  fs.writeFileSync(
    path.join(codexDir, "config.toml"),
    [
      "[features]",
      "hooks = true",
      "rules = true",
      ...sandboxLines,
      "",
      "[mcp_servers.second-decision]",
      'command = "node"',
      `args = [${tomlString(path.join(ROOT_DIR, "bin", "second.js"))}, "mcp", "serve"]`,
      "",
      "[mcp_servers.second-decision.env]",
      `SECOND_DAEMON = ${tomlString(daemon)}`,
      `SECOND_ROOT = ${tomlString(ROOT_DIR)}`,
      "",
      "[mcp_servers.second-decision.tools.decision_request]",
      'approval_mode = "approve"',
      "",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(codexDir, "hooks.json"),
    `${JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash|apply_patch|Edit|Write",
              hooks: [
                {
                  type: "command",
                  command: `node ${JSON.stringify(hookTarget)} PreToolUse`,
                  timeout: 30,
                  statusMessage: "Second Human Gate policy check",
                },
              ],
            },
          ],
          PermissionRequest: [
            {
              matcher: "Bash|apply_patch|Edit|Write",
              hooks: [
                {
                  type: "command",
                  command: `node ${JSON.stringify(hookTarget)} PermissionRequest`,
                  timeout: 30,
                  statusMessage: "Second approval policy check",
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );

  return {
    configFile: path.join(codexDir, "config.toml"),
    hooksFile: path.join(codexDir, "hooks.json"),
    hookFile: hookTarget,
  };
}

function codexNetworkAccessEnabled(state = {}) {
  const envValue = process.env.SECOND_CODEX_NETWORK_ACCESS || process.env.CODEX_NETWORK_ACCESS;
  if (envValue !== undefined) return isTruthy(envValue);
  return Boolean(state.settings?.codexNetworkAccess);
}

function codexNetworkArgs(state = {}) {
  return codexNetworkAccessEnabled(state) ? ["-c", "sandbox_workspace_write.network_access=true"] : [];
}

function codexEnv(state, task) {
  return {
    ...process.env,
    NO_COLOR: "1",
    SECOND_ROOT: ROOT_DIR,
    SECOND_TASK_ID: task.id,
    SECOND_DAEMON: process.env.SECOND_DAEMON || daemonAddress(state),
  };
}

function daemonAddress(state = {}) {
  return process.env.SECOND_DAEMON || `localhost:${state.daemon?.port || process.env.SECOND_PORT || 7317}`;
}

function tomlString(value) {
  return JSON.stringify(String(value || ""));
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

module.exports = {
  codexEnv,
  codexNetworkAccessEnabled,
  codexNetworkArgs,
  daemonAddress,
  prepareCodexRuntimeFiles,
};
