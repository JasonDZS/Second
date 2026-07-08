(function initSecondUiStore(root, factory) {
  const store = factory();
  if (typeof module === "object" && module.exports) module.exports = store;
  const target = root?.window || root;
  if (target) target.SecondUiStore = store;
  if (typeof window === "object") window.SecondUiStore = store;
  if (typeof globalThis === "object") globalThis.SecondUiStore = store;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondUiStore() {
  "use strict";

  function createInitialState(overrides = {}) {
    return {
      view: "inbox",
      selectedDecision: null,
      selectedTask: null,
      execOpen: {},
      sessionOpen: {},
      toast: null,
      taskPrompt: "",
      taskWorkspace: "",
      publicAccessForm: null,
      slackForm: null,
      slackManifest: "",
      settingsChannelConfig: null,
      assistantOpen: false,
      assistantDraft: "",
      assistantConversationId: "local-assistant",
      mobileExpanded: {},
      mobileReplyDrafts: {},
      mobileReplyOpen: {},
      mobilePairingError: "",
      mobilePairingLoading: false,
      mobilePairingQrSvg: "",
      mobilePairingUrl: "",
      mobileMockStatus: "idle",
      authLab: {
        input: "rg TODO server",
        result: null,
        error: "",
      },
      onboardingStep: 0,
      onboardingAuthLevel: "balanced",
      onboardingMobileSkipped: false,
      onboardingPushEnabled: false,
      onboardingTryPhase: 0,
      profilePanel: false,
      profileForm: null,
      replyDrafts: {},
      busy: false,
      ...overrides,
    };
  }

  function toggleFlag(map, key) {
    if (!key) return false;
    map[key] = !map[key];
    return map[key];
  }

  return {
    createInitialState,
    toggleFlag,
  };
});
