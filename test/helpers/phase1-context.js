"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");

const { appendDecisionReply, computePhase1Metrics, findChannelThreadTask, updateProfile } = require("../../server/app");
const authorizationEngine = require("../../server/authorization/engine");
const authorizationGrants = require("../../server/authorization/grants");
const authorizationIntent = require("../../server/authorization/intent-parser");
const authorizationPolicyLoader = require("../../server/authorization/policy-loader");
const authorizationRuleCandidates = require("../../server/authorization/rule-candidates");
const authorizationService = require("../../server/authorization/service");
const { evaluateToolUse } = require("../../server/policy");
const assistant = require("../../server/channels/assistant");
const slack = require("../../server/channels/slack");
const channelController = require("../../server/channels/controller");
const channelProcessor = require("../../server/channels/processor");
const slackEvents = require("../../server/channels/slack/events");
const slackSocket = require("../../server/channels/slack/socket");
const slackText = require("../../server/channels/slack/text");
const slackConfig = require("../../server/slack-config");
const codexEvents = require("../../server/codex/events");
const codexPrompts = require("../../server/codex/prompts");
const codexProcessClose = require("../../server/codex/process-close");
const codexResultHelpers = require("../../server/codex/result-helpers");
const codexRuntimeFiles = require("../../server/codex/runtime-files");
const codexTasks = require("../../server/codex/tasks");
const decisionDomain = require("../../server/domain/decisions");
const stateViewDomain = require("../../server/domain/state-view");
const httpJson = require("../../server/http/json");
const httpAdminRoutes = require("../../server/http/routes/admin");
const httpAuthorizationRoutes = require("../../server/http/routes/authorization");
const httpMobileRoutes = require("../../server/http/routes/mobile");
const httpNetworkProxyRoutes = require("../../server/http/routes/network-proxy");
const mcp = require("../../server/mcp");
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
  authorizationEngine,
  authorizationGrants,
  authorizationIntent,
  authorizationPolicyLoader,
  authorizationRuleCandidates,
  authorizationService,
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
  httpAdminRoutes,
  httpAuthorizationRoutes,
  httpMobileRoutes,
  httpNetworkProxyRoutes,
  httpStatic,
  inboxViewUi,
  mobileViewUi,
  mobilePush,
  mcp,
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
  slackConfig,
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
