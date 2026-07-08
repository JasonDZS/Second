"use strict";

const {
  NICE_AVATAR_SOURCE_URL,
  niceAvatarConfigFromSeed,
  niceAvatarDataUrl,
} = require("../../public/profile");

function nowIso() {
  return new Date().toISOString();
}

function seedState() {
  const createdAt = nowIso();
  const decisions = [
    {
      id: "D-1042",
      type: "授权",
      risk: "高",
      title: "请求生产数据库写权限",
      taskId: "T-2087",
      taskTitle: "修复订单重复扣款",
      source: "Slack #payments",
      agent: "李哲的分身",
      engine: "Codex CLI",
      status: "pending",
      selectedOption: "a",
      createdAt: "2026-07-07T02:31:40.000Z",
      summary:
        "任务由张薇在 Slack #payments 中 @李哲 发起,你的分身自动接管。它已定位到 orders 服务重复扣款的根因,补丁与 3 条新单测已完成并通过。执行 psql UPDATE 回填 37 条受影响订单时,被授权策略拦截:生产库写操作命中高风险策略,超出当前授权范围,任务已挂起、可恢复。",
      impact: [
        "prod-db · orders 表 · UPDATE 37 行(附回滚脚本)",
        "services/orders/refund.py · +42 -7",
        "tests/orders/test_refund.py · 新增 3 用例",
      ],
      options: [
        {
          id: "a",
          label: "批准本次写入",
          description: "仅放行本条 UPDATE,执行前自动存档回滚脚本",
          recommended: true,
        },
        {
          id: "b",
          label: "批准并生成规则候选",
          description: "后续同类订单回填进入 RULE_CANDIDATES,等你二次确认",
        },
        {
          id: "c",
          label: "改为人工执行",
          description: "分身输出 SQL 与核对清单,由 DBA 手动执行",
        },
      ],
      artifacts: ["PR #412 · fix: 幂等键缺失", "rollback-2087.sql", "trace · run-2087"],
    },
    {
      id: "D-1041",
      type: "选择",
      risk: "中",
      title: "通知服务 v2 兼容方案需要选型",
      taskId: "T-2085",
      taskTitle: "通知服务 v2 迁移",
      source: "Linear BAT-291",
      agent: "王雨桐的分身",
      engine: "Codex CLI",
      status: "pending",
      selectedOption: "a",
      createdAt: "2026-07-07T01:58:02.000Z",
      summary:
        "通知服务 v2 的 payload 结构变更影响 3 个下游消费者(billing / crm / mobile-push)。分身完成了两套迁移方案的实现与契约测试,均通过,需要你选定方向后继续。",
      impact: ["下游消费者 · billing / crm / mobile-push", "api/notify/schema.json · 结构变更"],
      options: [
        {
          id: "a",
          label: "方案 A · 双写过渡",
          description: "保留旧字段 90 天,下游零成本,技术债 90 天后清理",
          recommended: true,
        },
        {
          id: "b",
          label: "方案 B · 直接版本化 /v2",
          description: "干净但需 3 个下游同步发版,协调成本高",
        },
        {
          id: "c",
          label: "补充信息后再定",
          description: "让分身先出下游发版排期评估",
        },
      ],
      artifacts: ["方案对比 · notify-v2-plan.md", "契约测试报告 · 全部通过"],
    },
    {
      id: "D-1039",
      type: "审批",
      risk: "中",
      title: "PR 已就绪,请求合并到 main",
      taskId: "T-2082",
      taskTitle: "CI flaky 用例修复",
      source: "GitHub second/console",
      agent: "李哲的分身",
      engine: "Codex CLI",
      status: "pending",
      selectedOption: "a",
      createdAt: "2026-07-07T00:42:00.000Z",
      summary:
        "分身修复了 3 个间歇性失败的 CI 用例(竞态导致),连续 20 次全绿。改动仅涉及测试代码,但按你的策略,合并到 main 一律需要审批。",
      impact: ["tests/e2e/checkout.spec.ts · 重写等待逻辑", ".github/workflows/ci.yml · 重试策略"],
      options: [
        {
          id: "a",
          label: "批准合并",
          description: "squash 合并,自动带上风险清单",
          recommended: true,
        },
        {
          id: "b",
          label: "先跑一轮夜间全量",
          description: "明早出结果后自动重新请求",
        },
      ],
      artifacts: ["PR #408 · 20/20 全绿", "flaky 根因分析.md"],
    },
    {
      id: "D-1038",
      type: "补充",
      risk: "低",
      title: "周报数据口径需要确认",
      taskId: "T-2079",
      taskTitle: "竞品价格监控周报",
      source: "ClickUp",
      agent: "李哲的分身",
      engine: "Codex CLI",
      status: "done",
      selectedOption: "a",
      createdAt: "2026-07-06T23:24:20.000Z",
      decidedAt: "2026-07-07T00:02:04.000Z",
      summary:
        "周报里“降价 SKU 数”存在两种口径:按 SKU 去重或按变动次数。分身依据你的偏好拟选前者,已确认后恢复执行。",
      impact: ["reports/pricing-w27.md"],
      options: [
        {
          id: "a",
          label: "按 SKU 去重",
          description: "与上季度口径一致",
          recommended: true,
        },
        {
          id: "b",
          label: "按变动次数",
          description: "反映波动频率",
        },
      ],
      artifacts: ["pricing-w27.md 草稿"],
    },
    {
      id: "D-1036",
      type: "异常",
      risk: "高",
      title: "npm 官方源超时,请求改用内网镜像",
      taskId: "T-2071",
      taskTitle: "依赖升级",
      source: "Slack #eng-infra",
      agent: "李哲的分身",
      engine: "Codex CLI",
      status: "done",
      selectedOption: "a",
      createdAt: "2026-07-06T06:24:00.000Z",
      decidedAt: "2026-07-06T06:31:10.000Z",
      summary:
        "依赖安装连续 3 次超时。改源属于环境变更,命中异常处理策略。已批准使用内网镜像,任务当日恢复并完成。",
      impact: [".npmrc · registry 变更(仅本 workspace)"],
      options: [
        {
          id: "a",
          label: "本 workspace 改用内网镜像",
          description: "不影响全局配置",
          recommended: true,
        },
        {
          id: "b",
          label: "等官方源恢复",
          description: "任务挂起",
        },
      ],
      artifacts: ["安装日志 · 3 次超时记录"],
    },
  ];

  const tasks = [
    {
      id: "T-2087",
      title: "修复订单重复扣款",
      source: "Slack #payments",
      agent: "李哲的分身",
      engine: "Codex CLI",
      workspace: "run-2087",
      status: "needs_human",
      decisionId: "D-1042",
      startedAt: "2026-07-07T02:04:12.000Z",
      summary: "定位幂等键缺失,补丁和单测完成;生产库回填等待决策。",
      fileDelta: "3 文件 · +47 -7",
      trace: traceT2087("pending"),
    },
    {
      id: "T-2085",
      title: "通知服务 v2 迁移",
      source: "Linear BAT-291",
      agent: "王雨桐的分身",
      engine: "Codex CLI",
      workspace: "run-2085",
      status: "needs_human",
      decisionId: "D-1041",
      startedAt: "2026-07-07T01:12:03.000Z",
      summary: "两套兼容方案与契约测试已完成,等待方向选择。",
      fileDelta: "2 文件 · +96 -31",
      trace: traceT2085("pending"),
    },
    {
      id: "T-2082",
      title: "CI flaky 用例修复",
      source: "GitHub",
      agent: "李哲的分身",
      engine: "Codex CLI",
      workspace: "run-2082",
      status: "needs_human",
      decisionId: "D-1039",
      startedAt: "2026-07-06T08:41:00.000Z",
      summary: "重写等待逻辑,连续 20 次全绿;等待合并审批。",
      fileDelta: "2 文件 · +22 -14",
      trace: traceT2082(false),
    },
    {
      id: "T-2079",
      title: "竞品价格监控周报",
      source: "ClickUp",
      agent: "李哲的分身",
      engine: "Codex CLI",
      workspace: "run-2079",
      status: "running",
      decisionId: "D-1038",
      startedAt: "2026-07-06T23:01:12.000Z",
      summary: "已确认 SKU 去重口径,周报撰写中。",
      fileDelta: "1 文件 · +182 -0",
      trace: traceT2079(),
    },
  ];

  return {
    schemaVersion: 1,
    createdAt,
    updatedAt: createdAt,
    profile: {
      name: "李哲",
      avatar: "李",
      agentName: "李哲的分身",
      tagline: "人只做决策 · 经验永不离职",
      roleIntro: "人只做决策 · 经验永不离职",
      avatarStyle: "nice-avatar",
      avatarProvider: "nice-avatar",
      avatarSourceUrl: NICE_AVATAR_SOURCE_URL,
      avatarShape: "circle",
      avatarSeed: "李哲",
      avatarConfig: niceAvatarConfigFromSeed("李哲"),
      avatarUrl: niceAvatarDataUrl(niceAvatarConfigFromSeed("李哲"), "circle"),
    },
    daemon: {
      status: "online",
      port: 7317,
      startedAt: createdAt,
      version: "0.1.0",
      heartbeatAt: createdAt,
    },
    settings: {
      defaultEngine: "codex",
      autoDetect: true,
      codexNetworkAccess: false,
      publicAccess: {
        enabled: false,
        provider: "manual",
        manualUrl: "",
        activeUrl: "",
        status: "off",
        lastCheck: null,
        lastError: "",
      },
      lastScan: null,
    },
    engines: [
      {
        id: "codex",
        name: "Codex CLI",
        mono: "X",
        status: "unknown",
        isDefault: true,
        command: "codex",
        path: null,
        version: null,
        reason: "等待探针检测",
      },
      {
        id: "claude-code",
        name: "Claude Code",
        mono: "C",
        status: "unknown",
        isDefault: false,
        command: "claude",
        path: null,
        version: null,
        reason: "Phase 1 roadmap 保留; 当前实现使用 Codex CLI",
      },
      {
        id: "openclaw",
        name: "OpenClaw",
        mono: "O",
        status: "not_configured",
        isDefault: false,
        command: "openclaw",
        path: null,
        version: null,
        reason: "adapter 占位",
      },
    ],
    channels: [
      {
        id: "assistant",
        name: "对话助手",
        mono: "A",
        status: "connected",
        notify: true,
        meta: "本地浮动消息助手 · 右下角常驻 · 结果回传到本机对话",
      },
      {
        id: "slack",
        name: "Slack",
        mono: "S",
        status: "connected",
        notify: true,
        meta: "工作区 second-inc · 监听 @李哲 与 #eng-* 频道 · 决策按钮消息已启用",
      },
      {
        id: "linear",
        name: "Linear",
        mono: "L",
        status: "not_configured",
        notify: false,
        meta: "连接后,支持指派给我的 issue 与状态自动同步",
      },
      {
        id: "clickup",
        name: "ClickUp",
        mono: "C",
        status: "disconnected",
        notify: true,
        meta: "连接后,支持指派任务与定时任务触发",
      },
      {
        id: "feishu",
        name: "Feishu",
        mono: "F",
        status: "not_configured",
        notify: true,
        meta: "适配层占位: 后续接入飞书机器人消息与卡片审批",
      },
      {
        id: "dingding",
        name: "DingTalk",
        mono: "D",
        status: "not_configured",
        notify: true,
        meta: "适配层占位: 后续接入钉钉机器人消息与互动卡片",
      },
    ],
    assistant: {
      activeConversationId: "local-assistant",
      messages: [],
    },
    decisions,
    tasks,
    preferences: [
      {
        text: "PR 描述使用中文,附风险清单与回滚方式",
        source: "来自 14 次 PR 任务 · 最近引用 今天",
      },
      {
        text: "报表结论先行,数据放附录; SKU 统计按去重口径",
        source: "来自决策 D-1038 · 已被引用 3 次",
      },
      {
        text: "优先复用 utils/ 现有工具函数,避免新增依赖",
        source: "来自 code review 反馈 · 上周学习",
      },
    ],
    candidates: [
      {
        id: "RC-77",
        confidence: "92%",
        status: "pending",
        text: "staging 环境的数据回填 SQL 可自动放行(生产仍强制 Gate)",
        source: "从 6 次同类任务 + 决策 D-1042/D-1029/D-1017 提取",
      },
      {
        id: "RC-74",
        confidence: "85%",
        status: "pending",
        text: "仅改动文档(*.md)的 PR 可自动合并",
        source: "从 9 次全批准的文档 PR 提取",
      },
    ],
    rules: [
      {
        id: "AR-12",
        kind: "允许",
        text: "允许读取 repo second/* 的代码与 issue",
        source: "由李哲于 6/28 经决策中心确认 · 长期",
      },
      {
        id: "AR-13",
        kind: "允许",
        text: "允许发送 Slack 消息至 #eng-* 频道",
        source: "由李哲于 6/28 确认 · 长期",
      },
      {
        id: "P-03",
        kind: "强制 Gate",
        text: "生产环境写操作 · 一律进 Human Gate",
        source: "组织策略 P-03 · 不可被个人规则覆盖",
      },
      {
        id: "P-09",
        kind: "拒绝",
        text: "读取 .env 与 secret 文件 · 拒绝",
        source: "组织策略 P-09 · 不可覆盖",
      },
    ],
    events: [
      {
        id: "E-seed-1",
        at: "2026-07-07T02:31:40.000Z",
        type: "gate.block",
        text: "gate.block psql UPDATE(prod write) -> decision D-1042 created",
        taskId: "T-2087",
        decisionId: "D-1042",
      },
      {
        id: "E-seed-2",
        at: "2026-07-07T02:04:12.000Z",
        type: "task.start",
        text: "run.start run-2087 · worktree created · engine codex-cli",
        taskId: "T-2087",
      },
      {
        id: "E-seed-3",
        at: "2026-07-07T02:02:31.000Z",
        type: "route",
        text: "route @李哲 -> personal-agent(li-zhe) · auth check pass",
        taskId: "T-2087",
      },
    ],
  };
}

function traceT2087(decisionStatus) {
  const trace = [
    {
      kind: "entry",
      actor: "Slack",
      time: "10:02",
      title: "任务发起",
      description: "张薇在 #payments @李哲:“线上订单偶发重复扣款,今天能修吗?”",
      meta: null,
    },
    {
      kind: "agent",
      actor: "李哲的分身",
      time: "10:02",
      title: "@人路由 · 分身接住任务",
      description: "@李哲 默认路由到个人智能体。授权检查通过(代码读取 · 测试执行),未打扰本人。",
      meta: "auth check: repo:read ok · test:run ok · prod:write gate",
      exec: [
        ["10:02", "READ", "解析 Slack 消息 -> 意图:线上缺陷修复 · 紧急度:今日"],
        ["10:02", "PLAN", "匹配任务类型 bugfix -> 引擎 Codex CLI"],
        ["10:02", "READ", "加载记忆:LEARNED_PATTERNS · orders 服务历史决策 2 条"],
        ["10:02", "BASH", "授权预检:repo:read ok · test:run ok · prod:write gate"],
      ],
    },
    {
      kind: "runtime",
      actor: "Codex CLI",
      time: "10:04-10:31",
      title: "执行 · 27 次工具调用",
      description: "定位根因(幂等键缺失) -> 补丁 refund.py -> 新增 3 条单测,全部通过。",
      meta: "workspace: run-2087 · engine: codex exec --json",
      exec: [
        ["10:04", "PLAN", "拆解:复现 -> 定位根因 -> 修复 -> 单测验证"],
        ["10:05", "GREP", "rg \"charge\" services/orders -> 14 处引用"],
        ["10:11", "TEST", "pytest tests/orders -k refund -> 2 failed(复现成功)"],
        ["10:18", "EDIT", "refund.py · 引入幂等键校验 · +42 -7"],
        ["10:28", "TEST", "pytest tests/orders -> 21 passed"],
        ["10:31", "GATE", "psql UPDATE orders -> 授权拦截,挂起等待 D-1042"],
      ],
    },
    {
      kind: "gate",
      actor: "Human Gate",
      time: "10:31",
      title: "授权拦截 · 生成决策 D-1042",
      description: "psql UPDATE(生产库写)命中高风险策略,任务挂起、状态可恢复。证据包已推送 Slack 按钮 + 手机。",
      decisionId: "D-1042",
    },
  ];
  if (decisionStatus === "approved") {
    trace.push(
      {
        kind: "decision",
        actor: "决策中心",
        time: "刚刚",
        title: "李哲批准",
        description: "选择「批准本次写入」· 经 Decision MCP 回传 runtime。",
      },
      {
        kind: "runtime",
        actor: "Codex CLI",
        time: "恢复中",
        title: "审批通过 · 可恢复地继续执行",
        description: "恢复 run-2087 上下文,执行授权内的后续动作。",
      },
    );
  } else {
    trace.push({
      kind: "decision",
      actor: "等待决策",
      time: "现在",
      title: "等待李哲决策",
      description: "决策延迟计时中 · 手机推送与 Slack 按钮均可作答。",
    });
  }
  return trace;
}

function traceT2085(status) {
  return [
    {
      kind: "entry",
      actor: "Linear",
      time: "09:10",
      title: "任务指派",
      description: "BAT-291 指派给 @王雨桐,路由到其个人分身。",
    },
    {
      kind: "agent",
      actor: "王雨桐的分身",
      time: "09:10",
      title: "分身接管",
      description: "读取 BAT-291 上下文与历史相关决策,授权检查通过。",
      exec: [
        ["09:10", "READ", "拉取 Linear BAT-291 描述、评论与关联 PR"],
        ["09:10", "READ", "加载记忆:通知服务历史决策 D-987"],
        ["09:10", "PLAN", "识别为架构迁移 -> 双方案并行验证策略"],
      ],
    },
    {
      kind: "runtime",
      actor: "Codex CLI",
      time: "09:12-09:58",
      title: "两套方案并行验证",
      description: "双写过渡 vs 版本化 /v2,契约测试均通过。",
      exec: [
        ["09:12", "PLAN", "并行分支:方案 A 双写过渡 / 方案 B 版本化 /v2"],
        ["09:15", "EDIT", "api/notify/schema.json · 两分支各自变更"],
        ["09:34", "TEST", "契约测试 billing / crm / mobile-push -> 两方案均通过"],
        ["09:58", "GATE", "方向选择需人决策 -> 挂起,生成 D-1041"],
      ],
    },
    {
      kind: "gate",
      actor: "Human Gate",
      time: "09:58",
      title: "方向选择 · 生成决策 D-1041",
      description: "影响 3 个下游消费者,属方向选择类决策。",
      decisionId: "D-1041",
    },
    {
      kind: status === "pending" ? "decision" : "runtime",
      actor: status === "pending" ? "等待决策" : "决策中心",
      time: status === "pending" ? "现在" : "刚刚",
      title: status === "pending" ? "等待王雨桐决策" : "已决策",
      description: status === "pending" ? "证据包含方案对比与契约测试报告。" : "任务已恢复,按所选方案继续迁移。",
    },
  ];
}

function traceT2082(merged) {
  const trace = [
    {
      kind: "entry",
      actor: "GitHub",
      time: "昨天 16:40",
      title: "Issue 指派",
      description: "CI flaky 追踪 issue 指派 @李哲,分身接管。",
    },
    {
      kind: "agent",
      actor: "李哲的分身",
      time: "16:41",
      title: "低风险 · 自动执行",
      description: "改动仅涉测试代码,在授权范围内;合并仍需审批。",
      exec: [
        ["16:41", "READ", "解析 issue:3 个 flaky 用例 · 仅测试代码"],
        ["16:41", "PLAN", "风险评估:低 · 授权范围内可执行"],
      ],
    },
    {
      kind: "runtime",
      actor: "Codex CLI",
      time: "16:42-17:30",
      title: "定位竞态并修复",
      description: "重写等待逻辑,连续 20 次 CI 全绿。",
      exec: [
        ["16:42", "BASH", "重跑 checkout.spec.ts x50 -> 3 次失败,竞态确认"],
        ["17:06", "EDIT", "重写等待逻辑:轮询断言替代固定 sleep"],
        ["17:30", "TEST", "CI x20 -> 全绿"],
        ["17:31", "GATE", "请求合并到 main -> 生成 D-1039"],
      ],
    },
    {
      kind: "gate",
      actor: "Human Gate",
      time: "17:31",
      title: "合并审批 · D-1039",
      description: "按策略,合并 main 一律需要审批。",
      decisionId: "D-1039",
    },
  ];
  if (merged) {
    trace.push({
      kind: "out",
      actor: "回传",
      time: "刚刚",
      title: "PR #408 合并",
      description: "结果回传 GitHub 与 Slack,任务关闭。",
    });
  } else {
    trace.push({
      kind: "decision",
      actor: "等待决策",
      time: "现在",
      title: "等待合并审批",
      description: "20/20 全绿,证据包含 flaky 根因分析。",
    });
  }
  return trace;
}

function traceT2079() {
  return [
    {
      kind: "entry",
      actor: "ClickUp",
      time: "07:00",
      title: "定时任务触发",
      description: "每周一竞品价格监控周报,自动创建任务。",
    },
    {
      kind: "agent",
      actor: "李哲的分身",
      time: "07:00",
      title: "分身接管",
      description: "引用偏好「结论先行 · SKU 去重口径」组织报告结构。",
      exec: [
        ["07:00", "READ", "读取 ClickUp 定时任务模板与上周报告"],
        ["07:00", "READ", "加载偏好 PREFERENCES.md:结论先行 · SKU 去重口径"],
        ["07:01", "PLAN", "报告结构:结论 -> 变动明细 -> 附录"],
      ],
    },
    {
      kind: "gate",
      actor: "Human Gate",
      time: "07:24",
      title: "口径确认 · D-1038",
      description: "两种统计口径需补充确认,低风险 clarification。",
      decisionId: "D-1038",
    },
    {
      kind: "decision",
      actor: "决策中心",
      time: "08:02",
      title: "李哲确认口径(Slack 按钮)",
      description: "按 SKU 去重 · 该偏好已写入 PREFERENCES.md。",
    },
    {
      kind: "runtime",
      actor: "Codex CLI",
      time: "08:02-",
      title: "审批通过 · 恢复执行,生成周报",
      description: "reports/pricing-w27.md 撰写中,预计 10 分钟后回传 ClickUp。",
      exec: [
        ["08:02", "RESUME", "恢复 run-2079 会话上下文 · 写入已确认口径"],
        ["08:03", "BASH", "拉取本周价格快照 · 3 竞品 · 1,204 SKU"],
        ["08:05", "WRITE", "reports/pricing-w27.md · 结论先行结构,撰写中"],
      ],
    },
  ];
}

module.exports = {
  seedState,
  traceT2087,
};
