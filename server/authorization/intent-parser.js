"use strict";

const crypto = require("crypto");
const { classifyPath, createLabelContext, environmentFromText } = require("./labels");

const READ_COMMAND = /^(?:rg|grep|find|ls|cat|sed|awk|head|tail|pwd|git\s+(?:status|diff|log|show|branch|rev-parse|grep)|node\s+--check)\b/i;
const LOCAL_EXEC_COMMAND = /^(?:npm\s+(?:test|run\s+(?:check|test|lint|build|typecheck|format))|node\s+(?:scripts\/|test\/|server\/)|make\s+(?:test|check|lint|build)|go\s+test|cargo\s+test|uv\s+run|python3?\s+-m\s+(?:pytest|unittest))\b/i;
const WRITE_COMMAND = /^(?:touch|mkdir|cp|mv|chmod|perl\s+-pi|sed\s+-i)\b/i;
const PACKAGE_INSTALL_COMMAND = /\b(?:npm|pnpm|yarn|bun|pip|uv|gem|cargo|brew|apt(?:-get)?|yum|dnf)\s+(?:install|add|update|upgrade)\b/i;
const DEPLOY_COMMAND = /\b(?:deploy|deployment|kubectl|helm|terraform|pulumi|serverless|flyctl|vercel|netlify)\b/i;
const PUSH_COMMAND = /\b(?:git\s+push|gh\s+pr\s+merge|gh\s+release|npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish)\b/i;
const DATABASE_WRITE_COMMAND = /\b(?:psql|mysql|redis-cli)\b[\s\S]*\b(?:update|delete|insert|alter|drop|truncate|create|grant|revoke)\b/i;
const COMMUNICATE_COMMAND = /\b(?:gh\s+(?:issue|pr)\s+comment|gh\s+pr\s+review|slack\s+send|sendmail|mailx|curl\b[\s\S]*(?:-X\s*POST|--request\s+POST|--data|-d\s+|webhook|hooks\.slack|api\.slack))\b/i;
const IRREVERSIBLE_DELETE_COMMAND = /\brm\s+-(?:[a-z]*f[a-z]*r|[a-z]*r[a-z]*f)\s+(?:\/|~|"\/*"|'\/\*'|\$HOME)(?:\s|$)/i;
const SELF_PROTECTION_COMMAND = /\b(?:disable|bypass|turn\s+off)\b[\s\S]*\b(?:second|human\s+gate|authorization|policy|hook)\b/i;
const SHELL_WRAPPER = /^(?:sh|bash|zsh)\s+-[lc]{1,2}\s+(.+)$/i;

function parseAuthorizationIntent(payload = {}) {
  const context = createLabelContext(payload);
  const toolName = toolNameFromPayload(payload);
  const text = payloadText(payload);
  let intent;
  if (/^(?:bash|shell|terminal)$/i.test(toolName) || payload.command || payload.args?.command) {
    intent = parseBashCommand(payload.command || payload.args?.command || text, context);
  } else if (/^(?:http|fetch|network|web_request)$/i.test(toolName) || payload.url || payload.args?.url) {
    intent = parseHttpRequest(payload, toolName, text);
  } else if (/^(?:edit|write|apply_patch|applypatch)$/i.test(toolName)) {
    intent = parseFileTool(payload, context, toolName);
  } else if (/slack|email|teams|message|reply/i.test(toolName)) {
    intent = baseIntent({
      action: "communicate",
      target: { type: "service", value: toolName, scope: "external", labels: ["external"] },
      environment: "external",
      reversibility: "hard_to_reverse",
      identity: "user_named",
      labels: ["external"],
      toolName,
      text,
    });
  } else {
    intent = baseIntent({
      action: "unknown",
      target: { type: "tool", value: toolName, scope: "unknown", labels: ["unknown"] },
      environment: "unknown",
      reversibility: "unknown",
      identity: "unknown",
      labels: ["unknown"],
      toolName,
      text,
    });
  }
  intent.fingerprint = fingerprintIntent(intent);
  return intent;
}

function parseHttpRequest(payload, toolName, text) {
  const method = String(payload.method || payload.args?.method || "GET").toUpperCase();
  const rawUrl = String(payload.url || payload.args?.url || "").trim();
  const target = httpTarget(rawUrl);
  let action = "unknown";
  let reversibility = "unknown";
  let identity = "agent";
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    action = "read";
    reversibility = "reversible";
  } else if (method === "POST" && target.scope === "external") {
    action = "communicate";
    reversibility = "hard_to_reverse";
    identity = "user_named";
  } else if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    action = "write";
    reversibility = "hard_to_reverse";
  }
  return baseIntent({
    action,
    target,
    environment: target.environment,
    reversibility,
    identity,
    labels: target.labels,
    riskTags: target.riskTags,
    toolName,
    text: rawUrl || text,
  });
}

function httpTarget(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    const environment = local ? "dev" : environmentFromText(rawUrl) === "local" ? "external" : environmentFromText(rawUrl);
    return {
      type: "domain",
      value: hostname,
      scope: local ? "local" : "external",
      labels: local ? ["local"] : ["external"],
      riskTags: [],
      environment,
    };
  } catch {
    return {
      type: "domain",
      value: rawUrl,
      scope: "unknown",
      labels: ["unknown"],
      riskTags: [],
      environment: "unknown",
    };
  }
}

function parseBashCommand(command, context) {
  const raw = String(command || "").trim();
  const unwrapped = unwrapShell(raw);
  const lower = unwrapped.toLowerCase();
  const pathTargets = extractLikelyPaths(unwrapped).map((item) => classifyPath(item, context));
  const labels = new Set(pathTargets.flatMap((target) => target.labels || []));
  const riskTags = new Set();
  let action = "unknown";
  let target = pathTargets[0] || { type: "command", value: firstToken(unwrapped), scope: "workspace", labels: [] };
  let reversibility = "unknown";
  let identity = "agent";
  let environment = environmentFromText(unwrapped);

  if (/\b(?:cat|less|more|head|tail|grep|rg|sed|awk)\b/i.test(unwrapped) && labels.has("secret")) {
    riskTags.add("expose_credentials");
  }
  if (labels.has("self_protection") && isMutationCommand(unwrapped)) {
    riskTags.add("self_protection");
  }
  if (SELF_PROTECTION_COMMAND.test(unwrapped)) {
    riskTags.add("bypass_gate");
  }
  if (IRREVERSIBLE_DELETE_COMMAND.test(unwrapped)) {
    riskTags.add("irreversible_delete");
  }

  if (DATABASE_WRITE_COMMAND.test(unwrapped)) {
    action = "write";
    target = { type: "database", value: databaseTarget(unwrapped), scope: environment, labels: [environment] };
    reversibility = "hard_to_reverse";
  } else if (PUSH_COMMAND.test(unwrapped)) {
    action = "push";
    target = { type: "git", value: pushTarget(unwrapped), scope: "shared_branches", labels: ["shared_branches"] };
    reversibility = "hard_to_reverse";
  } else if (DEPLOY_COMMAND.test(unwrapped)) {
    action = "deploy";
    target = { type: "service", value: firstToken(unwrapped), scope: environment === "local" ? "unknown" : environment, labels: [environment] };
    reversibility = "hard_to_reverse";
  } else if (PACKAGE_INSTALL_COMMAND.test(unwrapped)) {
    action = "install_package";
    target = { type: "environment", value: firstToken(unwrapped), scope: "workspace", labels: ["environment"] };
    reversibility = "hard_to_reverse";
  } else if (COMMUNICATE_COMMAND.test(unwrapped)) {
    action = "communicate";
    target = { type: "recipient", value: communicationTarget(unwrapped), scope: "external", labels: ["external"] };
    environment = "external";
    reversibility = "hard_to_reverse";
    identity = "user_named";
  } else if (WRITE_COMMAND.test(lower)) {
    action = "write";
    target = pathTargets[0] || { type: "workspace", value: context.workspaceRoot, scope: "workspace", labels: [] };
    reversibility = target.scope === "workspace" ? "reversible" : "hard_to_reverse";
  } else if (READ_COMMAND.test(lower)) {
    action = "read";
    target = pathTargets[0] || { type: "workspace", value: context.workspaceRoot, scope: "workspace", labels: [] };
    reversibility = "reversible";
  } else if (LOCAL_EXEC_COMMAND.test(lower)) {
    action = "exec";
    target = { type: "workspace", value: context.workspaceRoot, scope: "workspace", labels: [] };
    reversibility = "reversible";
  }

  if (environment === "prod" || environment === "staging") labels.add(environment);
  if (target.labels) for (const label of target.labels) labels.add(label);

  return baseIntent({
    action,
    target,
    environment,
    reversibility,
    identity,
    labels: [...labels],
    riskTags: [...riskTags],
    toolName: "Bash",
    text: raw,
  });
}

function parseFileTool(payload, context, toolName) {
  const text = payloadText(payload);
  const candidatePath =
    payload.path ||
    payload.file_path ||
    payload.filePath ||
    payload.args?.path ||
    payload.args?.file_path ||
    payload.args?.filePath ||
    patchPath(text) ||
    "";
  const target = classifyPath(candidatePath, context);
  const riskTags = [];
  if (target.labels.includes("secret")) riskTags.push("expose_credentials");
  if (target.labels.includes("self_protection")) riskTags.push("self_protection");
  return baseIntent({
    action: candidatePath ? "write" : "unknown",
    target,
    environment: environmentFromText(candidatePath || text),
    reversibility: target.scope === "workspace" ? "reversible" : "hard_to_reverse",
    identity: "agent",
    labels: target.labels,
    riskTags,
    toolName,
    text,
  });
}

function baseIntent(intent) {
  return {
    action: intent.action || "unknown",
    target: intent.target || { type: "unknown", value: "", scope: "unknown", labels: ["unknown"] },
    environment: intent.environment || "unknown",
    reversibility: intent.reversibility || "unknown",
    identity: intent.identity || "unknown",
    labels: unique(intent.labels || []),
    riskTags: unique(intent.riskTags || []),
    toolName: intent.toolName || "unknown",
    text: intent.text || "",
  };
}

function fingerprintIntent(intent = {}) {
  const canonical = {
    action: intent.action,
    target: {
      type: intent.target?.type || "unknown",
      value: normalizeFingerprintValue(intent.target?.value || ""),
      scope: intent.target?.scope || "unknown",
    },
    environment: intent.environment,
    reversibility: intent.reversibility,
    identity: intent.identity,
    riskTags: unique(intent.riskTags || []).sort(),
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 20);
}

function unwrapShell(command) {
  const match = String(command || "").trim().match(SHELL_WRAPPER);
  if (!match) return String(command || "").trim();
  return stripQuotes(match[1].trim());
}

function extractLikelyPaths(command) {
  const out = [];
  for (const token of splitShellLike(command)) {
    const clean = stripQuotes(token);
    if (!clean || clean.startsWith("-")) continue;
    if (
      clean.includes("/") ||
      clean.startsWith(".") ||
      /\.(?:js|ts|json|md|txt|ya?ml|toml|env|log|sql|py|go|rs|sh|pem|key)$/i.test(clean)
    ) {
      out.push(clean);
    }
  }
  return out;
}

function splitShellLike(command) {
  return String(command || "").match(/"[^"]*"|'[^']*'|[^\s]+/g) || [];
}

function isMutationCommand(command) {
  return /\b(?:rm|mv|cp|touch|mkdir|chmod|chown|sed\s+-i|perl\s+-pi|tee|>|>>|cat\s+>|apply_patch)\b/i.test(command);
}

function patchPath(text) {
  const match = String(text || "").match(/^\s*(?:\*\*\* Update File:|\+\+\+ b\/|--- a\/)\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function databaseTarget(command) {
  const prod = command.match(/\b(?:prod|production|staging|stage)[\w.-]*/i);
  return prod ? prod[0] : "database";
}

function pushTarget(command) {
  if (/\bgh\s+pr\s+merge\b/i.test(command)) return "pull_request";
  if (/\bgh\s+release\b/i.test(command)) return "release";
  if (/\bnpm\s+publish\b/i.test(command)) return "package";
  const branch = command.match(/\b(?:main|master|release\/[^\s]+|prod(?:uction)?|staging)\b/i);
  return branch ? branch[0] : "shared_branch";
}

function communicationTarget(command) {
  const url = command.match(/https?:\/\/[^\s"']+/i);
  if (url) return url[0];
  const channel = command.match(/#[\w-]+/);
  if (channel) return channel[0];
  return "external";
}

function firstToken(command) {
  return splitShellLike(command)[0] || "command";
}

function stripQuotes(value) {
  const text = String(value || "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function normalizeFingerprintValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/["']/g, "")
    .trim()
    .slice(0, 240);
}

function toolNameFromPayload(payload = {}) {
  return payload.tool_name || payload.toolName || payload.name || payload.tool || payload.type || "unknown";
}

function payloadText(payload) {
  const pieces = [];
  collectText(payload, pieces);
  return pieces.join("\n");
}

function collectText(value, out) {
  if (value == null) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectText(child, out);
    return;
  }
  if (typeof value === "object") {
    for (const child of Object.values(value)) collectText(child, out);
  }
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

module.exports = {
  fingerprintIntent,
  parseAuthorizationIntent,
  payloadText,
  toolNameFromPayload,
};
