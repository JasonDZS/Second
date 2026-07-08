"use strict";

const https = require("https");
const { URLSearchParams } = require("url");
const { loadState } = require("../../state");
const { getSlackConfig } = require("../../slack-config");
const { truncateSlackPlainText, validHttpsUrl } = require("./text");

const PRODUCT_NAME = "Second";

async function postSlackMessage(payload, profile = null) {
  const withIdentity = addProfileIdentity(payload, profile);
  const result = await slackApi("chat.postMessage", withIdentity.payload);
  if (result.ok === false && withIdentity.customized && shouldRetryWithoutProfileIdentity(result)) {
    const fallback = await slackApi("chat.postMessage", payload);
    if (fallback && typeof fallback === "object") {
      fallback.profileIdentitySkipped = true;
      fallback.profileIdentityError = result.error || result.needed || "custom_profile_identity_failed";
    }
    return fallback;
  }
  return result;
}

function addProfileIdentity(payload, profile = null) {
  const config = getSlackConfig();
  if (!config.customizeProfileMessages) return { payload, customized: false };
  const identity = profileIdentity(profile);
  if (!identity) return { payload, customized: false };
  return {
    payload: { ...payload, ...identity },
    customized: true,
  };
}

function profileIdentity(profile = null) {
  const source = profile || currentProfile();
  const iconUrl = validHttpsUrl(source?.avatarUrl) ? source.avatarUrl : "";
  if (!iconUrl) return null;
  return {
    username: truncateSlackPlainText(source?.agentName || source?.name || PRODUCT_NAME, 80),
    icon_url: iconUrl,
  };
}

function currentProfile() {
  try {
    return loadState().profile || {};
  } catch {
    return {};
  }
}

function shouldRetryWithoutProfileIdentity(result = {}) {
  const text = `${result.error || ""} ${result.needed || ""}`;
  return /missing_scope|not_allowed|invalid_arguments|chat:write\.customize/i.test(text);
}

function slackApi(method, payload) {
  const token = getSlackConfig().botToken;
  if (!token) return Promise.resolve({ ok: false, skipped: true, reason: "SLACK_BOT_TOKEN is not set" });
  const body = JSON.stringify(payload || {});
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "slack.com",
        path: `/api/${method}`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(text || "{}"));
          } catch {
            resolve({ ok: false, raw: text, statusCode: res.statusCode });
          }
        });
      },
    );
    req.setTimeout(5000, () => req.destroy(new Error("Slack request timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

function slackFormApi(method, payload, token) {
  if (!token) return Promise.resolve({ ok: false, skipped: true, reason: "Slack token is not set" });
  const body = new URLSearchParams(payload || {}).toString();
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "slack.com",
        path: `/api/${method}`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(text || "{}"));
          } catch {
            resolve({ ok: false, raw: text, statusCode: res.statusCode });
          }
        });
      },
    );
    req.setTimeout(5000, () => req.destroy(new Error("Slack request timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

module.exports = {
  addProfileIdentity,
  currentProfile,
  postSlackMessage,
  profileIdentity,
  slackApi,
  slackFormApi,
};
