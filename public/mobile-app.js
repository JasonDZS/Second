(() => {
  "use strict";

  const root = document.getElementById("mobile-app");
  const ApiClient = globalThis.SecondApiClient || {};
  const MobileView = globalThis.SecondMobileView || {};
  const MobilePwa = globalThis.SecondMobilePwa || {};
  const PRODUCT_NAME = "Second";
  const view = MobileView.createMobileView({
    PRODUCT_NAME,
    brandMark,
  });
  const initialTarget = initialDecisionTarget();
  const ui = {
    busy: false,
    mobileExpanded: initialTarget.id ? { [initialTarget.id]: true } : {},
    mobileReplyDrafts: {},
    mobileReplyOpen: initialTarget.compose && initialTarget.id ? { [initialTarget.id]: true } : {},
    mobileReplyFocusId: initialTarget.compose ? initialTarget.id : "",
  };
  const mobileToken = consumePairingToken();
  configureManifest(mobileToken);
  const AUTO_REFRESH_VISIBLE_MS = 5000;
  const AUTO_REFRESH_HIDDEN_MS = 30000;
  let state = { decisions: [], integrations: { mobilePwa: {} } };
  let toast = "";
  let toastTimer = null;
  let refreshInFlight = null;
  let autoRefreshTimer = null;
  let lastStateSignature = "";

  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    event.preventDefault();
    handleAction(target.dataset);
  });
  root.addEventListener("input", (event) => {
    if (!event.target.matches("[data-mobile-reply-field]")) return;
    const id = event.target.dataset.id;
    ui.mobileReplyDrafts[id] = event.target.value;
    syncReplySendButton(id, event.target.value);
  });

  init();

  async function init() {
    bindServiceWorkerMessages();
    Promise.resolve(MobilePwa.register?.())
      .then(() => (mobileToken ? MobilePwa.configureToken?.(mobileToken) : null))
      .catch(() => {});
    await refresh({ force: true });
    startAutoRefresh();
    if (mobileToken) {
      MobilePwa.configureToken?.(mobileToken).catch(() => {});
      MobilePwa.syncExistingSubscription?.(api)
        .then((result) => {
          if (!result?.skipped) return refresh({ force: true });
          return null;
        })
        .catch(() => {});
    }
  }

  async function refresh(options = {}) {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = loadMobileState(options).finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  async function loadMobileState({ force = false, silent = false } = {}) {
    try {
      const payload = await api("/api/mobile/decisions");
      const nextState = {
        decisions: mergeLocalDecisionState(payload.decisions || []),
        integrations: { mobilePwa: payload.push || {} },
      };
      const signature = mobileStateSignature(nextState);
      state = nextState;
      if (force || signature !== lastStateSignature) {
        lastStateSignature = signature;
        render();
      }
    } catch (error) {
      if (/not paired|401/i.test(error.message || "")) {
        state = {
          mobilePairingRequired: true,
          decisions: [],
          integrations: { mobilePwa: {} },
        };
        lastStateSignature = "";
        render();
        return;
      }
      if (silent) return;
      throw error;
    }
  }

  async function handleAction(data) {
    try {
      if (data.action === "mobile-push-subscribe") {
        ui.busy = "mobile-push";
        render();
        await MobilePwa.subscribe(api);
        ui.busy = false;
        showToast("手机系统通知已启用");
        await refresh({ force: true });
      } else if (data.action === "mobile-push-unsubscribe") {
        ui.busy = "mobile-push";
        render();
        await MobilePwa.unsubscribe(api);
        ui.busy = false;
        showToast("已取消当前设备订阅");
        await refresh({ force: true });
      } else if (data.action === "mobile-push-test") {
        ui.busy = "mobile-push-test";
        render();
        const result = await api("/api/mobile/push/test", { method: "POST" });
        ui.busy = false;
        showToast(result.result?.ok ? "测试通知已发送" : "测试通知已提交");
        await refresh({ force: true });
      } else if (data.action === "mobile-copy-pairing-link") {
        const link = pairedMobileLink();
        await navigator.clipboard?.writeText(link);
        showToast("配对链接已复制");
      } else if (data.action === "select-option") {
        const decision = state.decisions.find((item) => item.id === data.id);
        if (decision) decision.selectedOption = data.option;
        render();
      } else if (data.action === "mobile-resolve-decision") {
        const decision = state.decisions.find((item) => item.id === data.id);
        await api(`/api/mobile/decisions/${encodeURIComponent(data.id)}/resolve`, {
          method: "POST",
          body: { verdict: data.verdict, optionId: decision?.selectedOption },
        });
        showToast(data.verdict === "approved" ? "已批准" : "已拒绝");
        await refresh({ force: true });
      } else if (data.action === "open-decision") {
        const decision = state.decisions.find((item) => item.id === data.id);
        if (decision) {
          decision.expanded = !decision.expanded;
          render();
        }
      } else if (data.action === "mobile-toggle-decision") {
        ui.mobileExpanded[data.id] = !ui.mobileExpanded[data.id];
        render();
      } else if (data.action === "mobile-toggle-reply") {
        ui.mobileReplyOpen[data.id] = !ui.mobileReplyOpen[data.id];
        if (ui.mobileReplyOpen[data.id]) {
          ui.mobileExpanded[data.id] = true;
          ui.mobileReplyFocusId = data.id;
        }
        render();
      } else if (data.action === "mobile-send-decision-reply") {
        const message = String(ui.mobileReplyDrafts[data.id] || "").trim();
        if (!message) return showToast("先填写补充信息");
        ui.busy = `mobile-reply-${data.id}`;
        render();
        await api(`/api/mobile/decisions/${encodeURIComponent(data.id)}/reply`, {
          method: "POST",
          body: { message },
        });
        ui.busy = false;
        ui.mobileReplyDrafts[data.id] = "";
        ui.mobileReplyOpen[data.id] = false;
        showToast("补充信息已发送");
        await refresh({ force: true });
      }
    } catch (error) {
      ui.busy = false;
      showToast(error.message || "操作失败");
      render();
    }
  }

  function startAutoRefresh() {
    if (!mobileToken) return;
    scheduleAutoRefresh();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh({ force: true, silent: true }).catch(() => {});
      scheduleAutoRefresh();
    });
    window.addEventListener("focus", () => {
      refresh({ force: true, silent: true }).catch(() => {});
      scheduleAutoRefresh();
    });
    window.addEventListener("online", () => {
      refresh({ force: true, silent: true }).catch(() => {});
      scheduleAutoRefresh();
    });
  }

  function scheduleAutoRefresh() {
    clearTimeout(autoRefreshTimer);
    const delay = document.hidden ? AUTO_REFRESH_HIDDEN_MS : AUTO_REFRESH_VISIBLE_MS;
    autoRefreshTimer = setTimeout(async () => {
      try {
        await refresh({ silent: true });
      } catch {
        // Keep polling after transient tunnel or mobile network failures.
      }
      scheduleAutoRefresh();
    }, delay);
  }

  function bindServiceWorkerMessages() {
    if (!navigator.serviceWorker) return;
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.type !== "second.mobile.decision-resolved") return;
      refresh({ force: true, silent: true }).catch(() => {});
    });
  }

  function mergeLocalDecisionState(nextDecisions) {
    const previous = new Map((state.decisions || []).map((decision) => [decision.id, decision]));
    return nextDecisions.map((decision) => {
      const current = previous.get(decision.id);
      if (!current?.selectedOption || decision.status !== "pending") return decision;
      return { ...decision, selectedOption: current.selectedOption };
    });
  }

  function mobileStateSignature(nextState) {
    return JSON.stringify({
      decisions: (nextState.decisions || []).map((decision) => ({
        id: decision.id,
        status: decision.status,
        selectedOption: decision.selectedOption || "",
        decidedAt: decision.decidedAt || "",
        title: decision.title || "",
        summary: decision.summary || "",
        optionIds: (decision.options || []).map((option) => option.id),
        replyCount: decision.replyCount || 0,
      })),
      push: {
        paired: Boolean(nextState.integrations?.mobilePwa?.paired),
        subscriptionCount: Number(nextState.integrations?.mobilePwa?.subscriptionCount || 0),
      },
    });
  }

  function render() {
    root.innerHTML = `
      ${view.render(state, ui, MobilePwa.supported?.(), { surface: "handset" })}
      ${toast ? `<div class="toast">${escapeHtml(toast)}</div>` : ""}
    `;
    MobileView.enhanceCarousels?.(root);
    focusReplyDraft();
  }

  async function api(url, options = {}) {
    const init = { ...options };
    init.headers = { ...(init.headers || {}) };
    if (mobileToken) init.headers.Authorization = `Bearer ${mobileToken}`;
    if (init.body && typeof init.body !== "string") {
      init.headers = { "Content-Type": "application/json", ...init.headers };
      init.body = JSON.stringify(init.body);
    }
    if (!init.method || String(init.method).toUpperCase() === "GET") init.cache = init.cache || "no-store";
    if (ApiClient.request) return ApiClient.request(url, init);
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function showToast(message) {
    toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = "";
      render();
    }, 2400);
    render();
  }

  function brandMark(className = "") {
    return `<span class="${escapeAttr(className)} mobile-brand-mark" aria-hidden="true"><img src="/logo.svg" alt="" /></span>`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => (
      {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[char]
    ));
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function consumePairingToken() {
    const key = "second.mobile.token";
    try {
      const params = new URLSearchParams(window.location.search);
      const pair = params.get("pair") || params.get("token");
      if (pair) {
        window.localStorage.setItem(key, pair);
        if (isStandaloneDisplay()) {
          params.delete("pair");
          params.delete("token");
          const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}${window.location.hash || ""}`;
          window.history.replaceState({}, "", next);
        }
        return pair;
      }
      return window.localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function initialDecisionTarget() {
    try {
      const params = new URLSearchParams(window.location.search);
      return {
        id: params.get("decision") || "",
        compose: params.get("compose") === "1",
      };
    } catch {
      return { id: "", compose: false };
    }
  }

  function focusReplyDraft() {
    const id = ui.mobileReplyFocusId;
    if (!id) return;
    ui.mobileReplyFocusId = "";
    requestAnimationFrame(() => {
      root.querySelector(`[data-mobile-reply-field][data-id="${cssEscape(id)}"]`)?.focus();
    });
  }

  function syncReplySendButton(id, value) {
    const button = root.querySelector(`[data-action="mobile-send-decision-reply"][data-id="${cssEscape(id)}"]`);
    if (!button) return;
    button.disabled = ui.busy === `mobile-reply-${id}` || !String(value || "").trim();
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
    return String(value || "").replace(/["\\]/g, "\\$&");
  }

  function configureManifest(token) {
    if (!token) return;
    const href = `/api/mobile/manifest.webmanifest?pair=${encodeURIComponent(token)}`;
    let link = document.querySelector('link[rel="manifest"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "manifest";
      document.head.appendChild(link);
    }
    link.href = href;
  }

  function pairedMobileLink() {
    if (!mobileToken) return window.location.href;
    return `${window.location.origin}/mobile.html?pair=${encodeURIComponent(mobileToken)}`;
  }

  function isStandaloneDisplay() {
    return Boolean(window.navigator?.standalone) || Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches);
  }
})();
