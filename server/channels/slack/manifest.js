"use strict";

const { getSlackConfig } = require("../../slack-config");

const PRODUCT_NAME = "Second";

function manifest(options = {}) {
  const config = getSlackConfig();
  const useSocketMode =
    Boolean(options.socketMode) ||
    Boolean(config.socketMode) ||
    false;
  const customizeProfileMessages = Object.prototype.hasOwnProperty.call(options, "customizeProfileMessages")
    ? Boolean(options.customizeProfileMessages)
    : Boolean(config.customizeProfileMessages);
  const base = normalizeBaseUrl(config.publicUrl || "https://YOUR-TUNNEL.example.com");
  const botEvents = ["app_mention", "message.im", "message.channels", "message.groups", "message.mpim"];
  const eventSubscriptions = useSocketMode
    ? {
        bot_events: botEvents,
      }
    : {
        request_url: `${base}/slack/events`,
        bot_events: botEvents,
      };
  const interactivity = useSocketMode
    ? { is_enabled: true }
    : {
        is_enabled: true,
        request_url: `${base}/slack/interactive`,
      };
  const botScopes = [
    "app_mentions:read",
    "channels:read",
    "channels:history",
    "chat:write",
    "groups:read",
    "groups:history",
    "im:history",
    "im:read",
    "mpim:read",
    "mpim:history",
  ];
  if (customizeProfileMessages) botScopes.push("chat:write.customize");
  return {
    display_information: {
      name: PRODUCT_NAME,
      description: "Personal agent task intake and Human Gate decisions",
    },
    features: {
      bot_user: {
        display_name: PRODUCT_NAME,
        always_online: true,
      },
    },
    oauth_config: {
      scopes: {
        bot: botScopes,
      },
    },
    settings: {
      event_subscriptions: eventSubscriptions,
      interactivity,
      org_deploy_enabled: false,
      socket_mode_enabled: useSocketMode,
      is_hosted: false,
      token_rotation_enabled: false,
    },
  };
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

module.exports = {
  manifest,
  normalizeBaseUrl,
};
