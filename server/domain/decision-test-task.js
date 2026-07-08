"use strict";

const fs = require("fs");
const path = require("path");

function createDecisionTestTaskHandler(deps = {}) {
  const {
    PRODUCT_NAME = "Second",
    RUNS_DIR,
    appendEvent,
    makeId,
    nowIso,
    saveState,
  } = deps;

  function createDecisionTestTask(state, body = {}) {
    const createdAt = nowIso();
    const taskId = makeId("T");
    const decisionId = makeId("D");
    const title = (body.title || "测试: 前端审核后继续执行").trim().slice(0, 120);
    const workspace = path.join(RUNS_DIR, taskId);
    fs.mkdirSync(workspace, { recursive: true });

    const task = {
      id: taskId,
      title,
      source: `${PRODUCT_NAME} test harness`,
      agent: state.profile.agentName,
      engine: `${PRODUCT_NAME} daemon`,
      workspace,
      status: "needs_human",
      decisionId,
      startedAt: createdAt,
      completedAt: null,
      summary: "测试任务已提交,正在等待你在前端决策收件箱中审批。",
      fileDelta: "0 文件",
      continuation: {
        type: "decision-test",
        approvedMessage: body.approvedMessage || "前端批准后,daemon 已按批准路径继续执行。",
        rejectedMessage: body.rejectedMessage || "前端拒绝后,daemon 已按拒绝路径执行替代方案。",
      },
      trace: [
        {
          kind: "entry",
          actor: `${PRODUCT_NAME} test harness`,
          time: "刚刚",
          title: "测试任务提交",
          description: "该任务用于验证:提交决策请求 -> 前端审核 -> daemon 根据审核结果继续执行。",
        },
        {
          kind: "agent",
          actor: state.profile.agentName,
          time: "刚刚",
          title: "分身接管测试任务",
          description: "分身读取任务输入后判断继续执行需要人类确认,因此生成决策请求并把任务交给 Human Gate。",
          exec: [
            ["刚刚", "READ", "读取测试任务输入与 continuation 配置"],
            ["刚刚", "PLAN", "需要前端审核后才能继续执行"],
            ["刚刚", "GATE", `创建决策 ${decisionId} 并挂起任务`],
          ],
        },
        {
          kind: "gate",
          actor: "Human Gate",
          time: "刚刚",
          title: `等待决策 · ${decisionId}`,
          description: "任务已挂起。请在前端决策收件箱中批准或拒绝该测试决策。",
          decisionId,
        },
      ],
      artifacts: [],
    };

    const decision = {
      id: decisionId,
      type: "审批",
      risk: body.risk || "中",
      title: body.decisionTitle || "是否允许测试任务继续执行",
      taskId,
      taskTitle: title,
      source: `${PRODUCT_NAME} test harness`,
      agent: state.profile.agentName,
      engine: `${PRODUCT_NAME} daemon`,
      status: "pending",
      selectedOption: "approve",
      createdAt,
      summary:
        body.summary ||
        "这是一个端到端测试决策。你在前端选择批准或拒绝后,daemon 会读取决策结果,写入本地执行产物,并把任务推进到完成状态。",
      impact: [
        `workspace · ${workspace}`,
        "产物 · decision-result.json",
        "trace · 记录审核结果与恢复执行路径",
      ],
      options: [
        {
          id: "approve",
          label: "批准继续执行",
          description: "daemon 将写入 approved 结果并完成任务",
          recommended: true,
        },
        {
          id: "fallback",
          label: "改走替代方案",
          description: "可选择此项后点批准,用于验证非默认批准路径",
        },
      ],
      artifacts: ["等待生成 · decision-result.json"],
    };

    state.tasks.unshift(task);
    state.decisions.unshift(decision);
    appendEvent(state, {
      type: "test.decision.created",
      text: `test.decision.created ${taskId} -> ${decisionId}`,
      taskId,
      decisionId,
    });
    saveState(state);
    return { task, decision };
  }

  function completeDecisionTestTask(state, task, decision, verdict) {
    const decidedAt = decision.decidedAt || nowIso();
    const artifactPath = path.join(task.workspace, "decision-result.json");
    const selected = decision.options?.find((option) => option.id === decision.selectedOption);
    const payload = {
      taskId: task.id,
      decisionId: decision.id,
      verdict,
      selectedOption: decision.selectedOption,
      selectedLabel: selected?.label || null,
      decidedAt,
      result:
        verdict === "approved"
          ? task.continuation.approvedMessage
          : task.continuation.rejectedMessage,
    };

    fs.mkdirSync(task.workspace, { recursive: true });
    fs.writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`);

    task.status = "done";
    task.completedAt = nowIso();
    task.summary =
      verdict === "approved"
        ? `前端已批准 ${decision.id},测试任务按审核结果继续执行并完成。`
        : `前端已拒绝 ${decision.id},测试任务按拒绝路径执行替代方案并完成。`;
    task.fileDelta = "1 文件 · decision-result.json";
    task.artifacts = [
      {
        label: "decision-result.json",
        path: artifactPath,
      },
    ];
    task.trace.push(
      {
        kind: "decision",
        actor: "决策中心",
        time: "刚刚",
        title: `${decision.id} ${verdict === "approved" ? "已批准" : "已拒绝"}`,
        description: `前端审核结果已回传 daemon。选项: ${selected?.label || decision.selectedOption}`,
      },
      {
        kind: "agent",
        actor: task.agent,
        time: "刚刚",
        title: verdict === "approved" ? "分身恢复执行" : "分身切换替代路径",
        description:
          verdict === "approved"
            ? "分身读取批准结果,携带本次决策令牌恢复任务,并交给 daemon 执行后续动作。"
            : "分身读取拒绝结果,停止原方案,改走替代处理路径并记录可审计产物。",
        exec: [
          ["刚刚", "READ", `读取决策结果 ${decision.id}: ${verdict}`],
          ["刚刚", "PLAN", verdict === "approved" ? "按批准路径继续" : "按拒绝路径改道"],
          ["刚刚", "WRITE", "准备写入 decision-result.json"],
        ],
      },
      {
        kind: "runtime",
        actor: `${PRODUCT_NAME} daemon`,
        time: "刚刚",
        title: "根据审核结果继续执行",
        description: payload.result,
        meta: artifactPath,
      },
      {
        kind: "out",
        actor: `${PRODUCT_NAME} daemon`,
        time: "刚刚",
        title: "测试任务完成",
        description: "已写入 decision-result.json,可在任务 Trace 中查看完整链路。",
      },
    );

    decision.artifacts = [
      ...(decision.artifacts || []).filter((item) => !String(item).includes("等待生成")),
      "decision-result.json",
    ];
    appendEvent(state, {
      type: "test.decision.completed",
      text: `test.decision.completed ${task.id} verdict=${verdict} artifact=${artifactPath}`,
      taskId: task.id,
      decisionId: decision.id,
    });
  }

  return {
    createDecisionTestTask,
    completeDecisionTestTask,
  };
}

module.exports = {
  createDecisionTestTaskHandler,
};
