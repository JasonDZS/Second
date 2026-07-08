"use strict";

const fs = require("fs");

function isHookDecision(decision) {
  return /hook/i.test(String(decision?.source || ""));
}

function extractWaitingDecisionId(text) {
  const match = String(text || "").match(/SECOND_WAITING_FOR_DECISION:([A-Z0-9-]+)/i);
  return match ? match[1] : null;
}

function cleanAgentReplyText(text, decisionId) {
  return String(text || "")
    .replace(new RegExp(`SECOND_WAITING_FOR_DECISION:${escapeRegExp(decisionId || "")}`, "gi"), "")
    .replace(/SECOND_WAITING_FOR_DECISION:[A-Z0-9-]+/gi, "")
    .trim();
}

function findPendingTaskDecision(state, task, explicitId) {
  if (explicitId) {
    const explicit = state.decisions.find((item) => item.id === explicitId && item.status === "pending");
    if (explicit) return explicit;
  }
  if (task.decisionId) {
    const linked = state.decisions.find((item) => item.id === task.decisionId && item.status === "pending");
    if (linked) return linked;
  }
  return state.decisions.find((item) => item.taskId === task.id && item.status === "pending") || null;
}

function addArtifact(task, label, filePath) {
  const existing = task.artifacts || [];
  if (existing.some((item) => item.path === filePath)) return;
  task.artifacts = [...existing, { label, path: filePath }];
}

function firstNonEmptyLine(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function takeNextChannelFollowup(task) {
  if (!Array.isArray(task.channelFollowups) || !task.channelFollowups.length) return null;
  const [next, ...rest] = task.channelFollowups;
  task.channelFollowups = rest;
  return next;
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  addArtifact,
  cleanAgentReplyText,
  extractWaitingDecisionId,
  findPendingTaskDecision,
  firstNonEmptyLine,
  isHookDecision,
  safeRead,
  takeNextChannelFollowup,
};
