"use strict";

const SECRET_PATTERNS = [
  [/\bsk-or-v1-[A-Za-z0-9_-]{8,}\b/g, "sk-or-v1-...redacted"],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "sk-...redacted"],
  [/\b(xoxb|xapp|xoxp)-[A-Za-z0-9-]{10,}\b/g, "$1-...redacted"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}/gi, "$1...redacted"],
  [/(\b(?:api[_-]?key|token|secret|password|passwd|pwd)\b\s*[:=]\s*)[^\s,，。)'"]+/gi, "$1redacted"],
];

function redactAuthorizationText(value) {
  let text = String(value ?? "");
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function redactAuthorizationValue(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === "string") return redactAuthorizationText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => redactAuthorizationValue(item, seen));
  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = redactAuthorizationValue(child, seen);
    }
    return out;
  }
  return value;
}

module.exports = {
  redactAuthorizationText,
  redactAuthorizationValue,
};
