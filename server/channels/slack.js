"use strict";

const { getSlackConfig } = require("../slack-config");
const { decisionBlocks, decisionClarificationPayload } = require("./slack/blocks");
const {
  parseSlackBody,
  receiveHttp,
  receiveSocketEnvelope,
  resolveChannelInfo,
  slackEventToTaskInput,
  verifySlackSignature,
} = require("./slack/events");
const { manifest } = require("./slack/manifest");
const { startSocketTransport } = require("./slack/socket");
const { slackTaskChannel, slackThreadTs } = require("./slack/target");
const { chunkSlackText } = require("./slack/text");
const { currentProfile, postSlackMessage } = require("./slack/web-api");

const SLACK_CHANNEL_ID = "slack";
const PRODUCT_NAME = "Second";
const SLACK_TEXT_CHUNK_SIZE = 12000;

function startTransport(options = {}) {
  return startSocketTransport(options, module.exports);
}

async function sendDecisionRequested(decision, task) {
  return { ok: false, skipped: true, reason: "Decision events are managed in Second only" };
}

async function sendTaskAccepted(task) {
  const channel = slackTaskChannel(task);
  if (!channel) return { ok: false, skipped: true };
  return postSlackMessage({
    channel,
    thread_ts: slackThreadTs(null, task),
    text: `${PRODUCT_NAME} 已接住任务: ${task.title}`,
  }, currentProfile());
}

async function sendTaskResult(task, { success = true, finalText = "" } = {}) {
  const channel = slackTaskChannel(task);
  if (!channel) return { ok: false, skipped: true };
  const status = success ? "完成" : "失败";
  const body = String(finalText || task.summary || "").trim();
  const header = `${PRODUCT_NAME} 任务${status}: ${task.title}`;
  const chunks = chunkSlackText(body, SLACK_TEXT_CHUNK_SIZE);
  if (!chunks.length) chunks.push(task.summary || "");

  const results = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const prefix =
      chunks.length === 1
        ? header
        : `${header}\n(${index + 1}/${chunks.length})`;
    const result = await postSlackMessage({
      channel,
      thread_ts: slackThreadTs(null, task),
      text: `${prefix}\n${chunks[index]}`.trim(),
    }, currentProfile());
    results.push(result);
    if (result.ok === false) return { ok: false, chunk: index + 1, results, error: result.error };
  }
  return { ok: true, chunks: chunks.length, results };
}

async function sendDecisionResolved(decision, task) {
  return { ok: false, skipped: true, reason: "Decision resolution is managed in Second only" };
}

async function sendTestMessage({ channel, text } = {}) {
  const target = channel || getSlackConfig().decisionChannel;
  if (!target) return { ok: false, skipped: true, reason: "No Slack channel configured" };
  return postSlackMessage({
    channel: target,
    text: text || `${PRODUCT_NAME} Slack 连接测试: 本地 daemon 可以发送消息。`,
  }, currentProfile());
}

module.exports = {
  id: SLACK_CHANNEL_ID,
  name: "Slack",
  kind: "http-adapter",
  status: "implemented",
  description: "Slack Events API, Block Kit interactivity, and chat.postMessage replies.",
  httpPrefix: "/slack/",
  supports: {
    taskIntake: true,
    decisionButtons: false,
    resultReply: true,
    socketMode: true,
  },
  decisionClarificationPayload,
  decisionBlocks,
  manifest,
  parseSlackBody,
  postDecisionResolved: sendDecisionResolved,
  postSlackDecision: sendDecisionRequested,
  postTaskAccepted: sendTaskAccepted,
  postTaskResult: sendTaskResult,
  receiveHttp,
  receiveSocketEnvelope,
  resolveChannelInfo,
  sendDecisionRequested,
  sendDecisionResolved,
  sendTestMessage,
  sendTaskAccepted,
  sendTaskResult,
  slackEventToTaskInput,
  startTransport,
  verifySlackSignature,
};
