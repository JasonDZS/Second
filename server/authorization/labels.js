"use strict";

const path = require("path");

const SECRET_PATH_PATTERNS = [
  /(^|[/\\])\.env(?:[.\w-]*)?$/i,
  /(^|[/\\])id_rsa(?:\.pub)?$/i,
  /(^|[/\\])id_dsa(?:\.pub)?$/i,
  /(^|[/\\])id_ed25519(?:\.pub)?$/i,
  /(^|[/\\])private[_-]?key(?:\.\w+)?$/i,
  /(^|[/\\])secret(s)?(?:[.\w-]*)?$/i,
  /(^|[/\\])token(?:[.\w-]*)?$/i,
];

const SELF_PROTECTION_PATTERNS = [
  /(^|[/\\])\.second[/\\]profile[/\\]AUTHORIZATION\.(?:md|ya?ml)$/i,
  /(^|[/\\])\.second[/\\]profile[/\\]DECISIONS\.log$/i,
  /(^|[/\\])\.second[/\\]profile[/\\]AUTHORIZATION_AUDIT\.log$/i,
  /(^|[/\\])trace(?:[/\\]|$)/i,
  /(^|[/\\])decision[_-]?log(?:[/\\]|$)/i,
];

function createLabelContext(input = {}) {
  const taskContext = input.task_ctx || input.taskContext || {};
  const runtimeContext = input.runtime_ctx || input.runtimeContext || {};
  const workspaceRoot =
    input.workspaceRoot ||
    input.workspace ||
    taskContext.workspace ||
    taskContext.workspaceRoot ||
    runtimeContext.workspace ||
    runtimeContext.cwd ||
    process.cwd();
  return {
    workspaceRoot: path.resolve(String(workspaceRoot || process.cwd())),
    sourceWorkspace: taskContext.sourceWorkspace || runtimeContext.sourceWorkspace || "",
  };
}

function classifyPath(filePath, context = {}) {
  const raw = String(filePath || "").trim();
  if (!raw) {
    return {
      type: "path",
      value: "",
      scope: "unknown",
      labels: ["unknown"],
    };
  }
  const workspaceRoot = path.resolve(context.workspaceRoot || process.cwd());
  const absolute = path.resolve(workspaceRoot, raw);
  const normalizedRaw = raw.replace(/\\/g, "/");
  const relative = safeRelative(workspaceRoot, absolute);
  const labels = [];
  let scope = relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? "workspace" : "external";

  if (SECRET_PATH_PATTERNS.some((pattern) => pattern.test(normalizedRaw) || pattern.test(absolute))) {
    labels.push("secret");
  }
  if (SELF_PROTECTION_PATTERNS.some((pattern) => pattern.test(normalizedRaw) || pattern.test(absolute))) {
    labels.push("self_protection");
    scope = "profile";
  }
  if (/\b(prod|production)\b/i.test(normalizedRaw)) labels.push("prod");
  if (/\b(staging|stage)\b/i.test(normalizedRaw)) labels.push("staging");
  if (raw.includes("..")) labels.push("path_traversal");

  return {
    type: "path",
    value: raw,
    absolute,
    relative: relative || raw,
    scope,
    labels,
  };
}

function environmentFromText(text) {
  if (/\b(prod|production|prd)\b/i.test(text)) return "prod";
  if (/\b(staging|stage|preprod)\b/i.test(text)) return "staging";
  if (/\b(dev|development|local|localhost|127\.0\.0\.1)\b/i.test(text)) return "dev";
  return "local";
}

function safeRelative(root, target) {
  try {
    return path.relative(root, target);
  } catch {
    return "";
  }
}

module.exports = {
  SECRET_PATH_PATTERNS,
  SELF_PROTECTION_PATTERNS,
  classifyPath,
  createLabelContext,
  environmentFromText,
};
