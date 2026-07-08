"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT_DIR } = require("../state");

const CODEX_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "CODEX_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
];
const CODEX_AUTHORIZATION_TOOL_MATCHER = "Bash|apply_patch|Edit|Write|Read|Grep|Glob|WebFetch|HTTP";

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
      `SECOND_AUTH_PROXY = ${tomlString(authProxyAddress(state))}`,
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
              matcher: CODEX_AUTHORIZATION_TOOL_MATCHER,
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
              matcher: CODEX_AUTHORIZATION_TOOL_MATCHER,
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

function codexEnv(state, task, sourceEnv = process.env) {
  const env = {};
  for (const key of CODEX_ENV_ALLOWLIST) {
    if (sourceEnv[key] !== undefined) env[key] = sourceEnv[key];
  }
  return {
    ...env,
    NO_COLOR: "1",
    SECOND_ROOT: ROOT_DIR,
    SECOND_TASK_ID: task.id,
    SECOND_DAEMON: sourceEnv.SECOND_DAEMON || daemonAddress(state, sourceEnv),
    SECOND_AUTH_PROXY: sourceEnv.SECOND_AUTH_PROXY || authProxyAddress(state, sourceEnv),
  };
}

function daemonAddress(state = {}, sourceEnv = process.env) {
  return sourceEnv.SECOND_DAEMON || `localhost:${state.daemon?.port || sourceEnv.SECOND_PORT || 7317}`;
}

function authProxyAddress(state = {}, sourceEnv = process.env) {
  const daemon = daemonAddress(state, sourceEnv);
  const base = /^https?:\/\//i.test(daemon) ? daemon : `http://${daemon}`;
  return `${base.replace(/\/+$/, "")}/api/proxy/http`;
}

function tomlString(value) {
  return JSON.stringify(String(value || ""));
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

module.exports = {
  codexEnv,
  CODEX_ENV_ALLOWLIST,
  authProxyAddress,
  CODEX_AUTHORIZATION_TOOL_MATCHER,
  codexNetworkAccessEnabled,
  codexNetworkArgs,
  daemonAddress,
  prepareCodexRuntimeFiles,
};
