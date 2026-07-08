(function initSecondSlackSettings(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  const target = root || {};
  if (target) target.SecondSlackSettings = api;
  if (typeof window === "object") window.SecondSlackSettings = api;
  if (typeof globalThis === "object") globalThis.SecondSlackSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecondSlackSettings() {
  function slackFormFromPublic(slack = {}) {
    const emptyConfig =
      !slack.botTokenConfigured &&
      !slack.appTokenConfigured &&
      !slack.signingSecretConfigured &&
      !slack.publicUrl &&
      !slack.decisionChannel;
    return {
      socketMode: emptyConfig ? true : Boolean(slack.socketMode),
      customizeProfileMessages: Boolean(slack.customizeProfileMessages),
      botToken: "",
      appToken: "",
      signingSecret: "",
      publicUrl: slack.publicUrl || "",
      decisionChannel: slack.decisionChannel || "",
      allowedUsers: slack.allowedUsers || "",
      allowedChannels: slack.allowedChannels || "",
    };
  }

  function latestSlackStatus(slack) {
    if (slack?.socketMode && !slack?.appTokenConfigured) {
      return { label: "缺少 xapp token", cls: "risk-high" };
    }
    if (slack?.socketMode && !slack?.botTokenConfigured) {
      return { label: "缺少 xoxb token", cls: "risk-high" };
    }
    const recent = slack?.recentEvents || [];
    const event = recent.find((item) => String(item.type || "").startsWith("channel.socket"));
    if (!event) return { label: slack?.socketMode ? "Socket 待连接" : "HTTP 模式", cls: "kind-amber" };
    if (event.type === "channel.socket.hello" || event.type === "channel.socket.open") {
      return { label: "Socket 已连接", cls: "risk-low" };
    }
    if (event.type === "channel.socket.connect_failed" || event.type === "channel.socket.error") {
      return { label: "Socket 连接失败", cls: "risk-high" };
    }
    if (event.type === "channel.socket.connecting") return { label: "Socket 连接中", cls: "kind-amber" };
    return { label: event.type.replace("channel.", ""), cls: "kind-amber" };
  }

  function channelMetaParts(meta) {
    return String(meta || "")
      .split(" · ")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return {
    channelMetaParts,
    latestSlackStatus,
    slackFormFromPublic,
  };
});
