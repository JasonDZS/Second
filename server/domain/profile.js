"use strict";

const {
  NICE_AVATAR_SOURCE_URL,
  niceAvatarConfigFromSeed,
  niceAvatarDataUrl,
  normalizeNiceAvatarConfig,
  normalizeNiceAvatarShape,
} = require("../../public/profile");

function updateProfile(state, body = {}) {
  const current = state.profile || {};
  const name = cleanProfileText(body.name, current.name || "用户", 60) || "用户";
  const roleIntro =
    cleanProfileText(
      body.roleIntro ?? body.tagline,
      current.roleIntro || current.tagline || "人只做决策 · 经验永不离职",
      160,
    ) || "人只做决策 · 经验永不离职";
  const seed = cleanProfileText(body.avatarSeed, current.avatarSeed || name, 80) || name;
  const currentConfig = normalizeNiceAvatarConfig(
    current.avatarConfig || niceAvatarConfigFromSeed(current.avatarSeed || seed),
    current.avatarSeed || seed,
  );
  const requestedConfig = body.avatarConfig && typeof body.avatarConfig === "object" && !Array.isArray(body.avatarConfig)
    ? body.avatarConfig
    : currentConfig;
  const avatarConfig = normalizeNiceAvatarConfig(
    requestedConfig,
    seed,
    currentConfig,
  );
  const currentShape = normalizeNiceAvatarShape(current.avatarShape || current.avatarConfig?.shape || "circle");
  const avatarShape = normalizeNiceAvatarShape(body.avatarShape == null ? currentShape : body.avatarShape, currentShape);
  const avatar = Array.from(name.trim())[0] || current.avatar || "用";
  const agentName = cleanProfileText(body.agentName, `${name}的分身`, 80) || `${name}的分身`;

  state.profile = {
    ...current,
    name,
    avatar,
    agentName,
    tagline: roleIntro,
    roleIntro,
    avatarSeed: seed,
    avatarStyle: "nice-avatar",
    avatarProvider: "nice-avatar",
    avatarSourceUrl: NICE_AVATAR_SOURCE_URL,
    avatarShape,
    avatarConfig,
    avatarUrl: niceAvatarDataUrl(avatarConfig, avatarShape),
  };
  return state.profile;
}

function cleanProfileText(value, fallback = "", maxLength = 120) {
  const raw = value == null ? fallback : value;
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

module.exports = {
  cleanProfileText,
  niceAvatarConfigFromSeed,
  niceAvatarDataUrl,
  normalizeNiceAvatarConfig,
  normalizeNiceAvatarShape,
  updateProfile,
};
