"use strict";

const test = require("node:test");
const {
  EventEmitter,
  PassThrough,
  actions,
  apiClient,
  appendDecisionReply,
  assert,
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
  httpStatic,
  inboxViewUi,
  mobileViewUi,
  os,
  path,
  prepareCodexRuntimeFiles,
  presentation,
  profileUi,
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
} = require("../helpers/phase1-context");

test("Codex event parser captures session ids and normalized runtime events", () => {
  const state = { events: [] };
  const task = { id: "T-jsonl", agent: "测试分身", trace: [], agentEvents: [] };
  codexEvents.handleCodexJsonLine(
    state,
    task,
    JSON.stringify({
      type: "thread_started",
      thread: { id: "019f3a9b-e38c-7650-8fd6-98c6eaf05f8f" },
    }),
    "initial",
    "run-1",
  );

  assert.equal(task.codexSessionId, "019f3a9b-e38c-7650-8fd6-98c6eaf05f8f");
  assert.equal(task.trace[0].title, "可恢复会话已建立");
  assert.equal(state.events.some((event) => event.type === "codex.session"), true);
  assert.equal(codexEvents.looksLikeSessionId(task.codexSessionId), true);
});

test("Codex result helpers classify waiting decisions and queued follow-ups", () => {
  assert.equal(
    codexResultHelpers.extractWaitingDecisionId("SECOND_WAITING_FOR_DECISION:D-ABC123"),
    "D-ABC123",
  );
  assert.equal(
    codexResultHelpers.cleanAgentReplyText("detail\nSECOND_WAITING_FOR_DECISION:D-ABC123", "D-ABC123"),
    "detail",
  );

  const state = {
    decisions: [
      { id: "D-old", taskId: "T-1", status: "approved" },
      { id: "D-new", taskId: "T-1", status: "pending" },
    ],
  };
  assert.equal(codexResultHelpers.findPendingTaskDecision(state, { id: "T-1" }, null).id, "D-new");

  const task = {
    channelFollowups: [
      { id: "F-1", message: "one" },
      { id: "F-2", message: "two" },
    ],
  };
  assert.equal(codexResultHelpers.takeNextChannelFollowup(task).id, "F-1");
  assert.deepEqual(task.channelFollowups.map((item) => item.id), ["F-2"]);
  assert.equal(codexResultHelpers.firstNonEmptyLine("\n\n done \n next"), "done");
});

test("Codex task factory prepares direct workspaces without git assumptions", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "second-direct-workspace-"));
  try {
    const setup = codexTasks.prepareTaskWorkspace("T-direct", workspace);
    assert.equal(setup.workspace, workspace);
    assert.equal(setup.sourceWorkspace, workspace);
    assert.equal(setup.mode, "direct-workspace");
    assert.equal(fs.existsSync(workspace), true);
    assert.equal(codexTasks.isGitWorkTree(workspace), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("runtime recovery folds completed orphaned runs back into task state", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "second-recovery-"));
  try {
    const outputFile = path.join(workspace, "last-message.md");
    fs.writeFileSync(outputFile, "Recovered result\nmore detail\n");
    const events = [];
    const recovery = runtimeRecovery.createRuntimeRecovery({
      appendEvent: (state, event) => {
        events.push(event);
        state.events.unshift(event);
      },
      getRunningTasks: () => [],
      nowIso: () => "2026-07-07T00:00:00.000Z",
    });
    const state = {
      events: [],
      tasks: [
        {
          id: "T-recover",
          status: "running",
          agent: "测试分身",
          outputFile,
          trace: [],
        },
      ],
    };

    const recovered = recovery.reconcileInterruptedRuntimeTasks(state);
    assert.equal(recovered.length, 1);
    assert.equal(state.tasks[0].status, "done");
    assert.equal(state.tasks[0].summary, "Recovered result");
    assert.equal(events[0].type, "codex.recovered.done");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("runtime manager owns adapter probes and process supervision", async () => {
  const codexAdapter = runtimes.getRuntimeAdapter("codex");
  assert.equal(codexAdapter.engineId, "codex");
  assert.equal(typeof codexAdapter.prepareRun, "function");
  assert.equal(typeof codexAdapter.prepareResume, "function");
  assert.equal(runtimes.getRuntimeAdapter("claude-code").command, "claude");
  assert.ok(runtimes.listRuntimeAdapters().some((adapter) => adapter.id === "codex"));

  let savedState = null;
  const appended = [];
  const manager = createRuntimeManager({
    appendEvent: (state, event) => {
      appended.push(event);
      state.events = [...(state.events || []), event];
    },
    nowIso: () => "2026-07-07T00:00:00.000Z",
    runtimeAdapters: [{ engineId: "node-test", command: "node", versionArgs: ["--version"] }],
    saveState: (state) => {
      savedState = state;
    },
  });

  const engineState = {
    settings: { defaultEngine: "node-test" },
    engines: [{ id: "node-test", name: "Node test" }],
    events: [],
  };
  const engines = manager.detectEngines(engineState);
  assert.equal(engines[0].status, "ok");
  assert.equal(engines[0].isDefault, true);
  assert.match(appended[0].text, /node-test=ok/);
  assert.equal(savedState, engineState);

  let emitted = 0;
  manager.setStateChangeListener(() => {
    emitted += 1;
  });
  manager.saveStateAndEmit(engineState);
  assert.equal(emitted, 1);

  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const rawLogFile = path.join(os.tmpdir(), `second-runtime-manager-${Date.now()}.log`);
  const stdoutLines = [];
  let stderrText = "";
  let closeEvent = null;
  manager.attachProcess({
    child,
    taskId: "T-runtime-manager",
    rawLogFile,
    onStdoutLine: (line) => stdoutLines.push(line),
    onStderr: (text) => {
      stderrText += text;
    },
    onClose: (event) => {
      closeEvent = event;
    },
  });

  assert.equal(manager.isTaskRunning("T-runtime-manager"), true);
  child.stdout.write("one\npartial");
  child.stderr.write("warn");
  child.stdout.write(" two\n");
  child.emit("close", 0, null);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(stdoutLines, ["one", "partial two"]);
  assert.equal(stderrText, "warn");
  assert.equal(closeEvent.code, 0);
  assert.equal(manager.isTaskRunning("T-runtime-manager"), false);

  const invocationLines = [];
  let invocationClose = null;
  let resolveInvocation = null;
  const invocationDone = new Promise((resolve) => {
    resolveInvocation = resolve;
  });
  const invocationLogFile = path.join(os.tmpdir(), `second-runtime-invocation-${Date.now()}.log`);
  manager.startInvocation(
    {
      command: process.execPath,
      args: ["-e", "process.stdout.write('started\\n')"],
      rawLogFile: invocationLogFile,
    },
    {
      taskId: "T-runtime-invocation",
      onStdoutLine: (line) => invocationLines.push(line),
      onClose: (event) => {
        invocationClose = event;
        resolveInvocation();
      },
    },
  );
  assert.equal(manager.isTaskRunning("T-runtime-invocation"), true);
  await invocationDone;
  assert.deepEqual(invocationLines, ["started"]);
  assert.equal(invocationClose.code, 0);
  assert.equal(manager.isTaskRunning("T-runtime-invocation"), false);
  fs.rmSync(invocationLogFile, { force: true });
});

test("Codex runtime adapter prepares run and resume invocations", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "second-codex-adapter-"));
  try {
    const adapter = runtimes.getRuntimeAdapter("codex");
    const state = { daemon: { port: 7317 }, settings: { codexNetworkAccess: true } };
    const task = {
      id: "T-adapter",
      title: "Adapter task",
      prompt: "do the task",
      workspace,
      outputFile: path.join(workspace, "result.md"),
      rawLogFile: path.join(workspace, "codex.jsonl.log"),
      codexSessionId: "019f3be5-1cdd-7a60-9c86-888f5f61151d",
    };

    const run = adapter.prepareRun(task, state);
    assert.equal(run.command, "codex");
    assert.deepEqual(run.args.slice(0, 4), ["exec", "--json", "--skip-git-repo-check", "--sandbox"]);
    assert.equal(run.cwd, workspace);
    assert.equal(run.outputFile, task.outputFile);
    assert.equal(run.args.includes("sandbox_workspace_write.network_access=true"), false);
    assert.ok(fs.existsSync(path.join(workspace, ".codex", "config.toml")));

    const resume = adapter.prepareResume(task, state, { id: "D-adapter", status: "approved" }, { mode: "channel", message: "follow up" });
    assert.equal(resume.command, "codex");
    assert.deepEqual(resume.args.slice(0, 3), ["exec", "resume", "--json"]);
    assert.equal(resume.mode, "channel");
    assert.equal(resume.phase, "channel");
    assert.match(resume.runId, /^channel-/);
    assert.ok(resume.outputFile.endsWith(".md"));
    assert.ok(resume.rawLogFile.endsWith(".jsonl.log"));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("Codex process close handler reconciles successful task results", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "second-process-close-"));
  try {
    const outputFile = path.join(workspace, "result.md");
    fs.writeFileSync(outputFile, "Done line\nmore detail\n");
    const state = {
      decisions: [],
      events: [],
      tasks: [
        {
          id: "T-close",
          status: "running",
          agent: "测试分身",
          trace: [],
          artifacts: [],
          channel: { id: "slack" },
        },
      ],
    };
    const saved = [];
    const handler = codexProcessClose.createCodexProcessCloseHandler({
      appendEvent: (target, event) => target.events.push(event),
      loadState: () => state,
      makeId: () => "R-test",
      notifyTaskResult: async () => ({ ok: true, chunks: 1 }),
      nowIso: () => "2026-07-07T00:00:00.000Z",
      resumeCodexTask: () => {
        throw new Error("unexpected resume");
      },
      saveStateAndEmit: (target) => saved.push(target),
    });

    handler.handleCodexProcessClose({
      taskId: "T-close",
      phase: "initial",
      outputFile,
      code: 0,
      signal: null,
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(state.tasks[0].status, "done");
    assert.equal(state.tasks[0].summary, "Done line");
    assert.equal(state.tasks[0].trace[0].title, "执行完成");
    assert.equal(state.events[0].type, "codex.initial.done");
    assert.equal(state.events[1].type, "channel.task.result_sent");
    assert.equal(saved.length, 2);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("runtime resume controller infers channel retries from latest task state", () => {
  let savedState = null;
  let resumeCall = null;
  const state = {
    decisions: [],
    events: [],
    tasks: [
      {
        id: "T-resume",
        title: "Continue in thread",
        status: "pending_resume",
        codexSessionId: "019f3be5-1cdd-7a60-9c86-888f5f61151d",
        channel: { id: "slack", external: { channel: "C1", threadTs: "100.1" } },
        messageText: "继续",
        trace: [],
      },
    ],
  };
  const controller = runtimeResume.createRuntimeResumeController({
    appendEvent: (target, event) => target.events.push(event),
    isTaskRunning: () => false,
    loadState: () => state,
    resumeCodexTask: (...args) => {
      resumeCall = args;
      return { started: true };
    },
    saveState: (target) => {
      savedState = target;
    },
  });

  const result = controller.resumeLatestTaskRun(state, "T-resume");
  assert.equal(result.started, true);
  assert.equal(savedState, state);
  assert.equal(state.trace, undefined);
  assert.equal(state.tasks[0].trace[0].title, "从最近恢复点重新执行");
  assert.equal(resumeCall[1], "T-resume");
  assert.equal(resumeCall[3].mode, "channel");
  assert.deepEqual(runtimeResume.resumeOptionsFromRequest({ mode: "reply", replyId: "R-1", message: "补充" }), {
    mode: "reply",
    replyId: "R-1",
    message: "补充",
  });
});

test("runtime task executor delegates lifecycle to runtime adapters", () => {
  const started = [];
  const saved = [];
  const events = [];
  const state = {
    engines: [{ id: "fake-engine", status: "ok" }],
    decisions: [{ id: "D-runtime", taskId: "T-runtime-task", status: "approved" }],
    tasks: [
      {
        id: "T-runtime-task",
        agent: "测试分身",
        trace: [],
        fakeSessionId: "S-runtime",
      },
    ],
  };
  const adapter = {
    id: "fake",
    engineId: "fake-engine",
    eventPrefix: "fake",
    name: "Fake Runtime",
    sessionIdField: "fakeSessionId",
    sessionLabel: "Fake session",
    prepareRun(task) {
      return {
        command: "fake",
        args: ["run", task.id],
        phase: "initial",
        outputFile: "/tmp/fake-run.md",
        rawLogFile: "/tmp/fake-run.log",
      };
    },
    prepareResume(task, _targetState, decision, options = {}) {
      return {
        command: "fake",
        args: ["resume", task.fakeSessionId, decision?.id || ""],
        mode: options.mode || "decision",
        phase: options.mode || "resume",
        runId: "resume-test",
        outputFile: "/tmp/fake-resume.md",
        rawLogFile: "/tmp/fake-resume.log",
      };
    },
  };
  const executor = runtimeTaskExecutor.createRuntimeTaskExecutor({
    adapter,
    appendEvent: (_state, event) => events.push(event),
    createProcessCloseHandler: ({ resumeTask }) => {
      assert.equal(typeof resumeTask, "function");
      return () => {};
    },
    handleRuntimeLine: () => {},
    loadState: () => state,
    makeId: () => "RUN-test",
    nowIso: () => "2026-07-07T00:00:00.000Z",
    runtimeManager: {
      detectCommand: () => ({}),
      detectEngines: () => [],
      getRunningTasks: () => [],
      isTaskRunning: () => false,
      runningProcess: () => null,
      saveStateAndEmit: () => {},
      setStateChangeListener: () => {},
      startInvocation: (invocation, handlers) => started.push({ invocation, handlers }),
      untrackProcess: () => {},
    },
    saveState: (target) => saved.push(target),
  });

  const run = executor.runTask(state, "T-runtime-task");
  assert.equal(run.alreadyRunning, false);
  assert.equal(state.tasks[0].status, "running");
  assert.equal(events[0].type, "fake.start");
  assert.deepEqual(started[0].invocation.args, ["run", "T-runtime-task"]);

  const resume = executor.resumeTask(state, "T-runtime-task", "D-runtime", { mode: "reply", replyId: "R-1", message: "补充" });
  assert.equal(resume.alreadyRunning, false);
  assert.equal(state.tasks[0].status, "resuming");
  assert.equal(state.tasks[0].lastResumeRequest.mode, "reply");
  assert.equal(events[1].type, "fake.reply.start");
  assert.deepEqual(started[1].invocation.args, ["resume", "S-runtime", "D-runtime"]);
  assert.equal(saved.length, 2);
});

test("external task prompt routes missing information through a clarification decision", () => {
  const prompt = buildInitialPrompt({
    id: "T-missing-info",
    title: "Check account credits",
    prompt: "Check account credits",
    channel: { id: "slack" },
  });

  assert.match(prompt, /required requester input, credentials, account access/);
  assert.match(prompt, /call decision_request with type "补充"/);
  assert.match(prompt, /instead of posting the decision event back to the source thread/);
  assert.equal(prompt, codexPrompts.buildInitialPrompt({
    id: "T-missing-info",
    title: "Check account credits",
    prompt: "Check account credits",
    channel: { id: "slack" },
  }));
});

test("decision resume prompt includes supplemental replies without encouraging secret echo", () => {
  const prompt = buildResumePrompt(
    { id: "T-openrouter", decisionId: "D-openrouter" },
    {
      id: "D-openrouter",
      status: "approved",
      selectedOption: "provide_openrouter_api_key",
      summary: "Need OpenRouter credentials.",
      options: [{ id: "provide_openrouter_api_key", label: "提供 API Key" }],
      replies: [
        {
          role: "human",
          actor: "Tester",
          at: "2026-07-07T00:00:00.000Z",
          message: "sk-test-redacted",
        },
      ],
    },
  );

  assert.match(prompt, /Supplemental information provided/);
  assert.match(prompt, /sk-test-redacted/);
  assert.match(prompt, /Do not echo, persist, log, or include full secret values/);
});

test("Codex runtime files are generated inside each run workspace", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "second-run-"));
  try {
    const files = prepareCodexRuntimeFiles(
      { id: "T-test", workspace },
      { daemon: { port: 7317 } },
    );

    assert.ok(fs.existsSync(files.configFile));
    assert.ok(fs.existsSync(files.hooksFile));
    assert.ok(fs.existsSync(files.hookFile));

    const config = fs.readFileSync(files.configFile, "utf8");
    assert.match(config, /mcp_servers\.second-decision/);
    assert.match(config, /SECOND_ROOT/);

    const hooks = JSON.parse(fs.readFileSync(files.hooksFile, "utf8"));
    assert.equal(hooks.hooks.PreToolUse[0].matcher, codexRuntimeFiles.CODEX_AUTHORIZATION_TOOL_MATCHER);
    assert.match(hooks.hooks.PreToolUse[0].matcher, /Read/);
    assert.match(hooks.hooks.PreToolUse[0].matcher, /WebFetch/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("Codex network access uses daemon proxy unless raw network is explicitly enabled", () => {
  assert.deepEqual(codexNetworkArgs({ settings: { codexNetworkAccess: false } }), []);
  assert.deepEqual(codexNetworkArgs({ settings: { codexNetworkAccess: true } }), []);
  assert.deepEqual(codexRuntimeFiles.codexNetworkArgs({ settings: { codexNetworkAccess: true } }), []);
  assert.deepEqual(codexRuntimeFiles.codexNetworkArgs({}, { SECOND_CODEX_RAW_NETWORK_ACCESS: "1" }), [
    "-c",
    "sandbox_workspace_write.network_access=true",
  ]);

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "second-run-network-"));
  try {
    const files = prepareCodexRuntimeFiles(
      { id: "T-network", workspace },
      { daemon: { port: 7317 }, settings: { codexNetworkAccess: true } },
    );
    const config = fs.readFileSync(files.configFile, "utf8");
    assert.doesNotMatch(config, /\[sandbox_workspace_write\]/);
    assert.doesNotMatch(config, /network_access = true/);
    assert.match(config, /SECOND_AUTH_PROXY/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
