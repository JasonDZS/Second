(function initSecondPresentation(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondPresentation = api;
  if (typeof window === "object") window.SecondPresentation = api;
  if (typeof globalThis === "object") globalThis.SecondPresentation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondPresentation(root) {
  "use strict";

  function decisionStatus(decision = {}) {
    if (decision.status === "pending") return { label: "待你决策", color: "#C4520E" };
    if (decision.status === "approved") return { label: "已批准 · 任务已恢复", color: "#067647" };
    if (decision.status === "rejected") return { label: "已拒绝", color: "#98937F" };
    return { label: "已处理 · 已恢复", color: "#98937F" };
  }

  function taskStatus(task = {}) {
    const map = {
      pending: { label: "待派发", cls: "kind-amber" },
      running: { label: "执行中", cls: "kind-blue" },
      needs_human: { label: "等待决策", cls: "risk-mid" },
      pending_resume: { label: "等待恢复", cls: "kind-amber" },
      resuming: { label: "恢复中", cls: "kind-blue" },
      paused: { label: "已挂起", cls: "kind-amber" },
      stopped: { label: "已停止", cls: "risk-high" },
      failed: { label: "失败", cls: "risk-high" },
      done: { label: "已完成", cls: "risk-low" },
    };
    return map[task.status] || { label: task.status || "未知", cls: "kind-amber" };
  }

  function engineStatus(status) {
    const map = {
      ok: { label: "可用", cls: "risk-low" },
      missing: { label: "未安装", cls: "kind-amber" },
      error: { label: "不可用", cls: "risk-high" },
      not_configured: { label: "未配置", cls: "kind-amber" },
      unknown: { label: "待检测", cls: "kind-amber" },
    };
    return map[status] || map.unknown;
  }

  function riskClass(risk) {
    if (risk === "高") return "risk-high";
    if (risk === "中") return "risk-mid";
    return "risk-low";
  }

  function actorStyle(kind) {
    const map = {
      entry: { label: "入口", color: "#3B5BDB", bg: "#E7ECFB" },
      agent: { label: "分身", color: "#C4520E", bg: "#FBEADD" },
      runtime: { label: "Runtime", color: "#5E5A4E", bg: "#EDE9DF" },
      gate: { label: "Human Gate", color: "#B42318", bg: "#FEE4E2" },
      decision: { label: "决策", color: "#8B6A14", bg: "#FBF0CE" },
      out: { label: "回传", color: "#067647", bg: "#DCFAE6" },
      learn: { label: "沉淀", color: "#6941C6", bg: "#EFEAFB" },
    };
    return map[kind] || map.runtime;
  }

  function eventKindClass(kind) {
    if (kind === "gate") return "risk-high";
    if (kind === "decision") return "risk-mid";
    if (kind === "out") return "risk-low";
    if (kind === "entry") return "kind-blue";
    return "tag";
  }

  function eventColor(type) {
    if (/failed|block|stop|reject/.test(type)) return "#F5B097";
    if (/done|approved|resume/.test(type)) return "#7EE2A8";
    if (/start|detect|created/.test(type)) return "#E9E4DA";
    return "#9B9584";
  }

  function shortKind(kind) {
    const map = {
      entry: "入口",
      agent: "分身",
      runtime: "工具",
      gate: "拦截",
      decision: "决策",
      out: "回传",
      learn: "沉淀",
    };
    return map[kind] || "事件";
  }

  function normalizeExec(exec) {
    if (!Array.isArray(exec)) return [];
    return exec.map((item) => {
      if (Array.isArray(item)) return { time: item[0] || "", tool: item[1] || "STEP", text: item[2] || "" };
      return { time: item.time || item.t || "", tool: item.tool || "STEP", text: item.text || "" };
    });
  }

  function toolColor(tool) {
    const map = {
      PLAN: "#C9B8E8",
      READ: "#8AB4F8",
      GREP: "#8AB4F8",
      EDIT: "#F0B37E",
      WRITE: "#F0B37E",
      BASH: "#A8D08D",
      TEST: "#A8D08D",
      GATE: "#F49B8F",
      RESUME: "#7FD0C0",
    };
    return map[tool] || "#B9B29F";
  }

  function engineColor(id) {
    const map = {
      codex: { bg: "#E7ECFB", color: "#3B5BDB" },
      "claude-code": { bg: "#FBEADD", color: "#C4520E" },
      openclaw: { bg: "#EAF7EE", color: "#067647" },
      slack: { bg: "#EFEAFB", color: "#6941C6" },
      discord: { bg: "#E8ECFF", color: "#5865F2" },
      telegram: { bg: "#E5F4FF", color: "#168ACD" },
      whatsapp: { bg: "#E6F7EC", color: "#128C7E" },
      linear: { bg: "#E7ECFB", color: "#3B5BDB" },
      clickup: { bg: "#FBEADD", color: "#C4520E" },
      feishu: { bg: "#E8F1FF", color: "#3370FF" },
      dingding: { bg: "#EAF3FF", color: "#0B7CFF" },
    };
    return map[id] || { bg: "#EDE9DF", color: "#6E6858" };
  }

  function relativeTime(iso) {
    if (!iso) return "未知";
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return iso;
    const diff = Date.now() - t;
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return `${Math.floor(diff / 86_400_000)} 天前`;
  }

  function uptime(iso) {
    if (!iso) return "0m";
    const diff = Math.max(0, Date.now() - Date.parse(iso));
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function shortPath(value) {
    if (!value) return "";
    const text = String(value);
    const idx = text.indexOf(".second/");
    if (idx !== -1) return text.slice(idx);
    return text.replace(/^\/Volumes\/Samsung_T5\/project\/Second\/?/, "");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function cssEscape(value) {
    const css = root?.CSS || root?.window?.CSS;
    if (css?.escape) return css.escape(String(value || ""));
    return String(value || "").replace(/["\\]/g, "\\$&");
  }

  return {
    actorStyle,
    cssEscape,
    decisionStatus,
    engineColor,
    engineStatus,
    escapeAttr,
    escapeHtml,
    eventColor,
    eventKindClass,
    normalizeExec,
    relativeTime,
    riskClass,
    shortKind,
    shortPath,
    taskStatus,
    toolColor,
    uptime,
  };
});
