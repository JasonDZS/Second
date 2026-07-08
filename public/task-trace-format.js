(function initSecondTaskTraceFormat(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondTaskTraceFormat = api;
  if (typeof window === "object") window.SecondTaskTraceFormat = api;
  if (typeof globalThis === "object") globalThis.SecondTaskTraceFormat = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondTaskTraceFormat() {
  "use strict";

  function createTaskTraceFormat(options = {}) {
    const PRODUCT_NAME = options.PRODUCT_NAME || "Second";

    function sanitizeTraceText(text) {
      let value = String(text || "").trim();
      if (!value) return "";
      if (/^pid\s+\d+\s*·\s*workspace\b/i.test(value)) return "分身已接管任务。";
      if (/^pid\s+\d+\s*·\s*session\b/i.test(value)) return `${PRODUCT_NAME} 正在恢复同一会话。`;
      value = value.replace(/workspace:\s*\S+/gi, "").trim();
      value = value.replace(/\bpid\s+\d+\b/gi, "").trim();
      value = value.replace(/\bsession\s+[A-Za-z0-9][A-Za-z0-9._:-]*/gi, "同一会话").trim();
      value = value.replace(/\bsk-or-v1-[A-Za-z0-9_-]{8,}\b/g, "sk-or-v1-...已隐藏");
      value = value.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "sk-...已隐藏");
      value = value.replace(/(\bapi[_-]?key\b\s*[:=]\s*)[^\s,，。)]+/gi, "$1已隐藏");
      value = value.replace(/\/(?:Volumes|Users|private|tmp)\/[^\s,，。)]+/g, "本地运行目录");
      value = value.replace(/\s*·\s*$/g, "").replace(/^\s*·\s*/g, "").trim();
      return value;
    }

    function sanitizeTraceMeta(meta) {
      const value = String(meta || "").trim();
      if (!value) return "";
      if (/\b(codex\s+exec|workspace|pid|session)\b/i.test(value)) return "";
      return sanitizeTraceText(value);
    }

    function sanitizeAgentCardText(text) {
      let value = String(text || "").trim();
      if (!value) return "";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return "";
      if (/^codex\s+exec\b/i.test(value)) return "";
      value = value.replace(/("(?:thread_id|session_id|conversation_id|codexSessionId)"\s*:\s*")[^"]+(")/gi, "$1已隐藏$2");
      value = value.replace(/\b(?:session|thread|conversation)\s+[A-Za-z0-9][A-Za-z0-9._:-]{8,}/gi, "同一会话");
      value = value.replace(/\/(?:Volumes|Users|private|tmp)\/[^\s,，。)"]+/g, "本地运行目录");
      return value;
    }

    function sanitizeAgentCardMeta(meta) {
      const value = String(meta || "").trim();
      if (!value) return "";
      if (/\b(pid|workspace|session)\b/i.test(value)) return "";
      return value;
    }

    function appendText(current, next) {
      const left = String(current || "").trim();
      const right = String(next || "").trim();
      if (!left) return right;
      if (!right) return left;
      return `${left}\n${right}`;
    }

    return {
      appendText,
      sanitizeAgentCardMeta,
      sanitizeAgentCardText,
      sanitizeTraceMeta,
      sanitizeTraceText,
    };
  }

  return {
    createTaskTraceFormat,
  };
});
