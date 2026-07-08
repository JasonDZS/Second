"use strict";

const { slackDecisionChannel, slackThreadTs } = require("./target");
const { escapeSlack, truncateSlackButtonText, validHttpsUrl } = require("./text");

const PRODUCT_NAME = "Second";

function decisionBlocks(decision, profile = null) {
  const fields = [
    `*风险*\n${decision.risk || "中"}`,
    `*任务*\n${decision.taskId || "unknown"}`,
    `*来源*\n${decision.source || PRODUCT_NAME}`,
  ];
  const optionText = (decision.options || [])
    .map((option) => `• ${option.label}${option.recommended ? " (推荐)" : ""}: ${option.description || ""}`)
    .join("\n");
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${escapeSlack(decision.title)}*\n${escapeSlack(decision.summary || "")}` },
      ...(validHttpsUrl(profile?.avatarUrl)
        ? {
            accessory: {
              type: "image",
              image_url: profile.avatarUrl,
              alt_text: profile.agentName || profile.name || PRODUCT_NAME,
            },
          }
        : {}),
    },
    ...(profile?.agentName || profile?.name
      ? [
          {
            type: "context",
            elements: [
              { type: "mrkdwn", text: `由 *${escapeSlack(profile.agentName || profile.name)}* 发送` },
            ],
          },
        ]
      : []),
    { type: "section", fields: fields.map((text) => ({ type: "mrkdwn", text })) },
    ...(optionText ? [{ type: "section", text: { type: "mrkdwn", text: escapeSlack(optionText) } }] : []),
    {
      type: "actions",
      elements: decisionActionButtons(decision),
    },
  ];
}

function decisionActionButtons(decision) {
  const options = Array.isArray(decision.options) ? decision.options.slice(0, 5) : [];
  if (!options.length) {
    return [
      decisionButton({ decisionId: decision.id, label: "批准", verdict: "approved", style: "primary" }),
      decisionButton({ decisionId: decision.id, label: "拒绝", verdict: "rejected", style: "danger" }),
    ];
  }

  const buttons = options.map((option) => {
    const reject = /reject|deny|manual|fallback|人工|拒绝|替代/.test(`${option.id} ${option.label}`.toLowerCase());
    return decisionButton({
      decisionId: decision.id,
      optionId: option.id,
      label: option.label || option.id,
      verdict: reject ? "rejected" : "approved",
      style: reject ? "danger" : option.recommended ? "primary" : undefined,
    });
  });

  if (!buttons.some((button) => parseActionValue(button.value).verdict === "rejected") && buttons.length < 5) {
    buttons.push(decisionButton({ decisionId: decision.id, label: "拒绝", verdict: "rejected", style: "danger" }));
  }
  return buttons;
}

function decisionClarificationPayload(decision, task) {
  const channel = slackDecisionChannel(decision, task);
  const title = decision.title || "需要补充信息";
  const summary = decision.summary || "分身需要更多信息才能继续。";
  const optionHints = (decision.options || [])
    .filter((option) => option.description || option.label)
    .slice(0, 3)
    .map((option) => `- ${option.label || option.id}: ${option.description || ""}`)
    .join("\n");
  return {
    channel,
    thread_ts: slackThreadTs(decision, task),
    text: [
      `${PRODUCT_NAME} 需要补充信息: ${title}`,
      summary,
      optionHints,
      "请直接在这个线程里回复补充信息。审批、授权、方案选择仍在 Second 收件箱中处理。",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function decisionButton({ decisionId, optionId = null, label, verdict, style }) {
  const button = {
    type: "button",
    text: { type: "plain_text", text: truncateSlackButtonText(label) },
    action_id: `second_decision_${verdict}_${optionId || "default"}`,
    value: JSON.stringify({ decisionId, verdict, optionId }),
  };
  if (style) button.style = style;
  return button;
}

function parseActionValue(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

module.exports = {
  decisionActionButtons,
  decisionBlocks,
  decisionButton,
  decisionClarificationPayload,
};
