"use strict";

const { spawn } = require("child_process");
const http = require("http");
const https = require("https");
const { normalizeMobileBaseUrl } = require("./mobile-push");

const PROVIDERS = [
  {
    id: "manual",
    label: "手动公网链接",
    description: "使用你自己配置好的 HTTPS 域名、反向代理、frp 或内网穿透地址。",
    managed: false,
  },
  {
    id: "cloudflared",
    label: "Cloudflare Quick Tunnel",
    description: "由 Second 启动 cloudflared 快速隧道，并自动读取 trycloudflare.com 地址。",
    managed: true,
  },
];
const PROVIDER_IDS = new Set(PROVIDERS.map((provider) => provider.id));
const CLOUDFLARED_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i;

function createPublicAccessService(deps = {}) {
  const {
    appendEvent = () => {},
    checkImpl = checkPublicUrl,
    getLocalUrl = () => "http://127.0.0.1:7317",
    loadState = () => ({}),
    nowIso = () => new Date().toISOString(),
    saveState = () => {},
    spawnImpl = spawn,
  } = deps;

  const runtime = {
    child: null,
    cloudflaredUrl: "",
    lastLog: "",
    status: "off",
    stopping: false,
    stoppingChild: null,
  };

  function publicConfig(state = loadState()) {
    const settings = publicAccessSettings(state);
    const provider = providerById(settings.provider);
    const runtimeActive = settings.provider === "cloudflared" && Boolean(runtime.child);
    const activeUrl = effectiveActiveUrl(settings);
    return {
      enabled: Boolean(settings.enabled),
      provider: settings.provider,
      providerLabel: provider.label,
      providers: PROVIDERS,
      managed: provider.managed,
      manualUrl: settings.manualUrl || "",
      activeUrl,
      status: effectiveStatus(settings),
      processRunning: runtimeActive,
      pid: runtimeActive ? runtime.child.pid || null : null,
      lastCheck: settings.lastCheck || null,
      lastError: runtime.status === "error" ? runtime.lastLog || settings.lastError || "" : settings.lastError || "",
      updatedAt: settings.updatedAt || "",
    };
  }

  function publicBaseUrl() {
    const config = publicConfig(loadState());
    return config.enabled ? config.activeUrl || "" : "";
  }

  function configure(input = {}) {
    const state = loadState();
    const current = publicAccessSettings(state);
    const provider = normalizeProvider(input.provider || current.provider);
    const manualUrl = normalizeOptionalUrl(
      Object.prototype.hasOwnProperty.call(input, "manualUrl") ? input.manualUrl : current.manualUrl,
    );
    const enabled = Object.prototype.hasOwnProperty.call(input, "enabled") ? Boolean(input.enabled) : Boolean(current.enabled);
    if (enabled && provider === "manual" && !manualUrl) {
      const error = new Error("手动公网链接不能为空");
      error.statusCode = 400;
      throw error;
    }
    const activeUrl = enabled
      ? provider === "manual"
        ? manualUrl
        : normalizeOptionalUrl(current.activeUrl || runtime.cloudflaredUrl)
      : "";
    savePublicAccessSettings(state, {
      ...current,
      enabled,
      provider,
      manualUrl,
      activeUrl,
      status: enabled ? (provider === "manual" ? "configured" : current.status || "configured") : "off",
      lastError: "",
    });
    appendEvent(state, {
      type: "public_access.config",
      text: `public_access.config provider=${provider} enabled=${enabled}`,
      channelId: "public-access",
    });
    saveState(state);
    return publicConfig(state);
  }

  async function start(input = {}) {
    const state = loadState();
    const current = publicAccessSettings(state);
    const provider = normalizeProvider(input.provider || current.provider);
    if (provider === "manual") {
      return configure({
        provider,
        manualUrl: Object.prototype.hasOwnProperty.call(input, "manualUrl") ? input.manualUrl : current.manualUrl,
        enabled: true,
      });
    }

    savePublicAccessSettings(state, {
      ...current,
      enabled: true,
      provider,
      activeUrl: runtime.cloudflaredUrl || current.activeUrl || "",
      status: runtime.cloudflaredUrl ? "online" : "starting",
      lastError: "",
    });
    appendEvent(state, {
      type: "public_access.start",
      text: `public_access.start provider=${provider}`,
      channelId: "public-access",
    });
    saveState(state);

    if (!runtime.child) spawnCloudflared();
    await waitForCloudflaredUrl(12000).catch(() => {});
    return publicConfig(loadState());
  }

  function stop() {
    const state = loadState();
    const current = publicAccessSettings(state);
    runtime.stopping = true;
    runtime.stoppingChild = runtime.child;
    if (runtime.child) {
      try {
        runtime.child.kill("SIGTERM");
      } catch {
        // The process may already have exited.
      }
    }
    runtime.child = null;
    runtime.cloudflaredUrl = "";
    runtime.status = "off";
    savePublicAccessSettings(state, {
      ...current,
      enabled: false,
      activeUrl: "",
      status: "off",
      lastError: "",
    });
    appendEvent(state, {
      type: "public_access.stop",
      text: `public_access.stop provider=${current.provider}`,
      channelId: "public-access",
    });
    saveState(state);
    runtime.stopping = false;
    return publicConfig(state);
  }

  function stopRuntime() {
    runtime.stopping = true;
    runtime.stoppingChild = runtime.child;
    if (runtime.child) {
      try {
        runtime.child.kill("SIGTERM");
      } catch {
        // The process may already have exited.
      }
    }
    runtime.child = null;
    runtime.cloudflaredUrl = "";
    runtime.status = "off";
    runtime.stopping = false;
  }

  async function check(input = {}) {
    const state = loadState();
    const current = publicAccessSettings(state);
    const targetUrl = normalizeRequiredUrl(input.url || effectiveActiveUrl(current) || current.manualUrl);
    const startedAt = Date.now();
    let result;
    try {
      result = await checkImpl(targetUrl, { timeoutMs: Number(input.timeoutMs || 8000) });
    } catch (error) {
      result = { ok: false, error: error.message || "公网检测失败" };
    }
    const checkResult = {
      at: nowIso(),
      url: targetUrl,
      ok: Boolean(result.ok),
      statusCode: result.statusCode || null,
      latencyMs: Date.now() - startedAt,
      error: result.ok ? "" : result.error || "公网检测失败",
    };
    savePublicAccessSettings(state, {
      ...current,
      activeUrl: result.ok ? targetUrl : current.activeUrl || "",
      status: result.ok ? "online" : current.enabled ? "error" : "off",
      lastCheck: checkResult,
      lastError: checkResult.error,
    });
    appendEvent(state, {
      type: result.ok ? "public_access.check_ok" : "public_access.check_failed",
      text: `${result.ok ? "public_access.check_ok" : "public_access.check_failed"} url=${targetUrl}`,
      channelId: "public-access",
    });
    saveState(state);
    return { publicAccess: publicConfig(state), check: checkResult };
  }

  function spawnCloudflared() {
    runtime.stopping = false;
    runtime.status = "starting";
    runtime.lastLog = "";
    const child = spawnImpl("cloudflared", [
      "tunnel",
      "--protocol",
      "http2",
      "--url",
      getLocalUrl(),
      "--loglevel",
      "info",
    ], {
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    runtime.child = child;
    child.stdout?.on("data", (chunk) => handleCloudflaredOutput(chunk));
    child.stderr?.on("data", (chunk) => handleCloudflaredOutput(chunk));
    child.once?.("error", (error) => markCloudflaredError(error.message || "cloudflared 启动失败"));
    child.once?.("close", (code, signal) => {
      if (runtime.child === child) runtime.child = null;
      if (runtime.stopping || runtime.stoppingChild === child) {
        if (runtime.stoppingChild === child) runtime.stoppingChild = null;
        return;
      }
      markCloudflaredError(`cloudflared 已退出${code == null ? "" : ` code=${code}`}${signal ? ` signal=${signal}` : ""}`);
    });
  }

  function handleCloudflaredOutput(chunk) {
    const text = String(chunk || "");
    runtime.lastLog = `${runtime.lastLog}\n${text}`.slice(-1600);
    const match = text.match(CLOUDFLARED_URL_RE) || runtime.lastLog.match(CLOUDFLARED_URL_RE);
    if (!match) return;
    const url = normalizeOptionalUrl(match[0]);
    if (!url || runtime.cloudflaredUrl === url) return;
    runtime.cloudflaredUrl = url;
    runtime.status = "online";
    const state = loadState();
    const current = publicAccessSettings(state);
    if (current.provider !== "cloudflared" || !current.enabled) return;
    savePublicAccessSettings(state, {
      ...current,
      activeUrl: url,
      status: "online",
      lastError: "",
    });
    appendEvent(state, {
      type: "public_access.online",
      text: `public_access.online provider=cloudflared url=${url}`,
      channelId: "public-access",
    });
    saveState(state);
  }

  function markCloudflaredError(message) {
    runtime.status = "error";
    runtime.lastLog = String(message || "cloudflared 启动失败").slice(0, 1600);
    const state = loadState();
    const current = publicAccessSettings(state);
    if (current.provider !== "cloudflared" || !current.enabled) return;
    savePublicAccessSettings(state, {
      ...current,
      activeUrl: runtime.cloudflaredUrl || current.activeUrl || "",
      status: "error",
      lastError: runtime.lastLog,
    });
    appendEvent(state, {
      type: "public_access.error",
      text: `public_access.error provider=cloudflared ${runtime.lastLog}`,
      channelId: "public-access",
    });
    saveState(state);
  }

  function waitForCloudflaredUrl(timeoutMs) {
    if (runtime.cloudflaredUrl) return Promise.resolve(runtime.cloudflaredUrl);
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (runtime.cloudflaredUrl) {
          clearInterval(timer);
          resolve(runtime.cloudflaredUrl);
          return;
        }
        if (runtime.status === "error") {
          clearInterval(timer);
          reject(new Error(runtime.lastLog || "cloudflared 启动失败"));
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          clearInterval(timer);
          reject(new Error("cloudflared 暂未返回公网链接"));
        }
      }, 150);
    });
  }

  return {
    check,
    configure,
    publicBaseUrl,
    publicConfig,
    start,
    stop,
    stopRuntime,
  };
}

function publicAccessSettings(state = {}) {
  const saved = state.settings?.publicAccess || {};
  const provider = normalizeProvider(saved.provider || "manual");
  return {
    enabled: Boolean(saved.enabled),
    provider,
    manualUrl: normalizeOptionalUrl(saved.manualUrl || ""),
    activeUrl: normalizeOptionalUrl(saved.activeUrl || ""),
    status: saved.status || "off",
    lastCheck: saved.lastCheck || null,
    lastError: saved.lastError || "",
    updatedAt: saved.updatedAt || "",
  };
}

function savePublicAccessSettings(state, next) {
  if (!state.settings) state.settings = {};
  state.settings.publicAccess = {
    enabled: Boolean(next.enabled),
    provider: normalizeProvider(next.provider),
    manualUrl: normalizeOptionalUrl(next.manualUrl || ""),
    activeUrl: normalizeOptionalUrl(next.activeUrl || ""),
    status: next.status || "off",
    lastCheck: next.lastCheck || null,
    lastError: String(next.lastError || ""),
    updatedAt: new Date().toISOString(),
  };
  return state.settings.publicAccess;
}

function effectiveActiveUrl(settings = {}) {
  if (!settings.enabled) return "";
  if (settings.provider === "manual") return normalizeOptionalUrl(settings.manualUrl || settings.activeUrl || "");
  return normalizeOptionalUrl(settings.activeUrl || "");
}

function effectiveStatus(settings = {}) {
  if (!settings.enabled) return "off";
  if (settings.status === "online" && effectiveActiveUrl(settings)) return "online";
  if (settings.status === "starting" || settings.status === "error") return settings.status;
  return effectiveActiveUrl(settings) ? "configured" : "configured";
}

function providerById(id) {
  return PROVIDERS.find((provider) => provider.id === id) || PROVIDERS[0];
}

function normalizeProvider(value) {
  const id = String(value || "manual").trim();
  return PROVIDER_IDS.has(id) ? id : "manual";
}

function normalizeRequiredUrl(value) {
  const normalized = normalizeOptionalUrl(value);
  if (normalized && /^https?:\/\//i.test(normalized)) return normalized;
  const error = new Error("请先配置可访问的公网 HTTP(S) 链接");
  error.statusCode = 400;
  throw error;
}

function normalizeOptionalUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return normalizeMobileBaseUrl(text);
  } catch {
    return text.replace(/\/+$/, "");
  }
}

function checkPublicUrl(baseUrl, options = {}) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL("api/health", `${normalizeMobileBaseUrl(baseUrl)}/`);
    } catch (error) {
      resolve({ ok: false, error: error.message || "公网链接格式无效" });
      return;
    }
    const client = target.protocol === "https:" ? https : http;
    const req = client.request(
      target,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 4096) req.destroy(new Error("响应过大"));
        });
        res.on("end", () => {
          let parsed = {};
          try {
            parsed = JSON.parse(body || "{}");
          } catch {
            parsed = {};
          }
          const ok = res.statusCode >= 200 && res.statusCode < 300 && parsed.ok === true;
          resolve({
            ok,
            statusCode: res.statusCode,
            error: ok ? "" : `公网地址未返回 Second health: HTTP ${res.statusCode}`,
          });
        });
      },
    );
    req.setTimeout(Number(options.timeoutMs || 8000), () => req.destroy(new Error("公网检测超时")));
    req.on("error", (error) => resolve({ ok: false, error: error.message || "公网检测失败" }));
    req.end();
  });
}

module.exports = {
  CLOUDFLARED_URL_RE,
  PROVIDERS,
  checkPublicUrl,
  createPublicAccessService,
  normalizeProvider,
  publicAccessSettings,
};
