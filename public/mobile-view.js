(function initSecondMobileView(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondMobileView = api;
  if (typeof window === "object") window.SecondMobileView = api;
  if (typeof globalThis === "object") globalThis.SecondMobileView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondMobileView() {
  "use strict";

  function createMobileView(deps = {}) {
    const {
      PRODUCT_NAME = "Second",
      brandMark = () => "",
      escapeAttr = escapeHtmlAttribute,
      escapeHtml = escapeHtmlText,
      relativeTime = () => "",
    } = deps;

    function render(state = {}, ui = {}, support = null, options = {}) {
      const mode = options.surface || "console";
      if (state.mobilePairingRequired) {
        const content = pairingRequiredContent();
        if (mode === "handset") return handsetPage(content);
        return consolePhonePreview(state, ui, support || {}, content);
      }
      const pending = (state.decisions || []).filter((item) => item.status === "pending");
      const recent = (state.decisions || []).filter((item) => item.status !== "pending").slice(0, 4);
      const push = state.integrations?.mobilePwa || {};
      const status = support || {};
      const content = handsetContent({ pending, recent, push, status, ui });
      if (mode === "handset") return handsetPage(content);
      return `
        ${consolePhonePreview(state, ui, status, content)}
      `;
    }

    function consolePhonePreview(state, ui, status, content) {
      const pendingCount = (state.decisions || []).filter((item) => item.status === "pending").length;
      const push = state.integrations?.mobilePwa || {};
      const publicAccess = state.integrations?.publicAccess || {};
      const notifyLabel = push.subscriptionCount ? "已订阅" : push.paired ? "未订阅" : "未配对";
      return `
        <div class="page mobile-decision-page">
          <div class="content-wide mobile-console-layout">
            <section class="mobile-console-brief">
              <div class="section-label">消息端</div>
              <h1>手机决策端</h1>
              <p>这里预览手机上看到的 Second 决策遥控器。系统通知负责唤醒和直达决策；打开后的按钮会走真实接口，可以选方案、批准、拒绝、补充和查看证据包。</p>
              <div class="mobile-console-metrics">
                <div><b>${pendingCount}</b><span>待决策</span></div>
                <div><b>${push.subscriptionCount || 0}</b><span>订阅设备</span></div>
                <div><b>${notifyLabel}</b><span>通知状态</span></div>
              </div>
              <div class="mobile-console-actions">
                <button class="btn btn-primary" data-action="mobile-copy-pairing-link">复制配对链接</button>
                <button class="btn" data-action="mobile-push-test" ${ui.busy === "mobile-push-test" ? "disabled" : ""}>测试通知</button>
              </div>
              ${subscriptionDeviceList(push, ui)}
              ${publicAccessNotice(publicAccess)}
              ${pairingCard(ui, publicAccess)}
            </section>

            <section class="mobile-phone-stage" aria-label="手机端内容预览">
              <div class="mobile-phone-device">
                <div class="mobile-phone-speaker" aria-hidden="true"></div>
                <div class="mobile-phone-screen">
                  <div class="mobile-phone-statusbar" aria-hidden="true">
                    <span>9:41</span>
                    <span>Second</span>
                  </div>
                  <div class="mobile-phone-scroll">
                    ${notificationCenterPreview(state)}
                    ${content}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      `;
    }

    function publicAccessNotice(publicAccess = {}) {
      const ready = Boolean(publicAccess.enabled && publicAccess.activeUrl);
      return `
        <section class="mobile-public-access-card ${ready ? "ready" : ""}" aria-label="手机公网通道">
          <div>
            <b>手机公网通道</b>
            <span>${ready ? "二维码将使用已打开的公网地址。" : "手机决策端需要先打开公网通道。"}</span>
          </div>
          <button class="btn" data-action="nav" data-view="settings">${ready ? "查看设置" : "去设置"}</button>
          ${ready ? `<code>${escapeHtml(publicAccess.activeUrl)}</code>` : ""}
        </section>
      `;
    }

    function notificationCenterPreview(state = {}) {
      const decision = (state.decisions || []).find((item) => item.status === "pending");
      if (!decision) {
        return `
          <section class="mobile-notification-center" aria-label="通知中心预览">
            <div class="mobile-lock-date">今天</div>
            <div class="mobile-lock-time">9:41</div>
            <article class="mobile-lock-notification progress">
              <div class="mobile-lock-head">
                <div class="mobile-lock-app">
                  ${brandMark("notification-mark")}
                  <b>Second · 任务进度</b>
                </div>
                <span>现在</span>
              </div>
              <p>当前没有待处理决策，新的请求会直接出现在这里。</p>
            </article>
          </section>
        `;
      }
      const title = notificationDecisionTitle(decision);
      const meta = notificationMetaLine(decision);
      const actionMode = notificationActionMode(state);
      return `
        <section class="mobile-notification-center" aria-label="通知中心预览">
          <div class="mobile-lock-date">今天</div>
          <div class="mobile-lock-time">9:41</div>
          <article class="mobile-lock-notification decision">
            <div class="mobile-lock-head">
              <div class="mobile-lock-app">
                ${brandMark("notification-mark")}
                <b>Second · 决策请求</b>
              </div>
              <span>现在</span>
            </div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(meta)}</p>
            ${actionMode.actions ? `
              <div class="mobile-lock-actions">
                <button class="mobile-lock-action primary" data-action="mobile-resolve-decision" data-id="${escapeAttr(decision.id)}" data-verdict="approved">批准</button>
                <button class="mobile-lock-action secondary" data-action="mobile-resolve-decision" data-id="${escapeAttr(decision.id)}" data-verdict="rejected">拒绝</button>
              </div>
              <div class="mobile-lock-hint"><b>补充更多</b><span>点开通知后在决策卡片里发送补充信息。</span></div>
            ` : `
              <div class="mobile-lock-hint"><b>点开处理</b><span>${escapeHtml(actionMode.reason)}</span></div>
            `}
          </article>
        </section>
      `;
    }

    function subscriptionDeviceList(push = {}, ui = {}) {
      const subscriptions = Array.isArray(push.subscriptions) ? push.subscriptions : [];
      return `
        <section class="mobile-device-card" aria-label="订阅设备">
          <div class="mobile-device-head">
            <div>
              <b>订阅设备</b>
              <span>${subscriptions.length ? `${subscriptions.length} 台设备可接收系统通知` : "暂无已订阅设备"}</span>
            </div>
          </div>
          ${subscriptions.length ? `
            <div class="mobile-device-list">
              ${subscriptions.map((device) => `
                <article class="mobile-device-row">
                  <div>
                    <strong>${escapeHtml(device.label || "移动设备")}</strong>
                    <span>${escapeHtml(subscriptionCapabilityLine(device))}</span>
                  </div>
                  <button class="btn mobile-device-delete" data-action="mobile-delete-subscription" data-id="${escapeAttr(device.id)}" ${ui.busy === `mobile-delete-${device.id}` ? "disabled" : ""}>删除</button>
                </article>
              `).join("")}
            </div>
          ` : `<div class="mobile-device-empty">手机启用通知后会出现在这里。</div>`}
        </section>
      `;
    }

    function pairingCard(ui = {}, publicAccess = {}) {
      const url = ui.mobilePairingUrl || "";
      const qr = ui.mobilePairingQrSvg || "";
      const accessReady = Boolean(publicAccess.enabled && publicAccess.activeUrl);
      return `
        <div class="mobile-pairing-card">
          <div class="mobile-pairing-card-head">
            <div>
              <b>扫码配对</b>
              <span>${ui.mobilePairingLoading ? "正在生成二维码" : url ? "用手机相机扫描后在浏览器打开" : "生成手机可打开的配对链接"}</span>
            </div>
            <button class="btn" data-action="mobile-refresh-pairing" ${ui.mobilePairingLoading ? "disabled" : ""}>刷新</button>
          </div>
          <div class="mobile-qr-frame">
            ${qr || `<div class="mobile-qr-placeholder">${ui.mobilePairingLoading ? "生成中" : "等待二维码"}</div>`}
          </div>
          ${url ? `<div class="mobile-pairing-url">${escapeHtml(url)}</div>` : ""}
          ${ui.mobilePairingError ? `<div class="mobile-pairing-error">${escapeHtml(ui.mobilePairingError)}</div>` : ""}
          ${!accessReady ? `<div class="mobile-pairing-hint">手机决策端依赖公网通道。请先在设置页打开 Cloudflared 或填写手动公网链接，再刷新二维码。</div>` : ""}
          ${url && isLoopbackPairingUrl(url) ? `<div class="mobile-pairing-hint">当前二维码指向本机地址。手机扫码前，请设置公开服务地址或用手机可访问的 LAN IP / HTTPS 地址打开控制台后再刷新二维码。</div>` : ""}
          ${url && !isLoopbackPairingUrl(url) ? `<div class="mobile-pairing-ok">二维码已使用公开服务地址，手机相机扫码后会在浏览器打开配对页。</div>` : ""}
        </div>
      `;
    }

    function handsetPage(content) {
      return `
        <div class="page mobile-decision-page mobile-handset-page">
          <div class="content-med mobile-handset-content">
            ${content}
          </div>
        </div>
      `;
    }

    function handsetContent({ pending, recent, push, status, ui }) {
      return `
        <div class="mobile-app-surface">
          <div class="mobile-sticky-top">
            <header class="mobile-app-titlebar">
              <div class="mobile-app-identity">
                ${brandMark("mini-mark")}
                <div>
                  <strong>${escapeHtml(PRODUCT_NAME)}</strong>
                  <span>决策遥控器</span>
                </div>
              </div>
              <div class="mobile-app-counter">
                <b>${pending.length}</b>
                <span>待处理</span>
              </div>
            </header>
            ${settingsBar({ push, status, ui })}
          </div>

          <section class="mobile-decision-list">
            <div class="mobile-section-head">
              <h2>待决策</h2>
              <span>${pending.length} 条</span>
            </div>
            ${decisionCarousel("pending", pending, true, ui, emptyState())}
          </section>

          <section class="mobile-decision-list secondary">
            <div class="mobile-section-head">
              <h2>最近处理</h2>
              <span>${recent.length} 条</span>
            </div>
            ${decisionCarousel("recent", recent, false, ui, `<article class="mobile-decision-card mobile-empty mobile-empty-card small"><b>暂无历史决策</b><span>处理后的结果会保留在这里。</span></article>`)}
          </section>
        </div>
      `;
    }

    function settingsBar({ push, status, ui }) {
      const paired = push.paired ? "已配对" : "未配对";
      const subscribed = push.subscriptionCount ? "已订阅" : "未订阅";
      return `
        <section class="mobile-settings-bar" aria-label="通知设置">
          <div class="mobile-settings-copy">
            <b>系统通知</b>
            <span>${escapeHtml(settingsStatusLine(status, push))}</span>
            <div class="mobile-settings-badges">
              <span class="${push.paired ? "connected" : ""}">${paired}</span>
              <span class="${push.subscriptionCount ? "connected" : ""}">${subscribed}</span>
            </div>
          </div>
          <div class="mobile-settings-actions">
            <button class="mobile-settings-action primary" data-action="mobile-push-subscribe" ${ui.busy === "mobile-push" || status.available === false || status.permission === "denied" ? "disabled" : ""}>启用</button>
            <button class="mobile-settings-action" data-action="mobile-push-test" ${ui.busy === "mobile-push-test" ? "disabled" : ""}>测试</button>
            <button class="mobile-settings-action" data-action="mobile-copy-pairing-link">链接</button>
            <button class="mobile-settings-action" data-action="mobile-push-unsubscribe" ${ui.busy === "mobile-push" ? "disabled" : ""}>取消</button>
          </div>
          ${pushHelp(status)}
        </section>
      `;
    }

    function decisionCarousel(id, decisions, pending, ui, emptyHtml) {
      const list = decisions.length ? decisions.map((decision) => decisionCard(decision, pending, ui)) : [emptyHtml];
      return `
        <div class="mobile-card-carousel" data-mobile-carousel="${escapeAttr(id)}">
          ${list.join("")}
        </div>
        ${carouselDots(id, list.length)}
      `;
    }

    function carouselDots(id, count) {
      if (count <= 1) return `<div class="mobile-carousel-dots single" data-mobile-carousel-dots="${escapeAttr(id)}"><span class="mobile-carousel-dot active" aria-hidden="true"></span></div>`;
      return `
        <div class="mobile-carousel-dots" data-mobile-carousel-dots="${escapeAttr(id)}" aria-label="卡片位置">
          ${Array.from({ length: count }, (_, index) => `
            <button class="mobile-carousel-dot ${index === 0 ? "active" : ""}" type="button" data-mobile-carousel-index="${index}" aria-label="第 ${index + 1} 张"></button>
          `).join("")}
        </div>
      `;
    }

    function pairingRequiredContent() {
      return `
        <div class="mobile-pairing-required">
          ${brandMark("mini-mark")}
          <h1>需要配对</h1>
          <p>请先在桌面 Second 控制台的“消息端”页面点击“复制配对链接”，再用手机打开该链接。配对后本机只保存一个移动端 token，不会加载完整控制台状态。</p>
        </div>
      `;
    }

    function decisionCard(decision, pending, ui = {}) {
      const options = Array.isArray(decision.options) ? decision.options.slice(0, 4) : [];
      const selected = decision.selectedOption || options[0]?.id || "";
      const expanded = Boolean(ui.mobileExpanded?.[decision.id] || decision.expanded);
      const replyOpen = Boolean(ui.mobileReplyOpen?.[decision.id]);
      return `
        <article class="mobile-decision-card ${pending ? "pending" : "resolved"}">
          <div class="mobile-card-top">
            <span class="pill ${riskClass(decision.risk)}">${escapeHtml(decision.risk || "中")}风险</span>
            <span class="mobile-card-time">${escapeHtml(decision.createdAt ? relativeTime(decision.createdAt) : "")}</span>
          </div>
          <div class="mobile-card-detail" tabindex="0" aria-label="决策详情">
            <h3>${escapeHtml(decision.title || decision.id)}</h3>
            <p>${escapeHtml(decision.summary || "分身需要你确认后才能继续。")}</p>
            <div class="mobile-card-meta">
              ${[decision.taskId, decision.agent, decision.source].filter(Boolean).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
            </div>
            ${pending && options.length ? `
              <div class="mobile-option-list">
                ${options.map((option) => `
                  <button class="mobile-option ${option.id === selected ? "selected" : ""}" data-action="select-option" data-id="${escapeAttr(decision.id)}" data-option="${escapeAttr(option.id)}" ${pending ? "" : "disabled"}>
                    <b>${escapeHtml(option.label || option.id)}</b>
                    <span>${escapeHtml(option.description || "")}</span>
                  </button>
                `).join("")}
              </div>
            ` : ""}
            ${pending && replyOpen ? replyComposer(decision, ui) : ""}
            ${expanded ? evidenceDrawer(decision) : ""}
          </div>
          ${pending ? `
            <div class="mobile-card-actions">
              <button class="btn btn-primary" data-action="mobile-resolve-decision" data-id="${escapeAttr(decision.id)}" data-verdict="approved">批准</button>
              <button class="btn" data-action="mobile-resolve-decision" data-id="${escapeAttr(decision.id)}" data-verdict="rejected">拒绝</button>
              <button class="btn" data-action="mobile-toggle-reply" data-id="${escapeAttr(decision.id)}">${replyOpen ? "收起补充" : "补充更多"}</button>
              <button class="btn" data-action="mobile-toggle-decision" data-id="${escapeAttr(decision.id)}">${expanded ? "收起" : "证据包"}</button>
            </div>
          ` : `
            <div class="mobile-card-actions resolved">
              <div class="mobile-resolved-line">${escapeHtml(decision.status === "approved" ? "已批准" : decision.status === "rejected" ? "已拒绝" : decision.status || "已处理")}</div>
              <button class="btn" data-action="mobile-toggle-decision" data-id="${escapeAttr(decision.id)}">${expanded ? "收起" : "证据包"}</button>
            </div>
          `}
        </article>
      `;
    }

    function replyComposer(decision, ui = {}) {
      const draft = ui.mobileReplyDrafts?.[decision.id] || "";
      const busy = ui.busy === `mobile-reply-${decision.id}`;
      return `
        <div class="mobile-reply-composer">
          <label for="mobile-reply-${escapeAttr(decision.id)}">补充给分身的信息</label>
          <textarea id="mobile-reply-${escapeAttr(decision.id)}" data-mobile-reply-field data-id="${escapeAttr(decision.id)}" rows="3" placeholder="补充约束、凭证位置、下一步要求...">${escapeHtml(draft)}</textarea>
          <div class="mobile-reply-actions">
            <button class="btn btn-primary" data-action="mobile-send-decision-reply" data-id="${escapeAttr(decision.id)}" ${busy || !String(draft).trim() ? "disabled" : ""}>发送给智能体</button>
          </div>
        </div>
      `;
    }

    function evidenceDrawer(decision) {
      const impact = Array.isArray(decision.impact) ? decision.impact.slice(0, 5) : [];
      const artifacts = Array.isArray(decision.artifacts) ? decision.artifacts.slice(0, 4) : [];
      return `
        <div class="mobile-evidence-drawer">
          <div class="mobile-evidence-title">证据包</div>
          ${impact.length ? `
            <ul>
              ${impact.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
            </ul>
          ` : `<p>暂无额外影响说明。</p>`}
          ${artifacts.length ? `
            <div class="mobile-evidence-artifacts">
              ${artifacts.map((item) => `<span>${escapeHtml(artifactLabel(item))}</span>`).join("")}
            </div>
          ` : ""}
          <div class="mobile-evidence-foot">补充回复 ${Number(decision.replyCount || 0)} 条</div>
        </div>
      `;
    }

    function artifactLabel(artifact) {
      if (typeof artifact === "string") return artifact;
      return artifact?.label || artifact?.path || artifact?.url || artifact?.type || "artifact";
    }

    function notificationDecisionTitle(decision = {}) {
      const risk = decision.risk || "中";
      return truncateText(`${decision.title || decision.id || "新的决策请求"} · ${risk}风险`, 34);
    }

    function notificationMetaLine(decision = {}) {
      return truncateText(
        [decision.taskId, decision.summary, decision.agent || decision.source].filter(Boolean).join(" · ") ||
          "分身需要你确认后才能继续。",
        58,
      );
    }

    function notificationActionMode(state = {}) {
      const subscriptions = state.integrations?.mobilePwa?.subscriptions || [];
      if (subscriptions.some((device) => device.notificationActions)) {
        return { actions: true, reason: "当前订阅设备支持系统通知按钮。" };
      }
      return {
        actions: false,
        reason: "iPhone 的 PWA 系统通知通常只显示文字；点开后可批准、拒绝或补充更多。",
      };
    }

    function subscriptionCapabilityLine(device = {}) {
      const host = device.endpointHost || "push service";
      const seen = device.lastSeenAt ? relativeTime(device.lastSeenAt) : device.createdAt ? relativeTime(device.createdAt) : "未知时间";
      const mode = device.notificationActions ? "支持通知按钮" : "点开后处理";
      return `${host} · ${seen} · ${mode}`;
    }

    function truncateText(value, maxLength) {
      const text = String(value || "").replace(/\s+/g, " ").trim();
      if (text.length <= maxLength) return text;
      return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
    }

    function emptyState() {
      return `
        <article class="mobile-decision-card mobile-empty mobile-empty-card">
          <b>没有待决策</b>
          <span>新的 Human Gate 决策会通过 Web Push 触发手机系统通知。</span>
        </article>
      `;
    }

    return {
      render,
    };
  }

  function pushCapabilityText(status = {}, push = {}) {
    if (!push.paired) return "请先用桌面消息端二维码完成配对。";
    if (status.available) {
      if (status.permission === "granted") return "当前浏览器已授权通知。iOS 需要从主屏幕打开 PWA，Android 可直接订阅。";
      if (status.permission === "denied") return "系统通知权限已被拒绝，请在浏览器或系统设置中恢复。";
      return "点击启用通知后，浏览器会请求系统通知权限。";
    }
    return status.reason || "PWA Push 需要 HTTPS、Service Worker、Push API 和系统通知权限。";
  }

  function settingsStatusLine(status = {}, push = {}) {
    const count = Number(push.subscriptionCount || 0);
    if (!push.paired) return "等待配对";
    if (status.permission === "denied") return `${count ? "已订阅" : "未订阅"} · 权限被拒绝`;
    if (status.permission === "granted") return `${count ? "已启用" : "可订阅"} · ${count} 台设备`;
    if (status.available) return `${count ? "已订阅" : "未订阅"} · 待授权`;
    if (status.ios && status.standalone === false) return "需从主屏幕打开";
    return count ? `已订阅 · ${count} 台设备` : "等待启用";
  }

  function pushHelp(status = {}) {
    if (status.available) return "";
    if (status.ios && status.standalone === false) {
      return `
        <div class="mobile-setup-help">
          <b>iPhone 需要先添加到主屏幕</b>
          <ol>
            <li>在 Safari 打开当前配对页。</li>
            <li>点分享按钮，选择“添加到主屏幕”。</li>
            <li>从主屏幕 Second 图标重新打开，再点“启用通知”。</li>
          </ol>
        </div>
      `;
    }
    return "";
  }

  function riskClass(risk) {
    if (risk === "高") return "risk-high";
    if (risk === "低") return "risk-low";
    return "kind-amber";
  }

  function isLoopbackPairingUrl(url) {
    try {
      const host = new URL(url).hostname;
      return host === "localhost" || host === "127.0.0.1" || host === "::1";
    } catch {
      return false;
    }
  }

  function escapeHtmlText(value) {
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

  function escapeHtmlAttribute(value) {
    return escapeHtmlText(value);
  }

  function enhanceCarousels(root = document) {
    const scope = root || document;
    const carousels = scope.querySelectorAll?.("[data-mobile-carousel]") || [];
    for (const carousel of carousels) {
      if (carousel.dataset.mobileCarouselReady === "true") continue;
      carousel.dataset.mobileCarouselReady = "true";
      const dots = scope.querySelector(`[data-mobile-carousel-dots="${carousel.dataset.mobileCarousel}"]`);
      const dotItems = Array.from(dots?.querySelectorAll("[data-mobile-carousel-index]") || []);
      if (!dotItems.length) continue;

      const update = () => {
        const width = Math.max(1, carousel.clientWidth);
        const index = Math.max(0, Math.min(dotItems.length - 1, Math.round(carousel.scrollLeft / width)));
        dotItems.forEach((dot, dotIndex) => {
          dot.classList.toggle("active", dotIndex === index);
          dot.setAttribute("aria-current", dotIndex === index ? "true" : "false");
        });
      };
      let frame = 0;
      carousel.addEventListener("scroll", () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(update);
      }, { passive: true });
      dotItems.forEach((dot, index) => {
        dot.addEventListener("click", () => {
          carousel.scrollTo({ left: carousel.clientWidth * index, behavior: "smooth" });
        });
      });
      update();
    }
  }

  return {
    createMobileView,
    enhanceCarousels,
  };
});
