#!/usr/bin/env node
"use strict";

const { detectEngines, createTask, pauseTask, resumeCodexTask, runCodexTask, stopTask } = require("../server/codex-executor");
const { ensureProfileFiles, loadState, saveState } = require("../server/state");
const { startServer, resolveDecision } = require("../server/app");
const { serveMcp } = require("../server/mcp");
const { getChannelAdapter, listChannelAdapters } = require("../server/channels");

async function main(argv) {
  const [cmd, sub, ...rest] = argv;

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "serve") {
    const port = readFlag(rest, "--port") || process.env.SECOND_PORT;
    const host = readFlag(rest, "--host") || process.env.HOST || "127.0.0.1";
    const started = await startServer({ port: port ? Number(port) : undefined, host });
    process.stdout.write(`Second daemon listening at ${started.url}\n`);
    return;
  }

  if (cmd === "doctor") {
    const state = loadState();
    const engines = detectEngines(state);
    for (const engine of engines) {
      process.stdout.write(
        `${engine.name.padEnd(12)} ${engine.status.padEnd(8)} ${engine.version || ""} ${engine.path || engine.reason || ""}\n`,
      );
    }
    return;
  }

  if (cmd === "init") {
    const paths = ensureProfileFiles();
    const state = loadState();
    detectEngines(state);
    process.stdout.write(`Second initialized\n`);
    process.stdout.write(`Preferences: ${paths.preferencesFile}\n`);
    process.stdout.write(`Authorization: ${paths.authorizationFile}\n`);
    process.stdout.write(`Decisions log: ${paths.decisionsLogFile}\n`);
    process.stdout.write(`Codex config: .codex/config.toml\n`);
    return;
  }

  if (cmd === "task" && sub === "add") {
    const prompt = rest.join(" ").trim();
    if (!prompt) throw new Error("Usage: second task add <prompt>");
    const state = loadState();
    const task = createTask(state, { title: prompt, prompt, run: false });
    process.stdout.write(`${task.id} ${task.title}\n`);
    return;
  }

  if (cmd === "task" && sub === "list") {
    const state = loadState();
    for (const task of state.tasks.filter((item) => !item.archivedAt)) {
      process.stdout.write(`${task.id.padEnd(16)} ${String(task.status).padEnd(13)} ${task.title}\n`);
    }
    return;
  }

  if (cmd === "task" && sub === "show") {
    const id = rest[0];
    if (!id) throw new Error("Usage: second task show <task-id>");
    const state = loadState();
    const task = state.tasks.find((item) => item.id === id);
    if (!task) throw new Error(`Task not found: ${id}`);
    process.stdout.write(`${JSON.stringify(task, null, 2)}\n`);
    return;
  }

  if (cmd === "task" && sub === "run") {
    const id = rest[0];
    if (!id) throw new Error("Usage: second task run <task-id>");
    const state = loadState();
    runCodexTask(state, id);
    process.stdout.write(`started ${id}\n`);
    return;
  }

  if (cmd === "task" && (sub === "cancel" || sub === "stop")) {
    const id = rest[0];
    if (!id) throw new Error(`Usage: second task ${sub} <task-id>`);
    const state = loadState();
    const ok = stopTask(state, id);
    if (!ok) throw new Error(`Task not found: ${id}`);
    process.stdout.write(`stopped ${id}\n`);
    return;
  }

  if (cmd === "task" && (sub === "pause" || sub === "resume")) {
    const id = rest[0];
    if (!id) throw new Error(`Usage: second task ${sub} <task-id>`);
    const state = loadState();
    const ok = pauseTask(state, id, sub === "pause");
    if (!ok) throw new Error(`Task not found: ${id}`);
    process.stdout.write(`${sub === "pause" ? "paused" : "resumed"} ${id}\n`);
    return;
  }

  if (cmd === "task" && sub === "stop-all") {
    const state = loadState();
    let stopped = 0;
    for (const task of state.tasks.filter((item) => ["running", "needs_human", "paused", "pending_resume", "resuming"].includes(item.status))) {
      if (stopTask(state, task.id)) stopped += 1;
    }
    process.stdout.write(`stopped ${stopped} tasks\n`);
    return;
  }

  if (cmd === "decision" && sub === "list") {
    const state = loadState();
    for (const decision of state.decisions) {
      process.stdout.write(
        `${decision.id.padEnd(8)} ${decision.status.padEnd(9)} ${decision.risk}风险 ${decision.title}\n`,
      );
    }
    return;
  }

  if (cmd === "decision" && sub === "show") {
    const id = rest[0];
    if (!id) throw new Error("Usage: second decision show <decision-id>");
    const state = loadState();
    const decision = state.decisions.find((item) => item.id === id);
    if (!decision) throw new Error(`Decision not found: ${id}`);
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
    return;
  }

  if (cmd === "decision" && (sub === "approve" || sub === "reject")) {
    const id = rest[0];
    if (!id) throw new Error(`Usage: second decision ${sub} <decision-id>`);
    const state = loadState();
    const result = resolveDecision(state, id, {
      verdict: sub === "approve" ? "approved" : "rejected",
    });
    saveState(state);
    if (result.shouldResumeCodex) {
      resumeCodexTask(loadState(), result.task.id, result.decision.id);
      process.stdout.write(`${result.decision.id} ${result.decision.status} · resumed ${result.task.id}\n`);
    } else {
      process.stdout.write(`${result.decision.id} ${result.decision.status}\n`);
    }
    return;
  }

  if (cmd === "mcp" && sub === "serve") {
    serveMcp();
    return;
  }

  if (cmd === "channel" && sub === "list") {
    for (const adapter of listChannelAdapters()) {
      process.stdout.write(
        `${adapter.id.padEnd(10)} ${adapter.status.padEnd(15)} task=${Boolean(adapter.supports.taskIntake)} decision=${Boolean(adapter.supports.decisionButtons)} ${adapter.name}\n`,
      );
    }
    return;
  }

  if (cmd === "slack" && sub === "manifest") {
    process.stdout.write(
      `${JSON.stringify(
        getChannelAdapter("slack").manifest({
          socketMode: rest.includes("--socket-mode"),
        }),
        null,
        2,
      )}\n`,
    );
    return;
  }

  throw new Error(`Unknown command: ${[cmd, sub].filter(Boolean).join(" ")}`);
}

function readFlag(args, flag) {
  const eq = args.find((arg) => arg.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = args.indexOf(flag);
  if (i !== -1) return args[i + 1];
  return null;
}

function printHelp() {
  process.stdout.write(`Second local daemon

Usage:
  second serve [--host 127.0.0.1] [--port 7317]
  second init
  second doctor
  second task add <prompt>
  second task list
  second task show <task-id>
  second task run <task-id>
  second task pause <task-id>
  second task resume <task-id>
  second task cancel <task-id>
  second task stop-all
  second decision list
  second decision show <decision-id>
  second decision approve <decision-id>
  second decision reject <decision-id>
  second channel list
  second mcp serve
  second slack manifest [--socket-mode]
`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
