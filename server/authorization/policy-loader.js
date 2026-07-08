"use strict";

const fs = require("fs");
const { AUTHORIZATION_FILE, AUTHORIZATION_YAML_FILE, ensureProfileFiles } = require("../state");

const DEFAULT_POLICY = Object.freeze({
  version: 1,
  defaults: {
    unknown_action: "gate",
  },
  deny: [
    {
      id: "deny.expose_credentials",
      risk_tag: "expose_credentials",
      reason: "Reading, writing, or sending secrets is never allowed.",
    },
    {
      id: "deny.self_protection",
      risk_tag: "self_protection",
      reason: "Agents may not modify Second authorization, trace, or decision logs.",
    },
    {
      id: "deny.irreversible_delete",
      risk_tag: "irreversible_delete",
      reason: "Irreversible destructive operations are outside delegated authority.",
    },
    {
      id: "deny.bypass_gate",
      risk_tag: "bypass_gate",
      reason: "Agents may not disable or bypass Second Human Gate enforcement.",
    },
  ],
  gate: [
    {
      id: "gate.push_shared",
      action: "push",
      target: "shared_branches",
      granularity: ["once", "plan"],
      reason: "Mutating shared git state requires Human Gate.",
    },
    {
      id: "gate.deploy",
      action: "deploy",
      granularity: ["once", "plan"],
      reason: "Deployments and infrastructure changes require Human Gate.",
    },
    {
      id: "gate.prod_write",
      action: "write",
      env: ["prod", "staging"],
      granularity: ["once"],
      reason: "Staging or production writes require Human Gate.",
    },
    {
      id: "gate.install_package",
      action: "install_package",
      granularity: ["once", "plan"],
      reason: "Installing packages changes the execution environment.",
    },
    {
      id: "gate.communicate",
      action: "communicate",
      granularity: ["once", "plan", "session"],
      reason: "External communication in the user's name requires Human Gate.",
    },
    {
      id: "gate.external_request",
      action: "read",
      target: "external",
      granularity: ["once", "session"],
      reason: "External network requests must go through Human Gate or an approved proxy grant.",
    },
    {
      id: "gate.system_change",
      action: "system_change",
      granularity: ["once"],
      reason: "System changes require Human Gate.",
    },
    {
      id: "gate.unknown",
      action: "unknown",
      granularity: ["once"],
      reason: "Unknown actions fail closed into Human Gate.",
    },
  ],
  green: [
    {
      id: "allow.read_workspace",
      action: "read",
      scope: "workspace",
      reason: "Workspace-local reads are allowed and audited.",
    },
    {
      id: "allow.write_workspace",
      action: "write",
      scope: "workspace",
      reason: "Workspace-local writes are allowed and audited.",
    },
    {
      id: "allow.exec_workspace",
      action: "exec",
      scope: "workspace",
      reason: "Workspace-local commands are allowed and audited.",
    },
  ],
});

function loadAuthorizationPolicy(options = {}) {
  const policyFile = options.policyFile || AUTHORIZATION_YAML_FILE;
  const allowMissing = options.allowMissing !== false;
  if (policyFile === AUTHORIZATION_YAML_FILE) ensureProfileFiles();
  if (!fs.existsSync(policyFile)) {
    if (!allowMissing) return failClosed(`Authorization policy file not found: ${policyFile}`);
    return { policy: clonePolicy(DEFAULT_POLICY), source: "default", failedClosed: false };
  }
  try {
    const text = fs.readFileSync(policyFile, "utf8");
    const parsed = mergeDefaultRules(parsePolicyText(text));
    validatePolicy(parsed);
    return { policy: parsed, source: policyFile, failedClosed: false };
  } catch (error) {
    return failClosed(error.message, policyFile);
  }
}

function saveAuthorizationPolicy(policy, options = {}) {
  validatePolicy(policy);
  const policyFile = options.policyFile || AUTHORIZATION_YAML_FILE;
  fs.writeFileSync(policyFile, serializePolicy(policy));
  return { policy, source: policyFile };
}

function addGreenAuthorizationRule(rule, options = {}) {
  const loaded = loadAuthorizationPolicy(options);
  if (loaded.failedClosed) throw new Error(loaded.error || "Authorization policy failed closed");
  const policy = loaded.policy;
  const exists = (policy.green || []).some((item) => item.id === rule.id);
  if (!exists) policy.green.push(rule);
  const saved = saveAuthorizationPolicy(policy, { policyFile: options.policyFile || loaded.source });
  if (!exists) appendAuthorizationRuleProjection(rule, options);
  return { ...saved, changed: !exists };
}

function mergeDefaultRules(policy = {}) {
  const merged = {
    ...clonePolicy(DEFAULT_POLICY),
    ...policy,
    defaults: { ...DEFAULT_POLICY.defaults, ...(policy.defaults || {}) },
  };
  for (const section of ["deny", "gate", "green"]) {
    const current = Array.isArray(policy[section]) ? policy[section] : [];
    const ids = new Set(current.map((rule) => rule.id));
    merged[section] = [
      ...current,
      ...DEFAULT_POLICY[section].filter((rule) => !ids.has(rule.id)).map((rule) => ({ ...rule })),
    ];
  }
  return merged;
}

function appendAuthorizationRuleProjection(rule, options = {}) {
  const summaryFile = options.summaryFile || AUTHORIZATION_FILE;
  if (summaryFile === AUTHORIZATION_FILE) ensureProfileFiles();
  const current = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, "utf8") : "# Second Authorization\n";
  const markerStart = "<!-- second-authorization-generated-rules -->";
  const markerEnd = "<!-- /second-authorization-generated-rules -->";
  if (current.includes(`\`${rule.id}\``)) return { summaryFile, changed: false };
  const line = authorizationRuleProjectionLine(rule, options.candidate);
  let next;
  if (current.includes(markerStart) && current.includes(markerEnd)) {
    next = current.replace(markerEnd, `${line}\n${markerEnd}`);
  } else {
    const prefix = current.endsWith("\n") ? current : `${current}\n`;
    next = [
      prefix,
      "## Learned Authorization Rules",
      "",
      markerStart,
      line,
      markerEnd,
      "",
    ].join("\n");
  }
  fs.writeFileSync(summaryFile, next);
  return { summaryFile, changed: true };
}

function authorizationRuleProjectionLine(rule = {}, candidate = {}) {
  const bits = [
    `action=${rule.action || "unknown"}`,
    rule.scope ? `scope=${rule.scope}` : "",
    rule.target ? `target=${rule.target}` : "",
    rule.env ? `env=${Array.isArray(rule.env) ? rule.env.join(",") : rule.env}` : "",
    candidate?.id ? `lineage=${candidate.id}` : "",
  ].filter(Boolean);
  return `- \`${rule.id || "authorization.rule"}\`: allow ${bits.join(" · ")}.`;
}

function failClosed(message, source = "policy-loader") {
  return {
    policy: {
      version: 1,
      defaults: { unknown_action: "deny" },
      deny: [
        {
          id: "deny.policy_unavailable",
          risk_tag: "policy_unavailable",
          reason: `Authorization policy failed closed: ${message}`,
        },
      ],
      gate: [],
      green: [],
    },
    source,
    failedClosed: true,
    error: message,
  };
}

function parsePolicyText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Authorization policy is empty");
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);

  const policy = {};
  let section = null;
  let currentItem = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const withoutComment = stripComment(rawLine);
    if (!withoutComment.trim()) continue;
    const indent = withoutComment.match(/^ */)[0].length;
    const line = withoutComment.trim();
    if (indent === 0) {
      const pair = parsePair(line);
      if (!pair) throw new Error(`Unsupported authorization policy line: ${line}`);
      const [key, value] = pair;
      if (value === "") {
        section = key;
        currentItem = null;
        policy[key] = key === "defaults" ? {} : [];
      } else {
        policy[key] = parseScalar(value);
        section = null;
        currentItem = null;
      }
      continue;
    }
    if (!section) throw new Error(`Authorization policy field outside section: ${line}`);
    if (section === "defaults") {
      const pair = parsePair(line);
      if (!pair) throw new Error(`Unsupported defaults line: ${line}`);
      policy.defaults[pair[0]] = parseScalar(pair[1]);
      continue;
    }
    if (!Array.isArray(policy[section])) throw new Error(`Unsupported authorization policy section: ${section}`);
    if (line.startsWith("- ")) {
      currentItem = {};
      policy[section].push(currentItem);
      const rest = line.slice(2).trim();
      if (rest) {
        const pair = parsePair(rest);
        if (!pair) throw new Error(`Unsupported rule item line: ${line}`);
        currentItem[pair[0]] = parseScalar(pair[1]);
      }
      continue;
    }
    if (!currentItem) throw new Error(`Rule property without rule item: ${line}`);
    const pair = parsePair(line);
    if (!pair) throw new Error(`Unsupported rule property line: ${line}`);
    currentItem[pair[0]] = parseScalar(pair[1]);
  }
  return policy;
}

function stripComment(line) {
  let quote = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? "" : quote || char;
    }
    if (char === "#" && !quote) return line.slice(0, index);
  }
  return line;
}

function parsePair(line) {
  const index = line.indexOf(":");
  if (index === -1) return null;
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}

function parseScalar(value) {
  const trimmed = String(value || "").trim();
  if (trimmed === "") return "";
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((part) => parseScalar(part.trim()));
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function validatePolicy(policy = {}) {
  if (policy.version !== 1) throw new Error(`Unsupported authorization policy version: ${policy.version}`);
  if (!policy.defaults || !["gate", "deny"].includes(policy.defaults.unknown_action)) {
    throw new Error("Authorization policy defaults.unknown_action must be gate or deny");
  }
  for (const key of ["deny", "gate", "green"]) {
    if (!Array.isArray(policy[key])) throw new Error(`Authorization policy ${key} must be a list`);
    for (const rule of policy[key]) {
      if (!rule.id) throw new Error(`Authorization ${key} rule is missing id`);
      if (!rule.action && !rule.risk_tag) throw new Error(`Authorization rule ${rule.id} is missing action or risk_tag`);
    }
  }
}

function serializePolicy(policy = {}) {
  return `${[
    "version: 1",
    "defaults:",
    `  unknown_action: ${policy.defaults?.unknown_action || "gate"}`,
    ...serializeRules("deny", policy.deny || []),
    ...serializeRules("gate", policy.gate || []),
    ...serializeRules("green", policy.green || []),
    "",
  ].join("\n")}\n`;
}

function serializeRules(name, rules) {
  const lines = [name + ":"];
  for (const rule of rules || []) {
    lines.push(`  - id: ${yamlScalar(rule.id)}`);
    for (const [key, value] of Object.entries(rule)) {
      if (key === "id" || value == null || value === "") continue;
      lines.push(`    ${key}: ${yamlValue(value)}`);
    }
  }
  return lines;
}

function yamlValue(value) {
  if (Array.isArray(value)) return `[${value.map(yamlScalar).join(", ")}]`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return yamlScalar(value);
}

function yamlScalar(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_.-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function clonePolicy(policy) {
  return JSON.parse(JSON.stringify(policy));
}

module.exports = {
  DEFAULT_POLICY,
  addGreenAuthorizationRule,
  appendAuthorizationRuleProjection,
  authorizationRuleProjectionLine,
  loadAuthorizationPolicy,
  mergeDefaultRules,
  parsePolicyText,
  saveAuthorizationPolicy,
  serializePolicy,
  validatePolicy,
};
