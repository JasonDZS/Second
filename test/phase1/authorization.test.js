"use strict";

const test = require("node:test");
const { spawnSync } = require("node:child_process");
const {
  PassThrough,
  assert,
  authorizationEngine,
  authorizationGrants,
  authorizationIntent,
  authorizationPolicyLoader,
  authorizationRuleCandidates,
  authorizationService,
  codexRuntimeFiles,
  decisionDomain,
  fs,
  httpAdminRoutes,
  httpAuthorizationRoutes,
  httpJson,
  httpNetworkProxyRoutes,
  mcp,
  os,
  path,
  runtimes,
  slackConfig,
} = require("../helpers/phase1-context");
const secondPolicyHook = require("../../.codex/hooks/second_policy_hook");

test("authorization engine allows workspace reads, gates prod writes, denies secrets, and gates unknown actions", () => {
  const allowed = authorizationEngine.evaluateAuthorization({ tool: "Bash", command: "rg TODO server" });
  assert.equal(allowed.action, "allow");
  assert.equal(allowed.ruleId, "allow.read_workspace");
  assert.equal(allowed.intent.action, "read");

  const gated = authorizationEngine.evaluateAuthorization({ tool: "Bash", command: "psql prod -c 'update orders set status=1'" });
  assert.equal(gated.action, "gate");
  assert.equal(gated.ruleId, "gate.prod_write");
  assert.equal(gated.intent.environment, "prod");

  const denied = authorizationEngine.evaluateAuthorization({ tool: "Bash", command: "cat .env" });
  assert.equal(denied.action, "deny");
  assert.equal(denied.ruleId, "deny.expose_credentials");

  const unknown = authorizationEngine.evaluateAuthorization({ tool: "Bash", command: "custom-prod-tool --flag" });
  assert.equal(unknown.action, "gate");
  assert.equal(unknown.intent.action, "unknown");
});

test("authorization parser handles wrapper, path, self-protection, and outbound adversarial cases", () => {
  const cases = [
    {
      payload: { tool: "Bash", command: "sh -c 'git push origin main'" },
      action: "gate",
      ruleId: "gate.push_shared",
      intentAction: "push",
    },
    {
      payload: { tool: "Bash", command: "npm run deploy -- --env staging" },
      action: "gate",
      ruleId: "gate.deploy",
      intentAction: "deploy",
    },
    {
      payload: { tool: "Bash", command: "cat ../.env.local" },
      action: "deny",
      ruleId: "deny.expose_credentials",
      intentAction: "read",
    },
    {
      payload: { tool: "Bash", command: "sed -i 's/gate/allow/' .second/profile/AUTHORIZATION.yml" },
      action: "deny",
      ruleId: "deny.self_protection",
      intentAction: "write",
    },
    {
      payload: { tool: "Bash", command: "rm -rf /" },
      action: "deny",
      ruleId: "deny.irreversible_delete",
      intentAction: "unknown",
    },
    {
      payload: { tool: "Bash", command: "curl -X POST https://hooks.slack.test -d hello" },
      action: "gate",
      ruleId: "gate.communicate",
      intentAction: "communicate",
    },
  ];

  for (const item of cases) {
    const result = authorizationEngine.evaluateAuthorization(item.payload);
    assert.equal(result.action, item.action, item.payload.command);
    assert.equal(result.ruleId, item.ruleId, item.payload.command);
    assert.equal(result.intent.action, item.intentAction, item.payload.command);
  }
});

test("authorization policy loader fails closed on invalid policy files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "second-auth-policy-"));
  const file = path.join(dir, "AUTHORIZATION.yml");
  try {
    fs.writeFileSync(file, "version: 2\ndefaults:\n  unknown_action: allow\n");
    const loaded = authorizationPolicyLoader.loadAuthorizationPolicy({ policyFile: file });
    assert.equal(loaded.failedClosed, true);
    const result = authorizationEngine.evaluateAuthorization(
      { tool: "Bash", command: "rg TODO server" },
      { policyResult: loaded },
    );
    assert.equal(result.action, "deny");
    assert.equal(result.ruleId, "deny.policy_unavailable");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("authorization dry-run route returns daemon verdict without mutating state", async () => {
  const req = new PassThrough();
  req.method = "POST";
  const res = responseRecorder();
  const state = {
    profile: { agentName: "测试分身" },
    tasks: [],
    decisions: [],
    events: [],
    authorization: { grants: [], audit: [] },
  };
  let saved = 0;
  let broadcasts = 0;
  const handled = httpAuthorizationRoutes.handleAuthorizationRoutes(
    req,
    res,
    new URL("http://localhost/api/authorize"),
    {
      appendAuthorizationAudit: () => {},
      appendDecisionLog: () => {},
      appendEvent: (target, event) => target.events.unshift(event),
      broadcast: () => {
        broadcasts += 1;
      },
      decorateState: (target) => target,
      loadState: () => state,
      makeId: () => "D-test",
      notifyDecisionRequested: async () => {},
      nowIso: () => "2026-07-08T00:00:00.000Z",
      readBody: httpJson.readBody,
      saveState: () => {
        saved += 1;
      },
      sendJson: httpJson.sendJson,
    },
  );
  req.end(JSON.stringify({ dryRun: true, tool: "Bash", command: "rg TODO server" }));

  assert.equal(await handled, true);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.dryRun, true);
  assert.equal(body.action, "allow");
  assert.equal(body.intent.action, "read");
  assert.equal(saved, 0);
  assert.equal(broadcasts, 0);
  assert.equal(state.decisions.length, 0);
});

test("network proxy runs authorization before outbound HTTP and strips credential headers", async () => {
  const gatedState = authorizationState();
  let transportCalls = 0;
  const gateReq = new PassThrough();
  gateReq.method = "POST";
  const gateRes = responseRecorder();
  const gateHandled = httpNetworkProxyRoutes.handleNetworkProxyRoutes(
    gateReq,
    gateRes,
    new URL("http://localhost/api/proxy/http"),
    {
      ...authorizationRouteDeps(gatedState),
      httpProxyRequest: async () => {
        transportCalls += 1;
        return { statusCode: 200, headers: {}, body: "unexpected" };
      },
    },
  );
  gateReq.end(JSON.stringify({ method: "GET", url: "https://example.com/data", taskId: "T-1" }));
  assert.equal(await gateHandled, true);
  assert.equal(gateRes.status, 202);
  assert.equal(JSON.parse(gateRes.body).authorization.action, "gate");
  assert.equal(transportCalls, 0);

  const allowedState = authorizationState();
  const intent = authorizationIntent.parseAuthorizationIntent({ tool: "HTTP", method: "GET", url: "https://example.com/data" });
  allowedState.authorization.grants.push({
    id: "G-http",
    type: "once",
    status: "active",
    taskId: "T-1",
    decisionId: "D-http",
    fingerprint: intent.fingerprint,
    ruleId: "gate.external_request",
    intent,
    scope: authorizationGrants.intentScope(intent),
  });
  const allowReq = new PassThrough();
  allowReq.method = "POST";
  const allowRes = responseRecorder();
  const allowHandled = httpNetworkProxyRoutes.handleNetworkProxyRoutes(
    allowReq,
    allowRes,
    new URL("http://localhost/api/proxy/http"),
    {
      ...authorizationRouteDeps(allowedState),
      httpProxyRequest: async (request) => {
        transportCalls += 1;
        assert.equal(request.headers.Authorization, undefined);
        assert.equal(request.headers["X-Api-Key"], undefined);
        return { statusCode: 200, headers: { "content-type": "text/plain" }, body: "ok" };
      },
    },
  );
  allowReq.end(JSON.stringify({
    method: "GET",
    url: "https://example.com/data",
    taskId: "T-1",
    headers: {
      Authorization: "Bearer should-not-leave-agent",
      "X-Api-Key": "should-not-leave-agent",
    },
  }));
  assert.equal(await allowHandled, true);
  assert.equal(allowRes.status, 200);
  const allowedBody = JSON.parse(allowRes.body);
  assert.equal(allowedBody.authorization.action, "allow");
  assert.equal(allowedBody.response.body, "ok");
  assert.equal(allowedState.authorization.grants[0].status, "consumed");
  assert.equal(transportCalls, 1);
});

test("authorization service creates one pending decision per task fingerprint", () => {
  const state = authorizationState();
  const deps = authorizationDeps(state);
  const body = { tool: "Bash", command: "git push origin main", taskId: "T-1" };

  const first = authorizationService.authorizeToolUse(body, deps);
  assert.equal(first.action, "gate");
  assert.equal(first.decisionId, "D-1");
  assert.equal(state.decisions.length, 1);
  assert.equal(state.tasks[0].status, "needs_human");
  assert.equal(state.decisions[0].authorization.fingerprint, first.fingerprint);

  const second = authorizationService.authorizeToolUse(body, deps);
  assert.equal(second.action, "gate");
  assert.equal(second.decisionId, "D-1");
  assert.equal(state.decisions.length, 1);
});

test("approved authorization decisions create once grants that are consumed exactly once", () => {
  const state = authorizationState();
  const deps = authorizationDeps(state);
  const body = { tool: "Bash", command: "git push origin main", taskId: "T-1" };
  const gated = authorizationService.authorizeToolUse(body, deps);

  const domain = decisionDomain.createDecisionDomain({
    PRODUCT_NAME: "Second",
    RUNS_DIR: os.tmpdir(),
    appendAuthorizationAudit: deps.appendAuthorizationAudit,
    appendDecisionLog: deps.appendDecisionLog,
    appendEvent: deps.appendEvent,
    makeId: deps.makeId,
    nowIso: deps.nowIso,
    saveState: deps.saveState,
    stopTask: () => {},
    traceT2087: () => [],
  });
  const resolved = domain.resolveDecision(state, gated.decisionId, { verdict: "approved", optionId: "approve" });
  assert.equal(resolved.grant.status, "active");
  assert.equal(state.authorization.grants.length, 1);

  const allowed = authorizationService.authorizeToolUse(body, deps);
  assert.equal(allowed.action, "allow");
  assert.equal(state.authorization.grants[0].status, "consumed");

  const gatedAgain = authorizationService.authorizeToolUse(body, deps);
  assert.equal(gatedAgain.action, "gate");
  assert.notEqual(gatedAgain.decisionId, gated.decisionId);
});

test("task-scoped once grants do not authorize missing or different task ids", () => {
  const state = authorizationState();
  const intent = authorizationEngine.evaluateAuthorization({ tool: "Bash", command: "git push origin main" }).intent;
  state.tasks.push({ ...state.tasks[0], id: "T-2", trace: [] });
  state.authorization.grants.push({
    id: "G-task",
    type: "once",
    status: "active",
    taskId: "T-1",
    decisionId: "D-task",
    fingerprint: intent.fingerprint,
    ruleId: "gate.push_shared",
    intent,
    createdAt: "2026-07-08T00:00:00.000Z",
  });
  const deps = authorizationDeps(state);

  const missingTask = authorizationService.authorizeToolUse({ tool: "Bash", command: "git push origin main" }, deps);
  assert.equal(missingTask.action, "gate");
  assert.equal(state.authorization.grants[0].status, "active");

  const otherTask = authorizationService.authorizeToolUse({ tool: "Bash", command: "git push origin main", taskId: "T-2" }, deps);
  assert.equal(otherTask.action, "gate");
  assert.equal(state.authorization.grants[0].status, "active");

  const sameTask = authorizationService.authorizeToolUse({ tool: "Bash", command: "git push origin main", taskId: "T-1" }, deps);
  assert.equal(sameTask.action, "allow");
  assert.equal(sameTask.grantPreview.id, "G-task");
  assert.equal(state.authorization.grants[0].status, "consumed");
});

test("authorization service redacts token-shaped text from audit and decisions", () => {
  const state = authorizationState();
  const deps = authorizationDeps(state);
  const secret = "sk-testsecretsecretsecret";
  const result = authorizationService.authorizeToolUse({
    tool: "Bash",
    command: `curl -X POST https://hooks.slack.test -d api_key=${secret}`,
    taskId: "T-1",
  }, deps);

  assert.equal(result.action, "gate");
  const serialized = JSON.stringify({
    audit: state.authorization.audit,
    decision: state.decisions[0],
  });
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.match(serialized, /redacted/);
});

test("authorization quota trips turn otherwise green commands into Human Gate decisions", () => {
  const state = authorizationState();
  const deps = authorizationDeps(state, { quotaLimits: { maxCommandsPerTask: 1 } });

  const first = authorizationService.authorizeToolUse({ tool: "Bash", command: "rg TODO server", taskId: "T-1" }, deps);
  assert.equal(first.action, "allow");

  const second = authorizationService.authorizeToolUse({ tool: "Bash", command: "rg FIXME server", taskId: "T-1" }, deps);
  assert.equal(second.action, "gate");
  assert.equal(second.ruleId, "quota.command_count");
  assert.equal(state.decisions[0].authorization.ruleId, "quota.command_count");
  assert.equal(state.authorization.audit.some((entry) => entry.event === "authorization.quota.trip"), true);
});

test("authorization rejection and mismatched grants do not authorize later actions", () => {
  const state = authorizationState();
  const deps = authorizationDeps(state);
  const original = { tool: "Bash", command: "git push origin main", taskId: "T-1" };
  const gated = authorizationService.authorizeToolUse(original, deps);

  const domain = decisionDomain.createDecisionDomain({
    PRODUCT_NAME: "Second",
    RUNS_DIR: os.tmpdir(),
    appendAuthorizationAudit: deps.appendAuthorizationAudit,
    appendDecisionLog: deps.appendDecisionLog,
    appendEvent: deps.appendEvent,
    makeId: deps.makeId,
    nowIso: deps.nowIso,
    saveState: deps.saveState,
    stopTask: () => {},
    traceT2087: () => [],
  });
  const rejected = domain.resolveDecision(state, gated.decisionId, { verdict: "rejected", optionId: "reject" });
  assert.equal(rejected.grant, null);
  assert.equal(state.authorization.grants.length, 0);

  const next = authorizationService.authorizeToolUse({ tool: "Bash", command: "git push origin release/test", taskId: "T-1" }, deps);
  assert.equal(next.action, "gate");
  assert.notEqual(next.fingerprint, gated.fingerprint);
});

test("session grants are task-scoped and expire when the task is terminal", () => {
  const state = authorizationState();
  state.tasks.push({ ...state.tasks[0], id: "T-2", trace: [] });
  const deps = authorizationDeps(state);
  const body = { tool: "SlackMessage", text: "发布进度", taskId: "T-1" };
  const gated = authorizationService.authorizeToolUse(body, deps);
  assert.equal(gated.action, "gate");
  assert.ok(state.decisions[0].options.some((option) => option.id === "approve_session"));

  const domain = decisionDomain.createDecisionDomain({
    PRODUCT_NAME: "Second",
    RUNS_DIR: os.tmpdir(),
    appendAuthorizationAudit: deps.appendAuthorizationAudit,
    appendDecisionLog: deps.appendDecisionLog,
    appendEvent: deps.appendEvent,
    makeId: deps.makeId,
    nowIso: deps.nowIso,
    saveState: deps.saveState,
    stopTask: () => {},
    traceT2087: () => [],
  });
  const resolved = domain.resolveDecision(state, gated.decisionId, { verdict: "approved", optionId: "approve_session" });
  assert.equal(resolved.grant.type, "session");

  const sameTask = authorizationService.authorizeToolUse({ tool: "SlackMessage", text: "继续发布进度", taskId: "T-1" }, deps);
  assert.equal(sameTask.action, "allow");
  assert.equal(state.authorization.grants[0].status, "active");

  const otherTask = authorizationService.authorizeToolUse({ tool: "SlackMessage", text: "发布进度", taskId: "T-2" }, deps);
  assert.equal(otherTask.action, "gate");

  state.tasks[0].status = "done";
  const afterDone = authorizationService.authorizeToolUse({ tool: "SlackMessage", text: "发布进度", taskId: "T-1" }, deps);
  assert.equal(afterDone.action, "gate");
  assert.equal(state.authorization.grants[0].status, "expired");
});

test("plan grants only authorize structured plan items", () => {
  const state = authorizationState();
  const deps = authorizationDeps(state);
  const body = {
    tool: "Bash",
    command: "git push origin main",
    taskId: "T-1",
    authorizationPlan: {
      items: [
        { tool: "Bash", command: "git push origin main" },
        { tool: "Bash", command: "git push origin release/test" },
      ],
    },
  };
  const gated = authorizationService.authorizeToolUse(body, deps);
  assert.equal(gated.action, "gate");
  assert.ok(state.decisions[0].options.some((option) => option.id === "approve_plan"));

  const domain = decisionDomain.createDecisionDomain({
    PRODUCT_NAME: "Second",
    RUNS_DIR: os.tmpdir(),
    appendAuthorizationAudit: deps.appendAuthorizationAudit,
    appendDecisionLog: deps.appendDecisionLog,
    appendEvent: deps.appendEvent,
    makeId: deps.makeId,
    nowIso: deps.nowIso,
    saveState: deps.saveState,
    stopTask: () => {},
    traceT2087: () => [],
  });
  const resolved = domain.resolveDecision(state, gated.decisionId, { verdict: "approved", optionId: "approve_plan" });
  assert.equal(resolved.grant.type, "plan");
  assert.equal(resolved.grant.planItems.length, 2);

  const main = authorizationService.authorizeToolUse({ tool: "Bash", command: "git push origin main", taskId: "T-1" }, deps);
  assert.equal(main.action, "allow");
  const release = authorizationService.authorizeToolUse({ tool: "Bash", command: "git push origin release/test", taskId: "T-1" }, deps);
  assert.equal(release.action, "allow");
  const outsidePlan = authorizationService.authorizeToolUse({ tool: "Bash", command: "git push origin release/other", taskId: "T-1" }, deps);
  assert.equal(outsidePlan.action, "gate");
});

test("authorization rule candidates are extracted from repeated approved decisions and can be confirmed into policy", async () => {
  const intent = authorizationEngine.evaluateAuthorization({ tool: "Bash", command: "kubectl apply -f staging-deploy.yml" }).intent;
  const state = {
    candidates: [],
    decisions: [1, 2, 3].map((index) => ({
      id: `D-learn-${index}`,
      status: "approved",
      authorization: {
        intent,
        ruleId: "gate.deploy",
      },
    })),
    events: [],
    rules: [],
    authorization: { grants: [], audit: [] },
  };
  const candidates = authorizationRuleCandidates.applyExtractedCandidates(state, { minApprovals: 3 });
  assert.equal(candidates.length, 1);
  assert.equal(state.candidates[0].status, "pending");
  assert.equal(state.candidates[0].rule.action, "deploy");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "second-auth-confirm-"));
  const policyFile = path.join(dir, "AUTHORIZATION.yml");
  fs.writeFileSync(policyFile, authorizationPolicyLoader.serializePolicy(authorizationPolicyLoader.DEFAULT_POLICY));
  try {
    const req = new PassThrough();
    req.method = "POST";
    const res = responseRecorder();
    const handled = httpAdminRoutes.handleAdminRoutes(
      req,
      res,
      new URL(`http://localhost/api/candidates/${state.candidates[0].id}`),
      {
        appendAuthorizationAudit: (target, entry) => target.authorization.audit.unshift(entry),
        appendEvent: (target, event) => target.events.unshift(event),
        authorizationPolicyFile: policyFile,
        authorizationSummaryFile: path.join(dir, "AUTHORIZATION.md"),
        broadcast: () => {},
        decorateState: (target) => target,
        loadState: () => state,
        readBody: httpJson.readBody,
        saveState: () => {},
        sendJson: httpJson.sendJson,
      },
    );
    req.end(JSON.stringify({ status: "approved" }));

    assert.equal(await handled, true);
    assert.equal(res.status, 200);
    const loaded = authorizationPolicyLoader.loadAuthorizationPolicy({ policyFile });
    assert.equal(loaded.failedClosed, false);
    assert.equal(loaded.policy.green.some((rule) => rule.id === state.candidates[0].rule.id), true);
    assert.equal(state.authorization.audit.some((entry) => entry.event === "authorization.rule.created"), true);
    assert.match(fs.readFileSync(path.join(dir, "AUTHORIZATION.md"), "utf8"), new RegExp(state.candidates[0].rule.id));
    assert.match(fs.readFileSync(path.join(dir, "AUTHORIZATION.md"), "utf8"), new RegExp(state.candidates[0].id));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("authorization rule candidates exclude rejected and unsafe histories", () => {
  const stagingIntent = authorizationEngine.evaluateAuthorization({ tool: "Bash", command: "kubectl apply -f staging-deploy.yml" }).intent;
  const rejectedState = {
    candidates: [],
    decisions: [
      ...[1, 2, 3].map((index) => ({
        id: `D-approved-${index}`,
        status: "approved",
        authorization: { intent: stagingIntent, ruleId: "gate.deploy" },
      })),
      {
        id: "D-rejected",
        status: "rejected",
        authorization: { intent: stagingIntent, ruleId: "gate.deploy" },
      },
    ],
  };
  assert.equal(authorizationRuleCandidates.extractAuthorizationRuleCandidates(rejectedState, { minApprovals: 3 }).length, 0);

  const prodIntent = authorizationEngine.evaluateAuthorization({ tool: "Bash", command: "psql prod -c 'update orders set status=1'" }).intent;
  const prodState = {
    candidates: [],
    decisions: [1, 2, 3].map((index) => ({
      id: `D-prod-${index}`,
      status: "approved",
      authorization: { intent: prodIntent, ruleId: "gate.prod_write" },
    })),
  };
  assert.equal(authorizationRuleCandidates.extractAuthorizationRuleCandidates(prodState, { minApprovals: 3 }).length, 0);
});

test("Codex runtime environment is allowlisted and omits host secrets", () => {
  const env = codexRuntimeFiles.codexEnv(
    { daemon: { port: 7317 } },
    { id: "T-env" },
    {
      PATH: "/usr/bin",
      HOME: "/Users/tester",
      OPENAI_API_KEY: "sk-testsecretsecretsecret",
      SLACK_BOT_TOKEN: "xoxb-123456789012-secret",
      GH_TOKEN: "ghp_secret",
      SECOND_DAEMON: "localhost:9999",
    },
  );
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/Users/tester");
  assert.equal(env.SECOND_TASK_ID, "T-env");
  assert.equal(env.SECOND_DAEMON, "localhost:9999");
  assert.equal(env.SECOND_AUTH_PROXY, "http://localhost:9999/api/proxy/http");
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.SLACK_BOT_TOKEN, undefined);
  assert.equal(env.GH_TOKEN, undefined);
});

test("runtime adapters declare authorization capabilities and downgrade no-hook runtimes", () => {
  const codex = runtimes.getRuntimeAdapter("codex");
  assert.equal(codex.authorization.mode, "hooks");
  assert.equal(codex.authorization.granularity, "action");
  assert.equal(codex.authorization.supportsGateResume, true);

  const claude = runtimes.getRuntimeAdapter("claude-code");
  assert.equal(claude.authorization.mode, "none");
  assert.equal(claude.authorization.yellowZone, "deny");
});

test("Codex authorization hook fails closed when daemon is unavailable", () => {
  const hook = path.join(process.cwd(), ".codex", "hooks", "second_policy_hook.js");
  const result = spawnSync(process.execPath, [hook, "PreToolUse"], {
    input: JSON.stringify({ tool: "Bash", command: "rg TODO server" }),
    encoding: "utf8",
    env: {
      ...process.env,
      SECOND_DAEMON: "",
      SECOND_TASK_ID: "T-1",
    },
  });
  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.action, "deny");
  assert.match(payload.reason, /failed closed/);
});

test("Codex authorization hook maps authorization actions to blocking exit codes", () => {
  assert.equal(secondPolicyHook.exitCodeForAuthorizationResult({ action: "allow" }), 0);
  assert.equal(secondPolicyHook.exitCodeForAuthorizationResult({ action: "gate" }), 2);
  assert.equal(secondPolicyHook.exitCodeForAuthorizationResult({ action: "deny" }), 2);
  assert.equal(secondPolicyHook.exitCodeForAuthorizationResult({ action: "human_gate" }), 2);
  assert.equal(secondPolicyHook.daemonUrl("localhost:7317").href, "http://localhost:7317/api/authorize");
});

test("MCP authorization_check is listed and posts through daemon authorization API", async () => {
  assert.equal(mcp.TOOLS.some((tool) => tool.name === "authorization_check"), true);
  const requests = [];
  const result = await mcp.callTool(
    "authorization_check",
    {
      tool: "Bash",
      command: "git push origin main",
      dryRun: false,
    },
    {
      daemonUrl: new URL("http://127.0.0.1:7317"),
      daemonRequest: async (base, pathname, body) => {
        requests.push({ base: base.href, pathname, body });
        return { action: "gate", ruleId: "gate.push_shared", fingerprint: "fp-mcp" };
      },
    },
  );
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.action, "gate");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, "/api/authorize");
  assert.equal(requests[0].body.source, "Second MCP authorization proxy");
  assert.equal(requests[0].body.command, "git push origin main");
});

test("MCP authorization_check fails closed when configured daemon is unreachable", async () => {
  const result = await mcp.callTool(
    "authorization_check",
    {
      tool: "Bash",
      command: "rg TODO server",
      dryRun: true,
    },
    {
      daemonUrl: new URL("http://127.0.0.1:7317"),
      daemonRequest: async () => {
        throw new Error("connection refused");
      },
    },
  );
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.action, "deny");
  assert.equal(payload.ruleId, "deny.authorization_transport");
});

test("Slack secret settings keep plaintext out of public config and preserve masked inputs", () => {
  const secret = "xoxb-123456789012-secretsecret";
  const publicConfig = slackConfig.publicSlackConfigFrom({
    botToken: secret,
    appToken: "xapp-123456789012-secretsecret",
    signingSecret: "signing-secretsecret",
  }, {});
  const serialized = JSON.stringify(publicConfig);
  assert.equal(publicConfig.botTokenConfigured, true);
  assert.equal(publicConfig.appTokenConfigured, true);
  assert.doesNotMatch(serialized, /secretsecret/);
  assert.doesNotMatch(serialized, new RegExp(secret));

  const next = slackConfig.nextStoredSlackConfig(
    { botToken: "xoxb-old-token", appToken: "xapp-old-token" },
    { botToken: "********", appToken: "xapp-new-token" },
  );
  assert.equal(next.botToken, "xoxb-old-token");
  assert.equal(next.appToken, "xapp-new-token");
});

function authorizationState() {
  return {
    profile: { agentName: "测试分身" },
    tasks: [
      {
        id: "T-1",
        title: "测试授权任务",
        agent: "测试分身",
        engine: "Codex CLI",
        workspace: process.cwd(),
        status: "running",
        trace: [],
      },
    ],
    decisions: [],
    events: [],
    authorization: { grants: [], audit: [] },
  };
}

function authorizationDeps(state, overrides = {}) {
  let counter = 0;
  return {
    appendAuthorizationAudit: (target, entry) => {
      target.authorization.audit.unshift(entry);
    },
    appendDecisionLog: () => {},
    appendEvent: (target, event) => {
      target.events.unshift(event);
    },
    loadState: () => state,
    makeId: (prefix) => `${prefix}-${++counter}`,
    notifyDecisionRequested: async () => {},
    nowIso: () => "2026-07-08T00:00:00.000Z",
    quotaLimits: overrides.quotaLimits,
    saveState: () => {},
  };
}

function authorizationRouteDeps(state, overrides = {}) {
  const deps = authorizationDeps(state, overrides);
  return {
    ...deps,
    broadcast: () => {},
    decorateState: (target) => target,
    notifyDecisionRequested: async () => {},
    readBody: httpJson.readBody,
    sendJson: httpJson.sendJson,
  };
}

function responseRecorder() {
  return {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}
