"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { RUNS_DIR, appendEvent, makeId, nowIso, saveState } = require("../state");

function createTask(state, input) {
  const id = makeId("T");
  const title = (input.title || input.prompt || "本地 Codex 任务").trim().slice(0, 120);
  const createdAt = nowIso();
  const runName = `run-${id.toLowerCase()}`;
  const workspaceSetup = prepareTaskWorkspace(id, input.workspace);
  const workspace = workspaceSetup.workspace;
  const artifactsDir = path.join(workspace, "artifacts");
  const entryActor = input.channel?.name || input.source || "localhost console";
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(artifactsDir, { recursive: true });

  const task = {
    id,
    title,
    source: input.source || "localhost console",
    agent: state.profile.agentName,
    engine: "Codex CLI",
    workspace,
    sourceWorkspace: workspaceSetup.sourceWorkspace,
    workspaceMode: workspaceSetup.mode,
    createdAt,
    status: "pending",
    decisionId: null,
    startedAt: null,
    completedAt: null,
    summary: `等待派发给${state.profile.agentName}。`,
    fileDelta: "0 文件",
    prompt: input.prompt || title,
    messageText: input.messageText || "",
    sourceMessage: {
      channelId: input.channel?.id || null,
      channelName: input.channel?.name || input.source || "localhost console",
      text: input.messageText || input.prompt || title,
      external: input.channel?.external || input.slack || null,
    },
    trace: [
      {
        kind: "entry",
        actor: entryActor,
        time: "刚刚",
        title: "任务创建",
        description: `${entryActor} 创建任务,准备派发给${state.profile.agentName}。`,
        meta: workspaceSetup.mode === "git-worktree" ? `git worktree · ${workspaceSetup.sourceWorkspace}` : workspaceSetup.mode,
      },
    ],
    agentEvents: [],
    runName,
    artifactsDir,
    outputFile: path.join(artifactsDir, "last-message.md"),
    rawLogFile: path.join(artifactsDir, "codex-jsonl.log"),
  };
  if (input.slack) task.slack = input.slack;
  if (input.channel) task.channel = input.channel;
  if (input.agent) task.agent = input.agent;
  state.tasks.unshift(task);
  appendEvent(state, {
    type: "task.created",
    text: `task.created ${id} · ${title}`,
    taskId: id,
  });
  saveState(state);
  return task;
}

function prepareTaskWorkspace(taskId, requestedWorkspace) {
  if (!requestedWorkspace) {
    const workspace = path.join(RUNS_DIR, taskId);
    fs.mkdirSync(workspace, { recursive: true });
    return { workspace, sourceWorkspace: null, mode: "run-dir" };
  }

  const sourceWorkspace = path.resolve(requestedWorkspace);
  if (isGitWorkTree(sourceWorkspace)) {
    const workspace = path.join(RUNS_DIR, taskId, "worktree");
    fs.mkdirSync(path.dirname(workspace), { recursive: true });
    try {
      if (!fs.existsSync(workspace)) {
        execFileSync("git", ["-C", sourceWorkspace, "worktree", "add", "--detach", workspace, "HEAD"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
      return { workspace, sourceWorkspace, mode: "git-worktree" };
    } catch {
      return { workspace: sourceWorkspace, sourceWorkspace, mode: "direct-workspace" };
    }
  }

  fs.mkdirSync(sourceWorkspace, { recursive: true });
  return { workspace: sourceWorkspace, sourceWorkspace, mode: "direct-workspace" };
}

function isGitWorkTree(workspace) {
  try {
    const result = execFileSync("git", ["-C", workspace, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return result === "true";
  } catch {
    return false;
  }
}

module.exports = {
  createTask,
  isGitWorkTree,
  prepareTaskWorkspace,
};
