(() => {
  const app = document.getElementById("app");
  const UiStore = globalThis.SecondUiStore || window.SecondUiStore || {};
  const ApiClient = globalThis.SecondApiClient || window.SecondApiClient || {};
  const Presentation = globalThis.SecondPresentation || window.SecondPresentation || {};
  const AuthView = globalThis.SecondAuthView || window.SecondAuthView || {};
  const InboxView = globalThis.SecondInboxView || window.SecondInboxView || {};
  const MobileView = globalThis.SecondMobileView || window.SecondMobileView || {};
  const TaskTraceFormat = globalThis.SecondTaskTraceFormat || window.SecondTaskTraceFormat || {};
  const TaskTraceSourceView = globalThis.SecondTaskTraceSourceView || window.SecondTaskTraceSourceView || {};
  const TaskTraceAgentView = globalThis.SecondTaskTraceAgentView || window.SecondTaskTraceAgentView || {};
  const RuntimeView = globalThis.SecondRuntimeView || window.SecondRuntimeView || {};
  const TaskTraceView = globalThis.SecondTaskTraceView || window.SecondTaskTraceView || {};
  const SettingsView = globalThis.SecondSettingsView || window.SecondSettingsView || {};
  const Profile = globalThis.SecondProfile || window.SecondProfile || {};
  const ShellView = globalThis.SecondShellView || window.SecondShellView || {};
  const RenderSignature = globalThis.SecondRenderSignature || window.SecondRenderSignature || {};
  const SlackSettings = globalThis.SecondSlackSettings || window.SecondSlackSettings || {};
  const Actions = globalThis.SecondActions || window.SecondActions || {};
  const ui = UiStore.createInitialState
    ? UiStore.createInitialState()
    : {
        view: "inbox",
        selectedDecision: null,
        selectedTask: null,
        execOpen: {},
        sessionOpen: {},
        toast: null,
        taskPrompt: "",
        taskWorkspace: "",
        slackForm: null,
        slackManifest: "",
        profilePanel: false,
        profileForm: null,
        replyDrafts: {},
        busy: false,
      };
  let state = null;
  let toastTimer = null;
  let lastRenderedView = null;
  let lastRenderSignature = "";
  let scheduledRender = false;
  const PRODUCT_NAME = "Second";
  const TraceCore = globalThis.SecondTrace || window.SecondTrace || {};
  const PRODUCT_LOGO_SOURCES = TraceCore.PRODUCT_LOGO_SOURCES || {};
  const DEFAULT_SOURCE_CHANNEL = TraceCore.DEFAULT_SOURCE_CHANNEL || {};
  const {
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
    taskStatus,
    toolColor,
    uptime,
  } = Presentation;
  const {
    niceAvatarDataUrl,
    profileAvatarMarkup,
    profileFormFromState: buildProfileFormFromState,
    randomNiceAvatarConfig,
    randomProfileSeed,
  } = Profile;
  const {
    channelMetaParts,
    latestSlackStatus,
    slackFormFromPublic,
  } = SlackSettings;

  const shellView = ShellView.createShellView({
    PRODUCT_NAME,
    escapeAttr,
    escapeHtml,
    niceAvatarDataUrl,
    profileAvatarMarkup,
  });
  const authViewRenderer = AuthView.createAuthView({
    escapeAttr,
    escapeHtml,
  });
  const inboxViewRenderer = InboxView.createInboxView({
    decisionStatus,
    emptyPage: (title, message) => shellView.emptyPage(title, message),
    escapeAttr,
    escapeHtml,
    relativeTime,
    riskClass,
  });
  const mobileViewRenderer = MobileView.createMobileView({
    PRODUCT_NAME,
    brandMark,
    escapeAttr,
    escapeHtml,
  });
  const settingsViewRenderer = SettingsView.createSettingsView({
    PRODUCT_NAME,
    PRODUCT_LOGO_SOURCES,
    channelMetaParts,
    engineColor,
    engineStatus,
    escapeAttr,
    escapeHtml,
    latestSlackStatus,
    relativeTime,
  });
  const taskTraceFormat = TaskTraceFormat.createTaskTraceFormat
    ? TaskTraceFormat.createTaskTraceFormat({ PRODUCT_NAME })
    : {};
  const taskTraceSourceView = TaskTraceSourceView.createTaskTraceSourceView
    ? TaskTraceSourceView.createTaskTraceSourceView({
        TraceCore,
        DEFAULT_SOURCE_CHANNEL,
        actorStyle,
        escapeAttr,
        escapeHtml,
        relativeTime,
      })
    : {};
  const taskTraceAgentView = TaskTraceAgentView.createTaskTraceAgentView
    ? TaskTraceAgentView.createTaskTraceAgentView({
        TraceCore,
        actorStyle,
        displayTraceEvent: (ev, task) => taskTraceViewRenderer.displayTraceEvent(ev, task),
        escapeAttr,
        escapeHtml,
        getUi: () => ui,
        relativeTime,
        traceFormat: taskTraceFormat,
      })
    : {};
  const taskTraceViewRenderer = TaskTraceView.createTaskTraceView({
    PRODUCT_NAME,
    TraceCore,
    DEFAULT_SOURCE_CHANNEL,
    agentView: taskTraceAgentView,
    actorStyle,
    emptyPage: (title, message) => shellView.emptyPage(title, message),
    escapeAttr,
    escapeHtml,
    eventKindClass,
    normalizeExec,
    relativeTime,
    sourceView: taskTraceSourceView,
    taskStatus,
    traceFormat: taskTraceFormat,
    toolColor,
  });
  const runtimeViewRenderer = RuntimeView.createRuntimeView({
    PRODUCT_NAME,
    agentEventsForTask: taskTraceViewRenderer.agentEventsForTask,
    displayEventLogText: taskTraceViewRenderer.displayEventLogText,
    displayTraceEvent: taskTraceViewRenderer.displayTraceEvent,
    escapeAttr,
    escapeHtml,
    eventColor,
    eventKindClass,
    relativeTime,
    shortKind,
    taskStatus,
    uptime,
  });

  const handleAction = Actions.createActionHandler({
    PRODUCT_NAME,
    UiStore,
    api,
    app,
    cssEscape,
    currentProfileForm,
    currentSlackForm,
    getState: () => state,
    profileFormFromState,
    randomNiceAvatarConfig,
    randomProfileSeed,
    refresh,
    render,
    showToast,
    slackFormFromPublic,
    ui,
    updateProfileModalPreview,
  });

  app.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    event.preventDefault();
    handleAction(target.dataset, target);
  });

  app.addEventListener("input", (event) => {
    if (event.target.matches("[data-field='taskPrompt']")) ui.taskPrompt = event.target.value;
    if (event.target.matches("[data-field='taskWorkspace']")) ui.taskWorkspace = event.target.value;
    if (event.target.matches("[data-slack-field]")) {
      const form = currentSlackForm();
      form[event.target.dataset.slackField] =
        event.target.type === "checkbox" ? event.target.checked : event.target.value;
    }
    if (event.target.matches("[data-profile-field]")) {
      const form = currentProfileForm();
      form[event.target.dataset.profileField] = event.target.value;
      updateProfileModalPreview();
    }
    if (event.target.matches("[data-reply-field]")) {
      ui.replyDrafts[event.target.dataset.decisionId] = event.target.value;
    }
  });

  app.addEventListener("change", (event) => {
    if (event.target.matches("[data-slack-field]")) {
      const form = currentSlackForm();
      form[event.target.dataset.slackField] =
        event.target.type === "checkbox" ? event.target.checked : event.target.value;
      render();
    }
    if (event.target.matches("[data-profile-field]")) {
      const form = currentProfileForm();
      form[event.target.dataset.profileField] = event.target.value;
      updateProfileModalPreview();
    }
  });

  init();

  async function init() {
    await refresh();
    connectEvents();
  }

  async function refresh() {
    state = await api("/api/state");
    if (!ui.slackForm) ui.slackForm = slackFormFromState();
    reconcileSelection();
    render();
  }

  function connectEvents() {
    const stream = ApiClient.createStateStream ? ApiClient.createStateStream("/api/events") : null;
    if (!stream) return;
    stream.addEventListener("state", (event) => {
      const payload = JSON.parse(event.data);
      applyStateUpdate(payload.state || payload);
    });
  }

  function applyStateUpdate(nextState) {
    const previousState = state;
    state = nextState;
    reconcileSelection();
    if (!shouldRenderStateUpdate(previousState, nextState)) return;
    scheduleRender();
  }

  function reconcileSelection() {
    if (!state) return;
    if (!state.decisions.some((item) => item.id === ui.selectedDecision)) ui.selectedDecision = state.decisions[0]?.id || null;
    if (!state.tasks.some((item) => item.id === ui.selectedTask)) ui.selectedTask = state.tasks[0]?.id || null;
  }

  function scheduleRender() {
    if (scheduledRender) return;
    scheduledRender = true;
    requestAnimationFrame(() => {
      scheduledRender = false;
      render();
    });
  }

  function shouldRenderStateUpdate(previousState, nextState) {
    if (!previousState || !nextState) return true;
    if (ui.profilePanel) return false;
    return renderSignature(nextState) !== lastRenderSignature;
  }

  function renderSignature(nextState) {
    return RenderSignature.renderSignature
      ? RenderSignature.renderSignature(nextState, ui, currentProfileForm)
      : JSON.stringify(nextState || {});
  }

  function render() {
    const restore = captureScrollState();
    if (!state) {
      app.innerHTML = `<div class="app"><main class="page">加载 ${PRODUCT_NAME} daemon...</main></div>`;
      lastRenderedView = ui.view;
      return;
    }
    app.innerHTML = `
      <div class="app">
        ${sidebar()}
        <main class="main">${mainView()}</main>
        ${ui.profilePanel ? profileSettingsModal() : ""}
        ${ui.toast ? `<div class="toast">${escapeHtml(ui.toast)}</div>` : ""}
      </div>
    `;
    restoreScrollState(restore);
    lastRenderedView = ui.view;
    lastRenderSignature = renderSignature(state);
  }

  function captureScrollState() {
    if (lastRenderedView !== ui.view) return null;
    const scrollTop = {};
    for (const selector of [".main", ".page", ".list-pane", ".detail-pane", ".scroll-list"]) {
      const element = app.querySelector(selector);
      if (element) scrollTop[selector] = element.scrollTop || 0;
    }
    return {
      view: ui.view,
      scrollTop,
    };
  }

  function restoreScrollState(snapshot) {
    if (!snapshot || snapshot.view !== ui.view) return;
    requestAnimationFrame(() => {
      for (const [selector, top] of Object.entries(snapshot.scrollTop || {})) {
        const element = app.querySelector(selector);
        if (element) element.scrollTop = top;
      }
    });
  }

  function sidebar() {
    return shellView.sidebar(state, ui);
  }

  function profileSettingsModal() {
    return shellView.profileSettingsModal(currentProfileForm(), ui);
  }

  function brandMark(className) {
    return shellView.brandMark(className);
  }

  function mainView() {
    if (ui.view === "tasks") return tasksView();
    if (ui.view === "runtime") return runtimeView();
    if (ui.view === "auth") return authView();
    if (ui.view === "mobile") return mobileView();
    if (ui.view === "settings") return settingsView();
    return inboxView();
  }

  function inboxView() {
    return inboxViewRenderer.render(state, ui);
  }

  function tasksView() {
    return taskTraceViewRenderer.render(state, ui);
  }

  function runtimeView() {
    return runtimeViewRenderer.render(state, ui);
  }

  function authView() {
    return authViewRenderer.render(state);
  }

  function mobileView() {
    return mobileViewRenderer.render(state);
  }

  function settingsView() {
    return settingsViewRenderer.render(state, ui, currentSlackForm);
  }

  function currentSlackForm() {
    if (!ui.slackForm) ui.slackForm = slackFormFromState();
    return ui.slackForm;
  }

  function slackFormFromState() {
    const slack = state?.integrations?.slack || {};
    return slackFormFromPublic(slack);
  }

  function currentProfileForm() {
    if (!ui.profileForm) ui.profileForm = profileFormFromState();
    return ui.profileForm;
  }

  function profileFormFromState() {
    return buildProfileFormFromState ? buildProfileFormFromState(state?.profile || {}) : {};
  }

  function updateProfileModalPreview({ syncInputs = false } = {}) {
    if (!ui.profilePanel) return;
    const form = currentProfileForm();
    const previewUrl = niceAvatarDataUrl(form.avatarConfig, form.avatarShape);
    const previewImg = app.querySelector(".profile-avatar-large img");
    if (previewImg && previewImg.getAttribute("src") !== previewUrl) previewImg.setAttribute("src", previewUrl);

    const previewName = app.querySelector(".profile-preview-name");
    if (previewName) previewName.textContent = form.name || "用户";
    const previewRole = app.querySelector(".profile-preview-role");
    if (previewRole) previewRole.textContent = form.roleIntro || "人只做决策 · 经验永不离职";

    if (syncInputs) {
      for (const field of ["name", "roleIntro"]) {
        const input = app.querySelector(`[data-profile-field="${field}"]`);
        if (input && input !== document.activeElement && input.value !== String(form[field] || "")) {
          input.value = form[field] || "";
        }
      }
    }
  }

  async function api(url, options = {}) {
    if (ApiClient.request) return ApiClient.request(url, options);
    const init = { ...options };
    if (init.body && typeof init.body !== "string") {
      init.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
      init.body = JSON.stringify(init.body);
    }
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function showToast(message) {
    ui.toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      ui.toast = null;
      render();
    }, 2600);
    render();
  }

})();
