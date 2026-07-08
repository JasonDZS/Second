(function initSecondMobilePwa(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondMobilePwa = api;
  if (typeof window === "object") window.SecondMobilePwa = api;
  if (typeof globalThis === "object") globalThis.SecondMobilePwa = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondMobilePwa(root) {
  "use strict";

  let mobileAuthToken = "";

  async function register() {
    if (!supported().serviceWorker) return null;
    const registration = await root.navigator.serviceWorker.register("/service-worker.js");
    registration.update?.().catch(() => {});
    return registration;
  }

  async function configureToken(token) {
    mobileAuthToken = String(token || "").trim();
    if (!mobileAuthToken || !root.navigator?.serviceWorker) return { skipped: true, reason: "Mobile token is empty" };
    const registration = await register();
    if (!registration) return { skipped: true, reason: "当前浏览器不支持 Service Worker" };
    return postTokenToWorker(registration, mobileAuthToken);
  }

  async function subscribe(api) {
    const status = supported();
    if (!status.available) throw new Error(status.reason);
    const registration = await register();
    if (mobileAuthToken) await postTokenToWorker(registration, mobileAuthToken);
    const permission = await root.Notification.requestPermission();
    if (permission !== "granted") throw new Error("系统通知权限未授予");
    const config = await api("/api/mobile/push/config");
    const applicationServerKey = urlBase64ToUint8Array(config.push.publicKey);
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }
    return api("/api/mobile/push/subscribe", {
      method: "POST",
      body: {
        subscription: subscription.toJSON ? subscription.toJSON() : subscription,
        device: deviceCapabilities(status),
      },
    });
  }

  async function syncExistingSubscription(api) {
    const status = supported();
    if (!status.available || root.Notification?.permission !== "granted") {
      return { skipped: true, reason: status.reason || "系统通知尚未授权" };
    }
    const registration = await register();
    if (mobileAuthToken) await postTokenToWorker(registration, mobileAuthToken);
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return { skipped: true, reason: "当前设备还没有 Push 订阅" };
    return api("/api/mobile/push/subscribe", {
      method: "POST",
      body: {
        subscription: subscription.toJSON ? subscription.toJSON() : subscription,
        device: deviceCapabilities(status),
      },
    });
  }

  async function unsubscribe(api) {
    if (!supported().serviceWorker) throw new Error("当前浏览器不支持 Service Worker");
    const registration = await root.navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    return api("/api/mobile/push/unsubscribe", {
      method: "POST",
      body: { endpoint: subscription?.endpoint || "" },
    });
  }

  function supported() {
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(String(root.location?.origin || ""));
    const secure = Boolean(root.isSecureContext || isLocalhost);
    const serviceWorker = Boolean(root.navigator?.serviceWorker);
    const pushManager = Boolean(root.PushManager);
    const notifications = Boolean(root.Notification);
    const ios = isIosLike();
    const standalone = isStandaloneDisplay();
    const notificationMaxActions = notificationActionLimit();
    const notificationActions = notificationMaxActions > 0 && !ios;
    if (!secure) return { available: false, secure, serviceWorker, pushManager, notifications, reason: "PWA Push 需要 HTTPS，localhost 仅用于本机开发" };
    if (!serviceWorker) return { available: false, secure, serviceWorker, pushManager, notifications, reason: "当前浏览器不支持 Service Worker" };
    if (ios && !standalone) {
      return {
        available: false,
        secure,
        serviceWorker,
        pushManager,
        notifications,
        ios,
        standalone,
        notificationActions,
        notificationMaxActions,
        reason: "iPhone / iPad 需要先添加到主屏幕，再从主屏幕图标打开后启用系统通知",
      };
    }
    if (!pushManager) return { available: false, secure, serviceWorker, pushManager, notifications, reason: "当前浏览器不支持 Push API" };
    if (!notifications) return { available: false, secure, serviceWorker, pushManager, notifications, reason: "当前浏览器不支持系统通知" };
    return {
      available: true,
      permission: root.Notification.permission,
      secure,
      serviceWorker,
      pushManager,
      notifications,
      ios,
      standalone,
      notificationActions,
      notificationMaxActions,
      reason: "",
    };
  }

  function deviceCapabilities(status = supported()) {
    return {
      ios: Boolean(status.ios),
      standalone: Boolean(status.standalone),
      notificationActions: Boolean(status.notificationActions),
      notificationMaxActions: Number(status.notificationMaxActions || 0),
    };
  }

  function notificationActionLimit() {
    const maxActions = Number(root.Notification?.maxActions);
    if (!Number.isFinite(maxActions) || maxActions < 0) return 0;
    return Math.floor(maxActions);
  }

  function isIosLike() {
    const nav = root.navigator || {};
    const ua = String(nav.userAgent || "");
    return /iPad|iPhone|iPod/i.test(ua) || (nav.platform === "MacIntel" && Number(nav.maxTouchPoints || 0) > 1);
  }

  function isStandaloneDisplay() {
    return Boolean(root.navigator?.standalone) || Boolean(root.matchMedia?.("(display-mode: standalone)")?.matches);
  }

  async function postTokenToWorker(registration, token) {
    const ready = await root.navigator.serviceWorker.ready.catch(() => registration);
    const targets = new Set([
      ready?.active,
      registration?.active,
      root.navigator.serviceWorker.controller,
    ].filter(Boolean));
    if (!targets.size) return { skipped: true, reason: "Service Worker 尚未激活" };
    for (const target of targets) target.postMessage({ type: "second.mobile.token", token });
    return { ok: true };
  }

  function urlBase64ToUint8Array(value) {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
    const raw = root.atob(base64);
    const output = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
    return output;
  }

  return {
    configureToken,
    register,
    subscribe,
    supported,
    syncExistingSubscription,
    unsubscribe,
    urlBase64ToUint8Array,
  };
});
