"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");

const { appendDecisionReply, computePhase1Metrics, findChannelThreadTask, updateProfile } = require("../../server/app");
const { evaluateToolUse } = require("../../server/policy");
const assistant = require("../../server/channels/assistant");
const slack = require("../../server/channels/slack");
const channelController = require("../../server/channels/controller");
const channelProcessor = require("../../server/channels/processor");
const slackEvents = require("../../server/channels/slack/events");
const slackSocket = require("../../server/channels/slack/socket");
const slackText = require("../../server/channels/slack/text");
const codexEvents = require("../../server/codex/events");
const codexPrompts = require("../../server/codex/prompts");
const codexProcessClose = require("../../server/codex/process-close");
const codexResultHelpers = require("../../server/codex/result-helpers");
const codexRuntimeFiles = require("../../server/codex/runtime-files");
const codexTasks = require("../../server/codex/tasks");
const decisionDomain = require("../../server/domain/decisions");
const stateViewDomain = require("../../server/domain/state-view");
const httpJson = require("../../server/http/json");
const httpMobileRoutes = require("../../server/http/routes/mobile");
const runtimeRecovery = require("../../server/runtime/recovery");
const runtimeResume = require("../../server/runtime/resume");
const runtimeTaskExecutor = require("../../server/runtime/task-executor");
const mobilePush = require("../../server/mobile-push");
const publicAccess = require("../../server/public-access");
const { createRuntimeManager } = require("../../server/runtime-manager");
const runtimes = require("../../server/runtimes");
const httpStatic = require("../../server/http/static");
const actions = require("../../public/actions");
const apiClient = require("../../public/api-client");
const assistantWidgetUi = require("../../public/assistant-widget");
const authViewUi = require("../../public/auth-view");
const inboxViewUi = require("../../public/inbox-view");
const mobileViewUi = require("../../public/mobile-view");
const onboardingViewUi = require("../../public/onboarding-view");
const presentation = require("../../public/presentation");
const profileUi = require("../../public/profile");
const qrCodeUi = require("../../public/qr-code");
const renderSignatureUi = require("../../public/render-signature");
const runtimeViewUi = require("../../public/runtime-view");
const settingsViewUi = require("../../public/settings-view");
const shellViewUi = require("../../public/shell-view");
const slackSettingsUi = require("../../public/slack-settings");
const taskTraceAgentViewUi = require("../../public/task-trace-agent-view");
const taskTraceFormatUi = require("../../public/task-trace-format");
const taskTraceSourceViewUi = require("../../public/task-trace-source-view");
const taskTraceViewUi = require("../../public/task-trace-view");
const traceCore = require("../../public/timeline-core");
const uiStore = require("../../public/ui-store");
const { buildChannelFollowupPrompt, buildInitialPrompt, buildResumePrompt } = codexPrompts;
const { codexNetworkArgs, prepareCodexRuntimeFiles } = codexRuntimeFiles;

module.exports = {
  EventEmitter,
  PassThrough,
  actions,
  apiClient,
  appendDecisionReply,
  assert,
  assistant,
  assistantWidgetUi,
  authViewUi,
  buildChannelFollowupPrompt,
  buildInitialPrompt,
  buildResumePrompt,
  channelController,
  channelProcessor,
  codexEvents,
  codexNetworkArgs,
  codexProcessClose,
  codexPrompts,
  codexResultHelpers,
  codexRuntimeFiles,
  codexTasks,
  computePhase1Metrics,
  createRuntimeManager,
  decisionDomain,
  evaluateToolUse,
  findChannelThreadTask,
  fs,
  httpJson,
  httpMobileRoutes,
  httpStatic,
  inboxViewUi,
  mobileViewUi,
  mobilePush,
  publicAccess,
  onboardingViewUi,
  os,
  path,
  prepareCodexRuntimeFiles,
  presentation,
  profileUi,
  qrCodeUi,
  renderSignatureUi,
  runtimeRecovery,
  runtimeResume,
  runtimeTaskExecutor,
  runtimeViewUi,
  runtimes,
  settingsViewUi,
  shellViewUi,
  slack,
  slackEvents,
  slackSettingsUi,
  slackSocket,
  slackText,
  stateViewDomain,
  taskTraceAgentViewUi,
  taskTraceFormatUi,
  taskTraceSourceViewUi,
  taskTraceViewUi,
  traceCore,
  uiStore,
  updateProfile,
};
