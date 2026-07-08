"use strict";

const DEFAULT_NOTIFICATION = {
  title: "Second 移动端",
  body: "有新的 Human Gate 决策等待处理。",
  tag: "second-mobile",
  url: "/mobile.html",
};
const MOBILE_AUTH_CACHE = "second-mobile-auth-v1";
const MOBILE_AUTH_TOKEN_URL = "/__second_mobile_token";
const DECISION_ACTIONS = new Set(["approved", "rejected"]);
const OPEN_ACTIONS = new Set(["more", "open"]);
let memoryMobileToken = "";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(showDecisionNotification(event));
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "second.mobile.token") return;
  event.waitUntil(storeMobileToken(data.token));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(handleNotificationClick(event));
});

async function showDecisionNotification(event) {
  const payload = await notificationPayload(event);
  const actions = notificationActions(payload.actions);
  const options = {
    body: notificationBody(payload, actions),
    tag: payload.tag || DEFAULT_NOTIFICATION.tag,
    icon: "/apple-touch-icon.png",
    badge: "/apple-touch-icon.png",
    data: {
      url: payload.url || DEFAULT_NOTIFICATION.url,
      replyUrl: payload.replyUrl || payload.url || DEFAULT_NOTIFICATION.url,
      decisionId: payload.decisionId || null,
      decisionTitle: payload.decisionTitle || "",
      risk: payload.risk || "",
      meta: payload.meta || "",
    },
    requireInteraction: Boolean(payload.requireInteraction || payload.decisionId),
    renotify: Boolean(payload.renotify && (payload.tag || DEFAULT_NOTIFICATION.tag)),
  };
  if (payload.timestamp) options.timestamp = payload.timestamp;
  if (actions.length) options.actions = actions;
  try {
    await self.registration.showNotification(payload.title || DEFAULT_NOTIFICATION.title, options);
  } catch {
    delete options.actions;
    options.body = notificationBody(payload, []);
    await self.registration.showNotification(payload.title || DEFAULT_NOTIFICATION.title, options);
  }
}

async function notificationPayload(event) {
  const data = event.data;
  if (data) {
    try {
      return data.json();
    } catch {
      try {
        return { ...DEFAULT_NOTIFICATION, body: data.text() };
      } catch {
        // Fall through to same-origin fetch.
      }
    }
  }
  try {
    const response = await authorizedFetch("/api/mobile/push/notification", { cache: "no-store" });
    if (response.ok) return response.json();
  } catch {
    // Offline notification should still be visible.
  }
  return DEFAULT_NOTIFICATION;
}

async function handleNotificationClick(event) {
  const action = event.action || "";
  const data = event.notification.data || {};
  if (DECISION_ACTIONS.has(action)) return resolveNotificationAction(data, action);
  if (OPEN_ACTIONS.has(action)) return focusOrOpen(data.replyUrl || data.url || DEFAULT_NOTIFICATION.url);
  return focusOrOpen(data.url || DEFAULT_NOTIFICATION.url);
}

async function resolveNotificationAction(data, verdict) {
  const decisionId = data.decisionId;
  const url = data.url || DEFAULT_NOTIFICATION.url;
  if (!decisionId) return focusOrOpen(url);
  try {
    const response = await authorizedFetch(`/api/mobile/decisions/${encodeURIComponent(decisionId)}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    await notifyOpenClients({ type: "second.mobile.decision-resolved", decisionId, verdict });
    await self.registration.showNotification(verdict === "approved" ? "Second · 已批准" : "Second · 已拒绝", {
      body: `${data.decisionTitle || "决策"} 已回传，daemon 会继续处理。`,
      tag: `second-decision-${decisionId}-resolved`,
      icon: "/apple-touch-icon.png",
      badge: "/apple-touch-icon.png",
      data: { url },
    });
    return null;
  } catch {
    await self.registration.showNotification("Second · 操作未完成", {
      body: "无法直接回传决策，请打开移动端处理。",
      tag: `second-decision-${decisionId}-failed`,
      icon: "/apple-touch-icon.png",
      badge: "/apple-touch-icon.png",
      data: { url },
      requireInteraction: true,
    });
    return focusOrOpen(url);
  }
}

function notificationActions(actions = []) {
  if (!Array.isArray(actions)) return [];
  const maxActions = self.Notification?.maxActions;
  if (isIosWorker() && !Number.isFinite(maxActions)) return [];
  const max = Number.isFinite(maxActions) ? maxActions : Math.min(actions.length, 2);
  if (max <= 0) return [];
  return actions
    .filter((action) => action && action.action && action.title)
    .slice(0, max)
    .map((action) => ({
      action: String(action.action),
      title: String(action.title),
      ...(action.icon ? { icon: String(action.icon) } : {}),
    }));
}

function notificationBody(payload = {}, actions = []) {
  const body = payload.body || DEFAULT_NOTIFICATION.body;
  if (actions.length || !payload.actionHint) return body;
  return `${body}\n${payload.actionHint}`;
}

function isIosWorker() {
  const ua = String(self.navigator?.userAgent || "");
  return /iPad|iPhone|iPod/i.test(ua) || (/Macintosh|Mac OS X/i.test(ua) && /Mobile\//i.test(ua));
}

async function authorizedFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = await readMobileToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}

async function storeMobileToken(token) {
  const value = String(token || "").trim();
  memoryMobileToken = value;
  if (!value || !self.caches) return;
  try {
    const cache = await self.caches.open(MOBILE_AUTH_CACHE);
    await cache.put(mobileAuthTokenRequest(), new Response(value, { headers: { "Content-Type": "text/plain" } }));
  } catch {
    // In-memory token still covers the active worker lifetime.
  }
}

async function readMobileToken() {
  if (memoryMobileToken) return memoryMobileToken;
  if (!self.caches) return "";
  try {
    const cache = await self.caches.open(MOBILE_AUTH_CACHE);
    const response = await cache.match(mobileAuthTokenRequest());
    memoryMobileToken = response ? (await response.text()).trim() : "";
  } catch {
    memoryMobileToken = "";
  }
  return memoryMobileToken;
}

function mobileAuthTokenRequest() {
  return new Request(new URL(MOBILE_AUTH_TOKEN_URL, self.location.origin).href);
}

async function notifyOpenClients(message) {
  const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of allClients) client.postMessage(message);
}

async function focusOrOpen(url) {
  const absolute = new URL(url, self.location.origin).href;
  const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of allClients) {
    if ("focus" in client) {
      if ("navigate" in client) await client.navigate(absolute);
      return client.focus();
    }
  }
  return self.clients.openWindow(absolute);
}
