(function initSecondActions(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root || {};
  if (target) target.SecondActions = api;
  if (typeof window === "object") window.SecondActions = api;
  if (typeof globalThis === "object") globalThis.SecondActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondActions() {
  function createActionHandler(deps) {
    const {
      PRODUCT_NAME,
      MobilePwa = {},
      QrCode = {},
      UiStore = {},
      api,
      app,
      cssEscape,
      currentProfileForm,
      currentPublicAccessForm,
      currentSlackForm,
      getState,
      profileFormFromState,
      randomNiceAvatarConfig,
      randomProfileSeed,
      refresh,
      render,
      showToast,
      slackFormFromPublic,
      ui,
      updateProfileModalPreview,
    } = deps;

    return async function handleAction(data, el) {
      const state = getState();
      try {
        if (data.action === "noop") {
          return undefined;
        }
        if (data.action === "nav") {
          ui.view = data.view;
          render();
        } else if (data.action === "onboarding-start") {
          ui.onboardingStep = 1;
          render();
        } else if (data.action === "onboarding-go") {
          ui.onboardingStep = clampOnboardingStep(data.step);
          render();
        } else if (data.action === "onboarding-next") {
          ui.onboardingStep = clampOnboardingStep((ui.onboardingStep ?? 0) + 1);
          render();
        } else if (data.action === "onboarding-back") {
          ui.onboardingStep = clampOnboardingStep((ui.onboardingStep ?? 0) - 1);
          render();
        } else if (data.action === "onboarding-toggle-push") {
          ui.onboardingPushEnabled = !ui.onboardingPushEnabled;
          render();
        } else if (data.action === "onboarding-auth-level") {
          ui.onboardingAuthLevel = data.level || "balanced";
          render();
        } else if (data.action === "onboarding-skip-mobile") {
          ui.onboardingMobileSkipped = true;
          ui.onboardingPushEnabled = false;
          ui.onboardingStep = Math.max(4, clampOnboardingStep((ui.onboardingStep ?? 0) + 1));
          showToast("已跳过手机连接，可稍后在消息端完成配对");
          render();
        } else if (data.action === "open-profile-settings") {
          ui.profileForm = profileFormFromState();
          ui.profilePanel = true;
          render();
        } else if (data.action === "close-profile-settings") {
          ui.profilePanel = false;
          ui.profileForm = null;
          render();
        } else if (data.action === "random-profile-avatar") {
          const form = currentProfileForm();
          form.avatarSeed = randomProfileSeed();
          form.avatarShape = "circle";
          form.avatarConfig = randomNiceAvatarConfig ? randomNiceAvatarConfig() : form.avatarConfig;
          updateProfileModalPreview({ syncInputs: true });
        } else if (data.action === "save-profile") {
          const form = currentProfileForm();
          ui.busy = "profile-save";
          render();
          await api("/api/profile", {
            method: "POST",
            body: {
              name: form.name,
              roleIntro: form.roleIntro,
              avatarSeed: form.avatarSeed,
              avatarShape: form.avatarShape,
              avatarConfig: form.avatarConfig,
            },
          });
          ui.busy = false;
          ui.profilePanel = false;
          ui.profileForm = null;
          showToast("用户设置已保存");
          await refresh();
        } else if (data.action === "select-decision") {
          ui.selectedDecision = data.id;
          render();
        } else if (data.action === "select-task") {
          ui.selectedTask = data.id;
          render();
        } else if (data.action === "select-option") {
          await api(`/api/decisions/${encodeURIComponent(data.id)}/option`, {
            method: "POST",
            body: { optionId: data.option },
          });
          await refresh();
        } else if (data.action === "resolve-decision") {
          const decision = state.decisions.find((item) => item.id === data.id);
          await api(`/api/decisions/${encodeURIComponent(data.id)}/resolve`, {
            method: "POST",
            body: { verdict: data.verdict, optionId: decision?.selectedOption },
          });
          showToast(data.verdict === "approved" ? "已批准 · 决策经 Decision MCP 回传 runtime" : "已拒绝 · 分身将调整方案");
          await refresh();
        } else if (data.action === "prefill-decision-reply") {
          ui.replyDrafts[data.id] = ui.replyDrafts[data.id] || "请补充更多证据后再让我决策。";
          render();
          requestAnimationFrame(() => app.querySelector(`[data-reply-field][data-decision-id="${cssEscape(data.id)}"]`)?.focus());
        } else if (data.action === "send-decision-reply") {
          const message = String(ui.replyDrafts[data.id] || "").trim();
          if (!message) return showToast("先写下要补充给分身的信息");
          ui.busy = `reply-${data.id}`;
          render();
          const result = await api(`/api/decisions/${encodeURIComponent(data.id)}/reply`, {
            method: "POST",
            body: { message, resume: true },
          });
          ui.busy = false;
          ui.replyDrafts[data.id] = "";
          showToast(
            result.resume === "started"
              ? "已发送 · 分身正在补充证据"
              : result.resume === "failed"
                ? "补充已记录 · 恢复分身失败"
                : "补充信息已记录",
          );
          await refresh();
        } else if (data.action === "go-trace") {
          ui.view = "tasks";
          ui.selectedTask = data.task;
          render();
        } else if (data.action === "open-decision") {
          ui.view = "inbox";
          ui.selectedDecision = data.id;
          render();
        } else if (data.action === "toggle-exec") {
          UiStore.toggleFlag ? UiStore.toggleFlag(ui.execOpen, data.key) : (ui.execOpen[data.key] = !ui.execOpen[data.key]);
          render();
        } else if (data.action === "toggle-session") {
          UiStore.toggleFlag ? UiStore.toggleFlag(ui.sessionOpen, data.id) : (ui.sessionOpen[data.id] = !ui.sessionOpen[data.id]);
          render();
        } else if (data.action === "detect-engines") {
          ui.busy = true;
          render();
          await api("/api/engines/detect", { method: "POST" });
          ui.busy = false;
          showToast("执行引擎探针完成");
          await refresh();
        } else if (data.action === "codex-network-toggle") {
          const enabled = data.enabled === "true";
          await api("/api/settings/codex-network", {
            method: "POST",
            body: { enabled },
          });
          showToast(enabled ? "本地智能体网络访问已开启" : "本地智能体网络访问已关闭");
          await refresh();
        } else if (data.action === "public-access-save") {
          const form = currentPublicAccessForm();
          const current = state.integrations?.publicAccess || {};
          const result = await api("/api/public-access/config", {
            method: "POST",
            body: {
              provider: form.provider,
              manualUrl: form.manualUrl,
              enabled: Boolean(current.enabled),
            },
          });
          ui.publicAccessForm = publicAccessFormFromPublic(result.publicAccess);
          resetMobilePairing(ui);
          showToast("手机公网通道设置已保存");
          await refresh();
        } else if (data.action === "public-access-start") {
          const form = currentPublicAccessForm();
          ui.busy = "public-access-start";
          render();
          const result = await api("/api/public-access/start", {
            method: "POST",
            body: {
              provider: form.provider,
              manualUrl: form.manualUrl,
            },
          });
          ui.busy = false;
          ui.publicAccessForm = publicAccessFormFromPublic(result.publicAccess);
          resetMobilePairing(ui);
          showToast(result.publicAccess?.activeUrl ? "手机公网通道已打开" : "正在打开公网通道，稍后检测链接");
          await refresh();
        } else if (data.action === "public-access-stop") {
          ui.busy = "public-access-stop";
          render();
          const result = await api("/api/public-access/stop", { method: "POST" });
          ui.busy = false;
          ui.publicAccessForm = publicAccessFormFromPublic(result.publicAccess);
          resetMobilePairing(ui);
          showToast("手机公网通道已关闭");
          await refresh();
        } else if (data.action === "public-access-check") {
          const form = currentPublicAccessForm();
          ui.busy = "public-access-check";
          render();
          const result = await api("/api/public-access/check", {
            method: "POST",
            body: {
              url: state.integrations?.publicAccess?.activeUrl || form.manualUrl,
            },
          });
          ui.busy = false;
          ui.publicAccessForm = publicAccessFormFromPublic(result.publicAccess);
          showToast(result.check?.ok ? "公网访问检测成功" : result.check?.error || "公网访问检测失败");
          await refresh();
        } else if (data.action === "public-access-copy-url") {
          const url = state.integrations?.publicAccess?.activeUrl || currentPublicAccessForm().manualUrl || "";
          if (!url) return showToast("暂无可复制的公网链接");
          await navigator.clipboard?.writeText(url);
          showToast("公网链接已复制");
        } else if (data.action === "channel-config") {
          if (data.id === "slack") {
            ui.settingsChannelConfig = "slack";
            render();
          } else if (data.id === "assistant") {
            showToast("对话助手无需额外配置，可用开关控制是否处理本地对话");
          } else {
            showToast("该通道配置入口尚未接入");
          }
        } else if (data.action === "close-settings-channel-config") {
          ui.settingsChannelConfig = null;
          render();
        } else if (data.action === "default-engine") {
          await api(`/api/engines/${encodeURIComponent(data.id)}/default`, { method: "POST" });
          showToast("默认执行引擎已更新");
          await refresh();
        } else if (data.action === "candidate") {
          await api(`/api/candidates/${encodeURIComponent(data.id)}`, {
            method: "POST",
            body: { status: data.status },
          });
          showToast(data.status === "approved" ? "已确认 · 新授权规则生效" : "已忽略该规则候选");
          await refresh();
        } else if (data.action === "channel-toggle") {
          await api(`/api/channels/${encodeURIComponent(data.id)}`, {
            method: "POST",
            body: { notify: data.notify === "true" },
          });
          showToast(data.notify === "true" ? "已开启该通道消息处理" : "已停用该通道消息处理");
          await refresh();
        } else if (data.action === "channel-status") {
          await api(`/api/channels/${encodeURIComponent(data.id)}`, {
            method: "POST",
            body: { status: data.status, notify: data.status === "connected" },
          });
          showToast(data.status === "connected" ? "渠道已连接" : "渠道已断开");
          await refresh();
        } else if (data.action === "assistant-toggle") {
          ui.assistantOpen = !ui.assistantOpen;
          render();
          if (ui.assistantOpen) focusAssistantDraft(app);
        } else if (data.action === "assistant-send") {
          const message = String(ui.assistantDraft || "").trim();
          if (!message) return undefined;
          ui.assistantOpen = true;
          ui.busy = "assistant-send";
          render();
          const result = await api("/assistant/messages", {
            method: "POST",
            body: {
              text: message,
              conversationId: ui.assistantConversationId || "local-assistant",
            },
          });
          ui.assistantDraft = "";
          ui.busy = false;
          await refresh();
          ui.assistantOpen = true;
          if (result.taskId) {
            ui.selectedTask = result.taskId;
          }
          render();
          focusAssistantDraft(app);
        } else if (data.action === "create-task") {
          const prompt = ui.taskPrompt.trim();
          if (!prompt) return showToast("先填写任务内容");
          ui.busy = true;
          render();
          await api("/api/tasks", {
            method: "POST",
            body: {
              title: prompt.slice(0, 80),
              prompt,
              workspace: ui.taskWorkspace.trim() || undefined,
              run: true,
            },
          });
          ui.taskPrompt = "";
          ui.busy = false;
          showToast("任务已创建并派发给分身");
          await refresh();
          ui.view = "runtime";
          render();
        } else if (data.action === "run-task") {
          await api(`/api/tasks/${encodeURIComponent(data.id)}/run`, { method: "POST" });
          showToast("分身已开始执行");
          await refresh();
        } else if (data.action === "resume-task") {
          await api(`/api/tasks/${encodeURIComponent(data.id)}/resume`, { method: "POST" });
          showToast("已从最近恢复点重新发起");
          await refresh();
        } else if (data.action === "pause-task") {
          await api(`/api/tasks/${encodeURIComponent(data.id)}/pause`, {
            method: "POST",
            body: { paused: data.paused === "true" },
          });
          await refresh();
        } else if (data.action === "stop-task") {
          await api(`/api/tasks/${encodeURIComponent(data.id)}/stop`, { method: "POST" });
          showToast("任务已停止 · 快照与 trace 已保留");
          await refresh();
        } else if (data.action === "archive-task") {
          const result = await api(`/api/tasks/${encodeURIComponent(data.id)}/archive`, { method: "POST" });
          showToast(`任务已归档 · 同步归档 ${result.archivedDecisions || 0} 个决策`);
          await refresh();
        } else if (data.action === "stop-all") {
          await api("/api/tasks/stop-all", { method: "POST" });
          showToast("紧急全停 · 所有 run 已停止");
          await refresh();
        } else if (data.action === "save-slack-config") {
          ui.busy = "slack-save";
          render();
          const form = currentSlackForm();
          const result = await api("/api/integrations/slack/config", {
            method: "POST",
            body: {
              socketMode: Boolean(form.socketMode),
              customizeProfileMessages: Boolean(form.customizeProfileMessages),
              botToken: form.botToken,
              appToken: form.appToken,
              signingSecret: form.signingSecret,
              publicUrl: form.publicUrl,
              decisionChannel: form.decisionChannel,
              allowedUsers: form.allowedUsers,
              allowedChannels: form.allowedChannels,
            },
          });
          ui.busy = false;
          ui.slackForm = {
            ...slackFormFromPublic(result.slack),
            botToken: "",
            appToken: "",
            signingSecret: "",
          };
          showToast("Slack 配置已保存 · Socket transport 已重连");
          await refresh();
        } else if (data.action === "slack-reconnect") {
          await api("/api/integrations/slack/reconnect", { method: "POST" });
          showToast("Slack Socket 已请求重连");
          await refresh();
        } else if (data.action === "slack-manifest") {
          const form = currentSlackForm();
          const result = await api(`/api/integrations/slack/manifest?socket_mode=${form.socketMode ? "1" : "0"}&customize_profile=${form.customizeProfileMessages ? "1" : "0"}`);
          ui.slackManifest = JSON.stringify(result.manifest, null, 2);
          showToast("Manifest 已生成");
          render();
        } else if (data.action === "copy-slack-manifest") {
          await navigator.clipboard?.writeText(ui.slackManifest || "");
          showToast("Manifest 已复制");
        } else if (data.action === "slack-test") {
          const form = currentSlackForm();
          const result = await api("/api/integrations/slack/test-message", {
            method: "POST",
            body: {
              channel: form.decisionChannel,
              text: `${PRODUCT_NAME} Slack 连接测试: 本地 daemon 可以发送消息。`,
            },
          });
          if (result.result?.ok === false) throw new Error(result.result.error || result.result.reason || "Slack 测试消息失败");
          showToast(form.socketMode && !state.integrations?.slack?.appTokenConfigured ? "出站消息已发送 · 收消息还需要 xapp token" : "Slack 测试消息已发送");
        } else if (data.action === "slack-simulate-task") {
          ui.busy = "slack-simulate";
          render();
          const form = currentSlackForm();
          const result = await api("/api/integrations/slack/simulate-task", {
            method: "POST",
            body: {
              channel: form.decisionChannel || "CSECONDLOCAL",
              text: ui.onboardingDemoText || "帮我检查当前 Second daemon 是否可以处理来自 Slack 的任务",
            },
          });
          ui.busy = false;
          showToast("已模拟 Slack 入站任务 · 分身开始本地处理");
          await refresh();
          if (result.task?.id) {
            ui.view = "tasks";
            ui.selectedTask = result.task.id;
            render();
          }
        } else if (data.action === "mobile-mock-connect") {
          ui.mobileMockStatus = "connected";
          ui.onboardingPushEnabled = true;
          showToast("手机端已连接");
          render();
        } else if (data.action === "mobile-mock-send") {
          ui.mobileMockStatus = "sent";
          ui.onboardingPushEnabled = true;
          showToast("测试决策通知已发送");
          render();
        } else if (data.action === "mobile-push-subscribe") {
          ui.busy = "mobile-push";
          render();
          await MobilePwa.subscribe(api);
          ui.busy = false;
          showToast("手机系统通知已启用");
          await refresh();
        } else if (data.action === "mobile-push-unsubscribe") {
          ui.busy = "mobile-push";
          render();
          await MobilePwa.unsubscribe(api);
          ui.busy = false;
          showToast("已取消当前设备的系统通知");
          await refresh();
        } else if (data.action === "mobile-delete-subscription") {
          ui.busy = `mobile-delete-${data.id}`;
          render();
          await api(`/api/mobile/push/subscriptions/${encodeURIComponent(data.id)}`, { method: "DELETE" });
          ui.busy = false;
          showToast("已删除订阅设备");
          await refresh();
        } else if (data.action === "mobile-push-test") {
          ui.busy = "mobile-push-test";
          render();
          const result = await api("/api/mobile/push/test", { method: "POST" });
          ui.busy = false;
          showToast(result.result?.ok ? "测试通知已发送" : "测试通知已提交 · 暂无可用订阅或推送服务未确认");
          await refresh();
        } else if (data.action === "mobile-copy-pairing-link") {
          const result = await api("/api/mobile/pairing");
          applyMobilePairing(ui, result, QrCode);
          ui.onboardingMobileSkipped = false;
          await navigator.clipboard?.writeText(result.url || "");
          showToast("移动端配对链接已复制");
          render();
        } else if (data.action === "mobile-refresh-pairing") {
          ui.mobilePairingError = "";
          ui.mobilePairingLoading = true;
          render();
          const result = await api("/api/mobile/pairing");
          applyMobilePairing(ui, result, QrCode);
          ui.onboardingMobileSkipped = false;
          ui.mobilePairingLoading = false;
          showToast("配对二维码已刷新");
          render();
        } else if (data.action === "mobile-toggle-decision") {
          if (!ui.mobileExpanded) ui.mobileExpanded = {};
          UiStore.toggleFlag ? UiStore.toggleFlag(ui.mobileExpanded, data.id) : (ui.mobileExpanded[data.id] = !ui.mobileExpanded[data.id]);
          render();
        } else if (data.action === "mobile-toggle-reply") {
          if (!ui.mobileReplyOpen) ui.mobileReplyOpen = {};
          UiStore.toggleFlag ? UiStore.toggleFlag(ui.mobileReplyOpen, data.id) : (ui.mobileReplyOpen[data.id] = !ui.mobileReplyOpen[data.id]);
          render();
        } else if (data.action === "mobile-send-decision-reply") {
          const message = String(ui.mobileReplyDrafts?.[data.id] || "").trim();
          if (!message) return showToast("先填写补充信息");
          ui.busy = `mobile-reply-${data.id}`;
          render();
          await api(`/api/decisions/${encodeURIComponent(data.id)}/reply`, {
            method: "POST",
            body: { message, role: "human", actor: "手机决策端" },
          });
          ui.busy = false;
          ui.mobileReplyDrafts[data.id] = "";
          if (ui.mobileReplyOpen) ui.mobileReplyOpen[data.id] = false;
          showToast("补充信息已发送 · 分身将继续处理");
          await refresh();
        } else if (data.action === "mobile-resolve-decision") {
          const decision = state.decisions.find((item) => item.id === data.id);
          await api(`/api/decisions/${encodeURIComponent(data.id)}/resolve`, {
            method: "POST",
            body: { verdict: data.verdict, optionId: decision?.selectedOption },
          });
          showToast(data.verdict === "approved" ? "移动端已批准 · 分身将继续" : "移动端已拒绝 · 分身将调整");
          await refresh();
        } else if (data.action === "copy") {
          await navigator.clipboard?.writeText(data.copy || "");
          showToast("配置片段已复制");
        } else if (data.action === "toast") {
          showToast(data.message);
        }
      } catch (error) {
        ui.busy = false;
        ui.mobilePairingLoading = false;
        showToast(error.message || "操作失败");
        render();
      }
      return undefined;
    };
  }

  function focusAssistantDraft(app) {
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
    schedule(() => {
      const input = app?.querySelector?.("[data-assistant-field='draft']");
      if (input) input.focus();
    });
  }

  function clampOnboardingStep(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(6, Math.round(number)));
  }

  function applyMobilePairing(ui, result, QrCode) {
    const url = result.url || "";
    ui.mobilePairingUrl = url;
    ui.mobilePairingQrSvg = QrCode.toSvg && url
      ? QrCode.toSvg(url, {
          className: "mobile-qr-svg",
          label: "Second 移动端配对二维码",
          title: "Second mobile pairing",
        })
      : "";
    ui.mobilePairingError = "";
  }

  function resetMobilePairing(ui) {
    ui.mobilePairingUrl = "";
    ui.mobilePairingQrSvg = "";
    ui.mobilePairingError = "";
  }

  function publicAccessFormFromPublic(access = {}) {
    return {
      provider: access.provider || "manual",
      manualUrl: access.manualUrl || "",
    };
  }

  return {
    createActionHandler,
  };
});
