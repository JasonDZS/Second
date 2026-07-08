"use strict";

const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const path = require("path");
const { DATA_DIR } = require("./state");

const SECRET_DIR = path.join(DATA_DIR, "secrets");
const STORE_FILE = path.join(SECRET_DIR, "mobile-push.json");
const DEFAULT_SUBJECT = "mailto:second-local@example.invalid";
const MAX_SUBSCRIPTIONS = 12;

function createMobilePushService(deps = {}) {
  const {
    appendEvent = () => {},
    getPublicBaseUrl = () => "",
    loadState = () => ({}),
    nowIso = () => new Date().toISOString(),
    saveState = () => {},
  } = deps;

  function openStore() {
    const explicitSubject = normalizeVapidSubject(process.env.SECOND_WEB_PUSH_SUBJECT || "");
    const desiredSubject = explicitSubject || configuredVapidSubject(process.env, getPublicBaseUrl);
    const store = ensureStore(desiredSubject);
    if (shouldReplaceVapidSubject(store.vapid?.subject, desiredSubject, Boolean(explicitSubject))) {
      store.vapid.subject = desiredSubject;
      writeStore(store);
    }
    return store;
  }

  function publicConfig() {
    const store = openStore();
    return {
      publicKey: vapidPublicKey(store.vapid),
      subscriptionCount: store.subscriptions.length,
      subscriptions: store.subscriptions.map(mobileSubscriptionPacket),
      paired: Boolean(store.mobileAuth?.tokenHash),
      publicUrl: safeMobilePublicBaseUrl(getPublicBaseUrl),
      supported: true,
    };
  }

  function pairingInfo(req) {
    const store = openStore();
    const token = ensureMobileToken(store);
    writeStore(store);
    const baseUrl = pairingBaseUrl(req, process.env, getPublicBaseUrl);
    return {
      token,
      url: `${baseUrl}/mobile.html?pair=${encodeURIComponent(token)}`,
      publicUrl: baseUrl,
      push: publicConfig(),
    };
  }

  function manifest(tokenValue = "") {
    return mobileManifest(verifyToken(tokenValue) ? bearerToken(tokenValue) : "");
  }

  function verifyToken(value) {
    const token = bearerToken(value);
    const store = openStore();
    const expected = store.mobileAuth?.tokenHash || "";
    if (!token || !expected) return false;
    return timingSafeEqual(hashToken(token), expected);
  }

  function subscribe(state, body = {}, request = {}) {
    const store = openStore();
    const subscription = normalizeSubscription(body.subscription || body);
    const existing = store.subscriptions.filter((item) => item.endpoint !== subscription.endpoint);
    existing.unshift({
      ...subscription,
      id: subscriptionId(subscription.endpoint),
      userAgent: String(request.userAgent || "").slice(0, 220),
      device: normalizeDeviceCapabilities(body.device, request.userAgent),
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
    });
    store.subscriptions = existing.slice(0, MAX_SUBSCRIPTIONS);
    writeStore(store);
    appendEvent(state, {
      type: "mobile.push.subscribed",
      text: `mobile.push.subscribed count=${store.subscriptions.length}`,
      channelId: "mobile-pwa",
    });
    saveState(state);
    return publicConfig();
  }

  function unsubscribe(state, body = {}) {
    const endpoint = String(body.endpoint || body.subscription?.endpoint || "");
    const store = openStore();
    const before = store.subscriptions.length;
    store.subscriptions = store.subscriptions.filter((item) => item.endpoint !== endpoint);
    writeStore(store);
    appendEvent(state, {
      type: "mobile.push.unsubscribed",
      text: `mobile.push.unsubscribed removed=${before - store.subscriptions.length}`,
      channelId: "mobile-pwa",
    });
    saveState(state);
    return publicConfig();
  }

  function deleteSubscription(state, id = "") {
    const store = openStore();
    const targetId = String(id || "");
    const before = store.subscriptions.length;
    store.subscriptions = store.subscriptions.filter((item) => item.id !== targetId);
    const removed = before - store.subscriptions.length;
    if (removed) writeStore(store);
    appendEvent(state, {
      type: removed ? "mobile.push.subscription_deleted" : "mobile.push.subscription_delete_missed",
      text: `${removed ? "mobile.push.subscription_deleted" : "mobile.push.subscription_delete_missed"} id=${targetId}`,
      channelId: "mobile-pwa",
    });
    saveState(state);
    return { removed, push: publicConfig() };
  }

  async function notifyDecisionRequested(decision = {}, task = null) {
    const store = openStore();
    if (!store.subscriptions.length) return { ok: false, skipped: true, reason: "No mobile push subscriptions" };

    const results = [];
    const expired = new Set();
    for (const subscription of store.subscriptions) {
      const result = await sendWebPush(subscription, store.vapid);
      results.push({ endpoint: shortEndpoint(subscription.endpoint), ...result });
      if (result.expired) expired.add(subscription.endpoint);
    }
    if (expired.size) {
      store.subscriptions = store.subscriptions.filter((item) => !expired.has(item.endpoint));
      writeStore(store);
    }

    const ok = results.some((item) => item.ok);
    const state = loadState();
    appendEvent(state, {
      type: ok ? "mobile.push.sent" : "mobile.push.failed",
      text: `${ok ? "mobile.push.sent" : "mobile.push.failed"} decision=${decision.id || ""} ok=${results.filter((item) => item.ok).length}/${results.length}`,
      taskId: task?.id || decision.taskId || null,
      decisionId: decision.id || null,
      channelId: "mobile-pwa",
    });
    saveState(state);
    return { ok, results };
  }

  async function sendTestNotification() {
    const state = loadState();
    appendEvent(state, {
      type: "mobile.push.test_requested",
      text: "mobile.push.test_requested",
      channelId: "mobile-pwa",
    });
    saveState(state);
    return notifyDecisionRequested({ id: "test", title: "Second 移动端测试通知" }, null);
  }

  function latestNotification(state = loadState()) {
    const decision = (state.decisions || []).find((item) => !item.archivedAt && item.status === "pending");
    if (!decision) {
      return {
        title: "Second · 任务进度",
        body: "当前没有待处理决策。",
        tag: "second-mobile-ready",
        url: "/mobile.html",
        decisionId: null,
        actions: [],
        requireInteraction: false,
      };
    }
    const task = (state.tasks || []).find((item) => item.id === decision.taskId) || null;
    return decisionNotificationPayload(decision, task);
  }

  return {
    deleteSubscription,
    latestNotification,
    manifest,
    notifyDecisionRequested,
    pairingInfo,
    publicConfig,
    sendTestNotification,
    subscribe,
    unsubscribe,
    verifyToken,
  };
}

function sendWebPush(subscription, vapid) {
  return new Promise((resolve) => {
    let endpoint;
    try {
      endpoint = new URL(subscription.endpoint);
    } catch {
      resolve({ ok: false, expired: true, error: "invalid_endpoint" });
      return;
    }

    const jwt = vapidJwt(endpoint.origin, vapid);
    const req = https.request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port || 443,
        path: `${endpoint.pathname}${endpoint.search}`,
        method: "POST",
        headers: {
          TTL: "300",
          Urgency: "high",
          "Content-Length": "0",
          Authorization: `vapid t=${jwt}, k=${vapidPublicKey(vapid)}`,
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          resolve({
            ok,
            statusCode: res.statusCode,
            expired: res.statusCode === 404 || res.statusCode === 410,
          });
        });
      },
    );
    req.setTimeout(6000, () => req.destroy(new Error("Web Push request timed out")));
    req.on("error", (error) => resolve({ ok: false, error: error.message }));
    req.end();
  });
}

function vapidJwt(audience, vapid) {
  const header = base64UrlJson({ typ: "JWT", alg: "ES256" });
  const payload = base64UrlJson({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: vapid.subject || DEFAULT_SUBJECT,
  });
  const input = `${header}.${payload}`;
  const key = crypto.createPrivateKey({ key: vapid.privateJwk, format: "jwk" });
  const signature = crypto.sign("sha256", Buffer.from(input), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${input}.${base64Url(signature)}`;
}

function ensureStore(subject = DEFAULT_SUBJECT) {
  const store = readStore();
  if (!store.vapid?.privateJwk?.d) store.vapid = generateVapid(subject);
  if (!Array.isArray(store.subscriptions)) store.subscriptions = [];
  if (!store.mobileAuth?.tokenHash) ensureMobileToken(store);
  writeStore(store);
  return store;
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeStore(store) {
  fs.mkdirSync(SECRET_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(STORE_FILE, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(SECRET_DIR, 0o700);
    fs.chmodSync(STORE_FILE, 0o600);
  } catch {
    // chmod is best-effort on non-POSIX filesystems.
  }
}

function generateVapid(subject = process.env.SECOND_WEB_PUSH_SUBJECT || DEFAULT_SUBJECT) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    subject: normalizeVapidSubject(subject) || DEFAULT_SUBJECT,
    privateJwk: privateKey.export({ format: "jwk" }),
    publicJwk: publicKey.export({ format: "jwk" }),
  };
}

function configuredVapidSubject(env = process.env, getPublicBaseUrl = () => "") {
  const explicit = normalizeVapidSubject(env.SECOND_WEB_PUSH_SUBJECT || "");
  if (explicit) return explicit;
  try {
    return normalizeVapidSubject(mobilePublicBaseUrl(env, getPublicBaseUrl));
  } catch {
    return DEFAULT_SUBJECT;
  }
}

function normalizeVapidSubject(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text) || /^mailto:/i.test(text)) return text;
  if (/^[^@\s]+@[^@\s]+$/.test(text)) return `mailto:${text}`;
  return "";
}

function shouldReplaceVapidSubject(current, desired, force = false) {
  if (!desired || current === desired) return false;
  if (force) return true;
  if (!current) return true;
  return current === DEFAULT_SUBJECT || /\.invalid(?:[/:]|$)/i.test(String(current));
}

function ensureMobileToken(store) {
  if (store.mobileAuth?.token) return store.mobileAuth.token;
  const token = crypto.randomBytes(32).toString("base64url");
  store.mobileAuth = {
    token,
    tokenHash: hashToken(token),
    createdAt: new Date().toISOString(),
  };
  return token;
}

function bearerToken(value) {
  const text = String(value || "").trim();
  const match = text.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : text;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isLocalHostHeader(host) {
  const value = String(host || "").toLowerCase().replace(/^\[/, "").replace(/\].*$/, "");
  return /^localhost(?::|$)/.test(value) || /^127\.0\.0\.1(?::|$)/.test(value) || /^::1(?::|$)/.test(value);
}

function pairingBaseUrl(req = {}, env = process.env, getPublicBaseUrl = () => "") {
  return mobilePublicBaseUrl(env, getPublicBaseUrl) || requestBaseUrl(req);
}

function mobilePublicBaseUrl(env = process.env, getPublicBaseUrl = () => "") {
  return normalizeMobileBaseUrl(getPublicBaseUrl() || env.SECOND_MOBILE_PUBLIC_URL || env.SECOND_PUBLIC_URL || "");
}

function safeMobilePublicBaseUrl(getPublicBaseUrl = () => "", env = process.env) {
  try {
    return mobilePublicBaseUrl(env, getPublicBaseUrl);
  } catch {
    return "";
  }
}

function requestBaseUrl(req = {}) {
  const headers = req.headers || {};
  const host = firstHeader(headers["x-forwarded-host"]) || firstHeader(headers.host) || "127.0.0.1:7318";
  const proto = firstHeader(headers["x-forwarded-proto"]) || (req.socket?.encrypted ? "https" : "http");
  return normalizeMobileBaseUrl(`${proto}://${host}`);
}

function normalizeMobileBaseUrl(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) return "";
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    const error = new Error("Mobile public URL must be an http(s) URL");
    error.statusCode = 500;
    throw error;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    const error = new Error("Mobile public URL must be an http(s) URL");
    error.statusCode = 500;
    throw error;
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/+$/, "");
}

function firstHeader(value) {
  return String(Array.isArray(value) ? value[0] : value || "").split(",")[0].trim();
}

function vapidPublicKey(vapid = {}) {
  const x = Buffer.from(vapid.publicJwk?.x || "", "base64url");
  const y = Buffer.from(vapid.publicJwk?.y || "", "base64url");
  if (x.length !== 32 || y.length !== 32) return "";
  return base64Url(Buffer.concat([Buffer.from([0x04]), x, y]));
}

function normalizeSubscription(subscription = {}) {
  const endpoint = String(subscription.endpoint || "");
  if (!endpoint.startsWith("https://")) {
    const error = new Error("Push subscription endpoint must be https");
    error.statusCode = 400;
    throw error;
  }
  return {
    endpoint,
    expirationTime: subscription.expirationTime || null,
    keys: {
      p256dh: String(subscription.keys?.p256dh || ""),
      auth: String(subscription.keys?.auth || ""),
    },
  };
}

function subscriptionId(endpoint) {
  return crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
}

function shortEndpoint(endpoint) {
  const text = String(endpoint || "");
  return text.length > 36 ? `${text.slice(0, 18)}...${text.slice(-10)}` : text;
}

function mobileSubscriptionPacket(subscription = {}) {
  const endpoint = String(subscription.endpoint || "");
  let host = "";
  try {
    host = new URL(endpoint).hostname;
  } catch {
    host = "unknown";
  }
  const ua = parseUserAgent(subscription.userAgent || "");
  const device = normalizeDeviceCapabilities(subscription.device, subscription.userAgent || "");
  return {
    id: subscription.id || subscriptionId(endpoint),
    label: ua.label,
    platform: ua.platform,
    browser: ua.browser,
    endpointHost: host,
    notificationActions: Boolean(device.notificationActions),
    notificationMaxActions: device.notificationMaxActions,
    createdAt: subscription.createdAt || "",
    lastSeenAt: subscription.lastSeenAt || "",
  };
}

function normalizeDeviceCapabilities(device = {}, userAgent = "") {
  const ua = parseUserAgent(userAgent || "");
  const maxActions = Number(device.notificationMaxActions);
  const notificationMaxActions = Number.isFinite(maxActions) && maxActions > 0 ? Math.floor(maxActions) : 0;
  const ios = Boolean(device.ios) || ua.platform === "iOS";
  return {
    ios,
    standalone: Boolean(device.standalone),
    notificationMaxActions,
    notificationActions: Boolean(device.notificationActions) && notificationMaxActions > 0 && !ios,
  };
}

function parseUserAgent(value) {
  const text = String(value || "");
  const platform = /iPhone|iPad|iPod/i.test(text)
    ? "iOS"
    : /Android/i.test(text)
      ? "Android"
      : /Macintosh|Mac OS X/i.test(text)
        ? "macOS"
        : /Windows/i.test(text)
          ? "Windows"
          : /Linux/i.test(text)
            ? "Linux"
            : "未知设备";
  const browser = /Edg\//i.test(text)
    ? "Edge"
    : /CriOS|Chrome\//i.test(text)
      ? "Chrome"
      : /Firefox\//i.test(text)
        ? "Firefox"
        : /Safari\//i.test(text)
          ? "Safari"
          : "浏览器";
  return {
    platform,
    browser,
    label: `${platform} · ${browser}`,
  };
}

function base64UrlJson(value) {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function redactPushText(value) {
  return String(value || "")
    .replace(/\bsk-or-v1-[A-Za-z0-9_-]{8,}\b/g, "sk-or-v1-...已隐藏")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "sk-...已隐藏")
    .replace(/(\bapi[_-]?key\b\s*[:=]\s*)[^\s,，。)]+/gi, "$1已隐藏")
    .replace(/\b(xoxb|xapp|xoxp)-[A-Za-z0-9-]{10,}\b/g, "$1-...已隐藏")
    .trim();
}

function decisionNotificationPayload(decision = {}, task = null) {
  const risk = compactNotificationText(redactPushText(decision.risk || "中"), 12) || "中";
  const title = compactNotificationText(
    redactPushText(decision.title || decision.summary || decision.id || "新的决策请求"),
    54,
  );
  const taskTitle = compactNotificationText(
    redactPushText(decision.taskTitle || task?.title || task?.summary || ""),
    52,
  );
  const actor = compactNotificationText(redactPushText(decision.agent || decision.source || task?.agent || ""), 24);
  const meta = [decision.taskId || task?.id, taskTitle, actor].filter(Boolean).join(" · ");
  const body = [
    `${title} · ${risk}风险`,
    compactNotificationText(meta, 92),
  ].filter(Boolean).join("\n");
  return {
    title: "Second · 决策请求",
    body,
    tag: `second-decision-${decision.id || "pending"}`,
    url: `/mobile.html?decision=${encodeURIComponent(decision.id || "")}`,
    replyUrl: `/mobile.html?decision=${encodeURIComponent(decision.id || "")}&compose=1`,
    decisionId: decision.id || null,
    decisionTitle: title,
    risk,
    meta: compactNotificationText(meta, 120),
    actions: [
      { action: "approved", title: "批准" },
      { action: "rejected", title: "拒绝" },
      { action: "more", title: "补充更多" },
    ],
    actionHint: "点开通知进入决策页，可批准、拒绝或补充更多。",
    requireInteraction: true,
    renotify: true,
    timestamp: notificationTimestamp(decision.createdAt),
  };
}

function compactNotificationText(value, maxLength = 80) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function notificationTimestamp(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : Date.now();
}

function mobileManifest(pairToken = "") {
  const token = String(pairToken || "").trim();
  const startUrl = token ? `/mobile.html?pair=${encodeURIComponent(token)}` : "/mobile.html";
  return {
    name: "Second Decision Companion",
    short_name: "Second",
    description: "Mobile Human Gate decision remote for Second.",
    lang: "zh-CN",
    start_url: startUrl,
    scope: "/",
    display: "standalone",
    background_color: "#f7f5ef",
    theme_color: "#1d1b17",
    icons: [
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/logo-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "/logo-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "/logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ],
  };
}

module.exports = {
  createMobilePushService,
  bearerToken,
  configuredVapidSubject,
  decisionNotificationPayload,
  generateVapid,
  hashToken,
  isLocalHostHeader,
  mobilePublicBaseUrl,
  mobileManifest,
  mobileSubscriptionPacket,
  normalizeSubscription,
  normalizeMobileBaseUrl,
  normalizeVapidSubject,
  pairingBaseUrl,
  redactPushText,
  requestBaseUrl,
  shouldReplaceVapidSubject,
  vapidJwt,
  vapidPublicKey,
};
