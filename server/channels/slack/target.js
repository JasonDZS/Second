"use strict";

const { getSlackConfig } = require("../../slack-config");

function slackDecisionChannel(decision, task) {
  const config = getSlackConfig();
  return (
    decision?.channel?.external?.channel ||
    decision?.slack?.channel ||
    task?.channel?.external?.channel ||
    task?.slack?.channel ||
    config.decisionChannel ||
    null
  );
}

function slackTaskChannel(task) {
  return task?.channel?.external?.channel || task?.slack?.channel || null;
}

function slackThreadTs(decision, task) {
  return (
    decision?.channel?.external?.threadTs ||
    decision?.slack?.threadTs ||
    task?.channel?.external?.threadTs ||
    task?.slack?.threadTs ||
    null
  );
}

module.exports = {
  slackDecisionChannel,
  slackTaskChannel,
  slackThreadTs,
};
