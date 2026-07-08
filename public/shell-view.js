(function initSecondShellView(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root?.window || root;
  if (target) target.SecondShellView = api;
  if (typeof window === "object") window.SecondShellView = api;
  if (typeof globalThis === "object") globalThis.SecondShellView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondShellView() {
  "use strict";

  const NAV = [
    {
      key: "inbox",
      label: "收件箱",
      icon: "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
    },
    {
      key: "tasks",
      label: "任务",
      icon: "M22 12h-4l-3 9L9 3l-3 9H2",
    },
    {
      key: "runtime",
      label: "运行时",
      icon: "M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 9h6v6H9z",
    },
    {
      key: "auth",
      label: "授权",
      icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    },
    {
      key: "mobile",
      label: "消息端",
      icon: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
    },
    {
      key: "settings",
      label: "设置",
      icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
    },
  ];

  function createShellView(deps = {}) {
    const {
      PRODUCT_NAME = "Second",
      escapeAttr = escapeHtmlAttribute,
      escapeHtml = escapeHtmlText,
      niceAvatarDataUrl = () => "",
      profileAvatarMarkup = () => "",
    } = deps;

    function sidebar(state = {}, ui = {}) {
      const pending = state.metrics?.pendingDecisions || 0;
      const engine = (state.engines || []).find((item) => item.id === state.settings?.defaultEngine) || (state.engines || [])[0];
      return `
        <nav class="sidebar" aria-label="${PRODUCT_NAME}">
          <div class="brand">
            ${brandMark("brand-mark")}
            <div>
              <div class="brand-title">${PRODUCT_NAME}</div>
              <div class="brand-sub">${escapeHtml(state.profile?.tagline || "")}</div>
            </div>
            <button class="mobile-settings-btn" data-action="nav" data-view="settings" aria-label="设置">
              <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${NAV.find((item) => item.key === "settings")?.icon || ""}"></path></svg>
            </button>
          </div>
          <div class="nav-list">
            ${NAV.map((item) => {
              const active = ui.view === item.key ? " active" : "";
              const badge = item.key === "inbox" && pending ? `<span class="nav-badge">${pending}</span>` : "";
              return `
                <button class="nav-item nav-${escapeAttr(item.key)}${active}" data-action="nav" data-view="${item.key}">
                  <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${item.icon}"></path></svg>
                  <span>${item.label}</span>
                  <span style="flex:1"></span>
                  ${badge}
                </button>
              `;
            }).join("")}
          </div>
          <div class="sidebar-spacer"></div>
          <div class="daemon-card">
            <div class="daemon-title"><span class="online-dot"></span>本地 daemon 在线</div>
            <div class="daemon-meta">本地分身 adapter · ${engine?.status === "ok" ? "已连接" : "待检测"}<br>heartbeat 刚刚 · run 队列 ${state.metrics?.runningTasks || 0}</div>
          </div>
          <button class="profile-row" data-action="open-profile-settings" aria-label="用户设置">
            ${profileAvatarMarkup(state.profile || {}, "avatar")}
            <div>
              <div class="profile-name">${escapeHtml(state.profile?.name || "")}</div>
              <div class="profile-meta">分身在岗 · 授权 ${(state.rules || []).length} 条</div>
            </div>
          </button>
        </nav>
      `;
    }

    function profileSettingsModal(form = {}, ui = {}) {
      const previewUrl = niceAvatarDataUrl(form.avatarConfig, form.avatarShape);
      return `
        <div class="profile-modal-backdrop" role="presentation">
          <section class="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-settings-title">
            <div class="profile-modal-head">
              <div>
                <div class="section-label">用户设置</div>
                <h2 id="profile-settings-title">资料与分身身份</h2>
              </div>
              <button class="icon-btn" data-action="close-profile-settings" aria-label="关闭">
                <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>
              </button>
            </div>

            <div class="profile-modal-body">
              <div class="profile-preview">
                <div class="profile-avatar-large"><img src="${escapeAttr(previewUrl)}" alt="" loading="lazy" decoding="async" /></div>
                <div>
                  <div class="profile-preview-name">${escapeHtml(form.name || "用户")}</div>
                  <div class="profile-preview-role">${escapeHtml(form.roleIntro || "人只做决策 · 经验永不离职")}</div>
                </div>
              </div>

              <div class="profile-form-grid">
                <label class="field">
                  <span>用户名</span>
                  <input data-profile-field="name" value="${escapeAttr(form.name)}" maxlength="60" placeholder="例如: 李哲" />
                </label>
                <label class="field">
                  <span>角色介绍</span>
                  <textarea data-profile-field="roleIntro" maxlength="160" placeholder="一句话描述这个分身如何代表你工作">${escapeHtml(form.roleIntro)}</textarea>
                </label>
              </div>

              <div class="avatar-section">
                <div class="avatar-section-head">
                  <span class="section-label">头像</span>
                  <button class="text-link" data-action="random-profile-avatar">随机头像</button>
                </div>
              </div>
            </div>

            <div class="profile-modal-actions">
              <button class="btn-plain" data-action="close-profile-settings">取消</button>
              <button class="btn btn-primary" data-action="save-profile" ${ui.busy === "profile-save" ? "disabled" : ""}>${ui.busy === "profile-save" ? "保存中..." : "保存设置"}</button>
            </div>
          </section>
        </div>
      `;
    }

    function brandMark(className) {
      return `
        <div class="${escapeAttr(className)}" aria-hidden="true">
          <svg viewBox="0 0 96 96" fill="none" focusable="false">
            <path d="M66 26C66 26 52 20 42 26C32 32 34 42 44 46L56 51" stroke="var(--accent)" stroke-width="11" stroke-linecap="round"></path>
            <path d="M40 45L52 50C62 54 64 64 54 70C44 76 30 70 30 70" stroke="var(--logo-ink)" stroke-width="11" stroke-linecap="round"></path>
          </svg>
        </div>
      `;
    }

    function emptyPage(title, message) {
      return `<div class="page"><h1>${escapeHtml(title)}</h1><div class="page-subtitle">${escapeHtml(message)}</div></div>`;
    }

    return {
      brandMark,
      emptyPage,
      profileSettingsModal,
      sidebar,
    };
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

  return {
    NAV,
    createShellView,
  };
});
