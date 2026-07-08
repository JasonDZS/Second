"use strict";

const { cleanProfileText } = require("./profile");
const { createDecisionTestTaskHandler } = require("./decision-test-task");

function createDecisionDomain(deps = {}) {
  const {
    PRODUCT_NAME = "Second",
    RUNS_DIR,
    appendDecisionLog,
    appendEvent,
    makeId,
    nowIso,
    saveState,
    stopTask,
    traceT2087,
    notifyDecisionRequested = async () => {},
    notifyDecisionResolved = async () => {},
  } = deps;

  const { createDecisionTestTask, completeDecisionTestTask } = createDecisionTestTaskHandler({
    PRODUCT_NAME,
    RUNS_DIR,
    appendEvent,
    makeId,
    nowIso,
    saveState,
  });

  function appendDecisionReply(state, id, body = {}) {
    const decision = state.decisions.find((item) => item.id === id);
    if (!decision) {
      const error = new Error("Decision not found");
      error.statusCode = 404;
      throw error;
    }
    if (decision.archivedAt) {
      const error = new Error("Decision is archived");
      error.statusCode = 409;
      throw error;
    }
    const message = cleanReplyMessage(body.message, 4000);
    if (!message) {
      const error = new Error("Reply message is required");
      error.statusCode = 400;
      throw error;
    }
    const role = body.role === "agent" ? "agent" : "human";
    const reply = {
      id: makeId("R"),
      at: nowIso(),
      role,
      actor: cleanProfileText(body.actor, role === "agent" ? decision.agent || "分身" : "你", 80),
      message,
    };
    decision.replies = [...(decision.replies || []), reply];

    const task = decision.taskId ? state.tasks.find((item) => item.id === decision.taskId) : null;
    if (task) {
      task.status = role === "human" && task.codexSessionId && decision.status === "pending" ? "pending_resume" : "needs_human";
      task.completedAt = null;
      task.summary =
        role === "human"
          ? task.codexSessionId && decision.status === "pending"
            ? "你已补充信息,daemon 将恢复分身补证据后回到收件箱。"
            : "你已补充信息,等待分身处理。"
          : "分身已补充信息,等待你继续决策。";
      task.trace.push({
        kind: role === "human" ? "decision" : "agent",
        actor: role === "human" ? "决策中心" : task.agent,
        time: "刚刚",
        title: role === "human" ? "人类补充信息" : "分身补充信息",
        description: message,
        decisionId: decision.id,
      });
    }

    appendEvent(state, {
      type: role === "human" ? "decision.reply.human" : "decision.reply.agent",
      text: `decision.reply.${role} ${decision.id}`,
      taskId: decision.taskId,
      decisionId: decision.id,
    });
    if (body.persist !== false) {
      appendDecisionLog({
        event: `decision.reply.${role}`,
        decisionId: decision.id,
        taskId: decision.taskId,
        actor: reply.actor,
        message,
      });
      saveState(state);
    }
    return {
      decision,
      reply,
      task,
      shouldResumeCodex: Boolean(role === "human" && decision.status === "pending" && task?.codexSessionId),
    };
  }

  function shouldCompleteClarificationDecision(result, body = {}) {
    return Boolean(
      result.reply?.role === "human" &&
        result.decision?.status === "pending" &&
        result.decision?.type === "补充" &&
        body.intent !== "request_agent_info",
    );
  }

  function markClarificationDecisionApproved(state, result, body = {}) {
    const { decision, task, reply } = result;
    const selectedOption =
      body.optionId ||
      decision.selectedOption ||
      decision.options?.find((option) => option.recommended)?.id ||
      decision.options?.[0]?.id ||
      null;
    decision.status = "approved";
    if (selectedOption) decision.selectedOption = selectedOption;
    decision.decidedAt = nowIso();
    result.autoResolved = true;
    result.shouldResumeCodex = Boolean(task?.codexSessionId);

    if (task) {
      task.status = task.codexSessionId ? "pending_resume" : "paused";
      task.summary = task.codexSessionId
        ? `已收到补充信息,等待 daemon 恢复 ${task.agent} 继续执行。`
        : "已收到补充信息,但没有可恢复 Codex session。";
      task.trace.push({
        kind: "decision",
        actor: "决策中心",
        time: "刚刚",
        title: `${decision.id} 补充信息已满足`,
        description: `已收到 ${reply.actor || "你"} 的补充信息,将按选项 ${decision.selectedOption || "默认"} 恢复任务。`,
        decisionId: decision.id,
      });
    }

    appendEvent(state, {
      type: "decision.clarification.completed",
      text: `decision.clarification.completed ${decision.id} option=${decision.selectedOption || ""}`,
      taskId: decision.taskId,
      decisionId: decision.id,
    });
    appendDecisionLog({
      event: "decision.clarification.completed",
      decisionId: decision.id,
      taskId: decision.taskId,
      selectedOption: decision.selectedOption,
      replyId: reply.id,
      title: decision.title,
    });
    saveState(state);
  }

  function resolveDecision(state, id, body) {
    const decision = state.decisions.find((item) => item.id === id);
    if (!decision) {
      const error = new Error("Decision not found");
      error.statusCode = 404;
      throw error;
    }
    if (decision.archivedAt) {
      const error = new Error("Decision is archived");
      error.statusCode = 409;
      throw error;
    }
    const verdict = body.verdict === "rejected" ? "rejected" : "approved";
    const fallbackOption =
      verdict === "rejected"
        ? decision.options?.find((option) => /reject|deny|fallback|manual|人工|拒绝|替代/i.test(`${option.id} ${option.label}`))?.id
        : decision.selectedOption;
    decision.status = verdict;
    decision.selectedOption = body.optionId || fallbackOption || decision.selectedOption;
    decision.decidedAt = nowIso();

    const task = state.tasks.find((item) => item.id === decision.taskId);
    if (task) {
      if (task.continuation?.type === "decision-test") {
        completeDecisionTestTask(state, task, decision, verdict);
        appendEvent(state, {
          type: `decision.${verdict}`,
          text: `decision.${verdict} ${decision.id} option=${decision.selectedOption}`,
          taskId: decision.taskId,
          decisionId: decision.id,
        });
        appendDecisionLog({
          event: `decision.${verdict}`,
          decisionId: decision.id,
          taskId: decision.taskId,
          selectedOption: decision.selectedOption,
          title: decision.title,
        });
        saveState(state);
        notifyDecisionResolved(decision, task).catch(() => {});
        return { decision, task };
      }

      if (verdict === "approved") {
        task.status = task.codexSessionId ? "pending_resume" : "paused";
        task.summary = task.codexSessionId
          ? `已批准 ${decision.id},等待 daemon 恢复 Codex session ${shortId(task.codexSessionId)}。`
          : `已批准 ${decision.id},但未捕获 Codex session id,无法自动恢复。`;
        if (task.id === "T-2087") task.trace = traceT2087("approved");
        else {
          task.trace.push({
            kind: "decision",
            actor: "决策中心",
            time: "刚刚",
            title: `${decision.id} 已批准`,
            description: task.codexSessionId
              ? `决策经 ${PRODUCT_NAME} 回传 daemon,准备通过 codex exec resume 恢复 session ${task.codexSessionId}。`
              : "决策已记录,但该任务没有可恢复 Codex session id,daemon 不会伪造继续执行。",
          });
        }
      } else {
        task.status = task.codexSessionId ? "pending_resume" : "paused";
        task.summary = task.codexSessionId
          ? `已拒绝 ${decision.id},等待 daemon 恢复 Codex session ${shortId(task.codexSessionId)} 处理拒绝路径。`
          : `已拒绝 ${decision.id},等待分身调整方案。`;
        task.trace.push({
          kind: "decision",
          actor: "决策中心",
          time: "刚刚",
          title: `${decision.id} 已拒绝`,
          description: task.codexSessionId
            ? `拒绝结果将通过 codex exec resume 送回 session ${task.codexSessionId},由分身调整方案或停止原动作。`
            : "分身收到拒绝结果,将调整方案后重新请求或转人工。",
        });
      }
      if (task.codexSessionId && task.id !== "T-2087") {
        task.trace.push({
          kind: "agent",
          actor: task.agent,
          time: "刚刚",
          title: "分身准备恢复可恢复式 session",
          description: `daemon 将携带 ${decision.id} 的审核结果恢复 Codex session ${task.codexSessionId}。`,
        });
      }
    }

    appendEvent(state, {
      type: `decision.${verdict}`,
      text: `decision.${verdict} ${decision.id} option=${decision.selectedOption}`,
      taskId: decision.taskId,
      decisionId: decision.id,
    });
    appendDecisionLog({
      event: `decision.${verdict}`,
      decisionId: decision.id,
      taskId: decision.taskId,
      selectedOption: decision.selectedOption,
      title: decision.title,
    });
    saveState(state);
    notifyDecisionResolved(decision, task).catch(() => {});
    return { decision, shouldResumeCodex: Boolean(task?.codexSessionId), task };
  }

  function archiveTask(state, taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) {
      const error = new Error("Task not found");
      error.statusCode = 404;
      throw error;
    }
    const archivedAt = nowIso();
    task.archivedAt = task.archivedAt || archivedAt;
    if (["running", "resuming", "pending_resume"].includes(task.status)) {
      stopTask(state, task.id);
      task.archivedAt = task.archivedAt || archivedAt;
    }
    let archivedDecisions = 0;
    for (const decision of state.decisions.filter((item) => item.taskId === task.id)) {
      if (!decision.archivedAt) {
        decision.archivedAt = archivedAt;
        archivedDecisions += 1;
      }
    }
    appendEvent(state, {
      type: "task.archived",
      text: `task.archived ${task.id} decisions=${archivedDecisions}`,
      taskId: task.id,
    });
    saveState(state);
    return { task, archivedDecisions };
  }

  function createMcpDecisionRequest(state, args = {}) {
    const id = args.id || makeId("D");
    const task = args.taskId ? state.tasks.find((item) => item.id === args.taskId) : null;
    const decision = {
      id,
      type: args.type || "审批",
      risk: args.risk || "中",
      title: args.title || "Codex 请求 Human Gate 审核",
      taskId: args.taskId || null,
      taskTitle: args.taskTitle || task?.title || args.title || "Codex 任务",
      source: args.source || "Decision MCP",
      agent: args.agent || task?.agent || state.profile.agentName,
      engine: args.engine || "Codex CLI",
      status: "pending",
      selectedOption: args.options?.[0]?.id || "a",
      createdAt: nowIso(),
      summary: args.summary || "Codex CLI 在执行过程中请求人类审核,任务已在 Human Gate 挂起。",
      impact: args.impact || [],
      options:
        args.options && args.options.length
          ? args.options
          : [
              {
                id: "a",
                label: "批准",
                description: "允许 agent 继续执行当前方案",
                recommended: true,
              },
              {
                id: "b",
                label: "拒绝",
                description: "阻止当前方案,要求 agent 调整",
              },
            ],
      artifacts: args.artifacts || [],
      replies: [],
    };
    if (args.channel) decision.channel = args.channel;
    else if (task?.channel) decision.channel = task.channel;
    if (args.slack) decision.slack = args.slack;
    else if (task?.slack) decision.slack = task.slack;
    state.decisions.unshift(decision);

    if (task) {
      task.status = "needs_human";
      task.decisionId = id;
      task.summary = task.codexSessionId
        ? `Codex session ${shortId(task.codexSessionId)} 已在决策点挂起,等待前端审核。`
        : "Codex 已请求 Human Gate,等待前端审核并捕获可恢复 session。";
      task.trace.push(
        {
          kind: "agent",
          actor: task.agent,
          time: "刚刚",
          title: "分身提交 Human Gate 决策",
          description: decision.summary,
          exec: [
            ["刚刚", "PLAN", "继续执行需要人类审核"],
            ["刚刚", "MCP", `decision_request -> ${id}`],
            ["刚刚", "STOP", `等待 ${PRODUCT_NAME} 前端审核后恢复 Codex session`],
          ],
        },
        {
          kind: "gate",
          actor: "Human Gate",
          time: "刚刚",
          title: `等待决策 · ${id}`,
          description: "Codex exec 会在收到 pending 结果后结束当前进程;daemon 将在审核后用 codex exec resume 恢复同一 session。",
          decisionId: id,
        },
      );
    }

    appendEvent(state, {
      type: "decision.request",
      text: `decision.request ${id} · ${decision.title}`,
      taskId: decision.taskId,
      decisionId: id,
    });
    appendDecisionLog({
      event: "decision.request",
      decisionId: id,
      taskId: decision.taskId,
      risk: decision.risk,
      title: decision.title,
    });
    saveState(state);
    notifyDecisionRequested(decision, task).catch(() => {});
    return {
      id,
      status: "pending",
      instruction: `Stop now and finish with SECOND_WAITING_FOR_DECISION:${id}. ${PRODUCT_NAME} daemon will resume this Codex session after human review.`,
      decision,
      task,
    };
  }


  return {
    appendDecisionReply,
    archiveTask,
    cleanReplyMessage,
    createDecisionTestTask,
    createMcpDecisionRequest,
    markClarificationDecisionApproved,
    resolveDecision,
    shouldCompleteClarificationDecision,
  };
}

function cleanReplyMessage(value, maxLength = 4000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, maxLength);
}

function shortId(value) {
  if (!value) return "";
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

module.exports = {
  cleanReplyMessage,
  createDecisionDomain,
  shortId,
};
