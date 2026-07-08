"use strict";

const { readProfileContext } = require("../state");

const PRODUCT_NAME = "Second";

function buildInitialPrompt(task) {
  const profile = readProfileContext();
  const lines = [
    `You are running as ${PRODUCT_NAME}'s local execution unit.`,
    "Keep the work scoped to the provided workspace unless the user explicitly asks otherwise.",
    "",
    `${PRODUCT_NAME} profile context:`,
    "",
    "PREFERENCES.md:",
    fenced(profile.preferences),
    "",
    "AUTHORIZATION.md:",
    fenced(profile.authorization),
    "",
    "Human-gate protocol:",
    `- If you need human approval, call the MCP tool decision_request with taskId exactly "${task.id}".`,
    "- If required requester input, credentials, account access, file attachments, or business context is missing, do not finish with a passive \"please provide...\" answer.",
    "- Instead, call decision_request with type \"补充\", risk \"低\", a summary of the missing information, and an option that lets the human provide the missing information so this same session can resume.",
    `- Include concise options and enough evidence for the user to decide in ${PRODUCT_NAME}.`,
    "- If decision_request returns status \"pending\", stop immediately and make your final response exactly:",
    "  SECOND_WAITING_FOR_DECISION:<decision-id>",
    `- Do not continue executing after a pending ${PRODUCT_NAME} decision. ${PRODUCT_NAME} daemon will resume this same Codex session after review.`,
    "",
  ];

  if (task.channel?.id) {
    lines.push(
      "External-channel delivery protocol:",
      "- This task came from an external chat adapter.",
      "- Do not call messaging, email, or connector tools to reply to the requester.",
      `- ${PRODUCT_NAME} daemon owns channel acknowledgements and final-result delivery.`,
      `- If the external requester must provide missing information, use decision_request; ${PRODUCT_NAME} will keep the request in its inbox instead of posting the decision event back to the source thread.`,
      `- Put the user-facing answer in your final response; ${PRODUCT_NAME} will relay that final response back to the source thread.`,
      "",
    );
  }

  lines.push("At the end, summarize concrete files changed and next steps.", "", task.prompt || task.title);

  return lines.join("\n");
}

function buildResumePrompt(task, decision, options = {}) {
  if (options.mode === "reply") return buildReplyPrompt(task, decision, options);
  if (options.mode === "channel") return buildChannelFollowupPrompt(task, options);
  const selected = decision?.options?.find((option) => option.id === decision.selectedOption);
  const replies = decisionRepliesForPrompt(decision);
  return [
    `${PRODUCT_NAME} Human Gate has resolved a pending decision for this Codex session.`,
    `Task ID: ${task.id}`,
    `Decision ID: ${decision?.id || task.decisionId || "unknown"}`,
    `Decision status: ${decision?.status || "unknown"}`,
    `Selected option: ${decision?.selectedOption || "unknown"}${selected ? ` · ${selected.label}` : ""}`,
    "",
    "Continue from the paused point in this same session.",
    "If the decision was approved, perform the approved path.",
    "If the decision was rejected, stop the original action and take the safest fallback or report what cannot be done.",
    "",
    "Human-visible decision summary:",
    decision?.summary || "No decision summary was recorded.",
    "",
    replies ? "Supplemental information provided in the decision thread:" : "",
    replies,
    replies
      ? "If supplemental information contains API keys, tokens, or secrets, use them only for this requested operation. Do not echo, persist, log, or include full secret values in the final response."
      : "",
  ].join("\n");
}

function buildChannelFollowupPrompt(task, options = {}) {
  const channelName = channelPromptName(task, options.external);
  const channelNoun = channelName === "Slack" ? "thread" : "conversation";
  const latestLabel = channelName === "Slack" ? "Latest Slack message:" : `Latest ${channelName} message:`;
  return [
    `${PRODUCT_NAME} received a new message in the same external ${channelName} ${channelNoun} for this existing task.`,
    `Task ID: ${task.id}`,
    "",
    "Continue from the existing Codex session and use the prior context in this conversation.",
    "Treat the message below as the latest requester instruction or follow-up.",
    "Do not call messaging, email, or connector tools to reply directly.",
    `Put the user-facing answer in your final response; ${PRODUCT_NAME} daemon will relay it back to the same ${channelName} ${channelNoun}.`,
    "- If required requester input, credentials, account access, file attachments, or business context is missing, call decision_request with type \"补充\" so this same session can resume later.",
    "",
    options.external?.channel ? `${channelName} channel: ${options.external.channel}` : "",
    options.external?.threadTs ? `${channelName} ${channelNoun}: ${options.external.threadTs}` : "",
    options.external?.user ? `Requester: ${options.external.user}` : "",
    "",
    latestLabel,
    options.message || "Continue the thread.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function channelPromptName(task = {}, external = {}) {
  if (task.channel?.name) return task.channel.name;
  if (external.channel === "assistant" || external.conversationId) return "local assistant chat";
  if (external.channel || external.threadTs) return "Slack";
  return "external chat";
}

function buildReplyPrompt(task, decision, options = {}) {
  const replies = decisionRepliesForPrompt(decision);
  return [
    `${PRODUCT_NAME} Human Gate is still waiting on a pending decision.`,
    `Task ID: ${task.id}`,
    `Decision ID: ${decision?.id || task.decisionId || "unknown"}`,
    `Decision title: ${decision?.title || task.title}`,
    "",
    "The human did not approve or reject yet. They are asking for more information.",
    "Do not perform the pending approved/rejected action yet.",
    "Gather only the evidence or clarification needed to answer the human's latest message.",
    "Put the answer in your final response. The daemon will attach that response to the same inbox decision and keep it pending.",
    "",
    "Original decision summary:",
    decision?.summary || "No decision summary was recorded.",
    "",
    replies ? "Decision thread so far:" : "",
    replies,
    "",
    "Latest human message:",
    options.message || "Please provide more information.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function decisionRepliesForPrompt(decision) {
  return (decision?.replies || [])
    .map((reply) => {
      const who = reply.role === "agent" ? "Agent" : reply.role === "system" ? "System" : "Human";
      return `${who} ${reply.actor || ""} (${reply.at || "unknown"}):\n${reply.message || ""}`;
    })
    .join("\n\n");
}

function fenced(text) {
  return ["```markdown", String(text || "").trim(), "```"].join("\n");
}

module.exports = {
  buildChannelFollowupPrompt,
  buildInitialPrompt,
  buildReplyPrompt,
  buildResumePrompt,
  channelPromptName,
  decisionRepliesForPrompt,
};
