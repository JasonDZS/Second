# Second · Phase 1 MVP Roadmap

> Phase 1 目标只有一句话:**一个人安装 Second 后,别人 @ 他的任务能被他的分身接住、执行、在关键点找他决策、结果自动回传——他本人全程没有做过一次"中转"。**
>
> 本 roadmap 假设 1–2 人的工程投入,总周期约 12 周。所有排期按"最快证明单人价值"排列,而不是按架构完整性排列。

---

## 1. 范围裁决

MVP 的最大风险不是做不出来,而是做太多。以下裁决在 Phase 1 内不再讨论:

| 维度 | Phase 1 做 | Phase 1 明确不做 |
|---|---|---|
| 入口 | **仅 Slack**(@mention 接任务 + 审批按钮 + 移动推送三合一) | ClickUp/Linear/飞书/GitHub 适配 |
| 引擎 | **仅 Codex CLI**(本机 `codex exec --json` + hooks/permissions,作为本地智能体 runtime) | Claude Code/OpenClaw 及 adapter 抽象层的完整实现(只留 executor 接口占位) |
| 决策端 | Slack 消息按钮 + Slack 自带手机推送;localhost 控制台看重决策 | 自研移动 App、独立通知系统 |
| 智能体 | 个人智能体(单用户单 agent) | 系统智能体、组织路由、`@人` 转他人分身 |
| 记忆 | PREFERENCES.md 手写 + 决策历史自动记录 | learned patterns 自动提取、rule candidate 生成、离职交接 |
| 授权 | 静态授权规则文件 + 高风险强制 Human Gate | 授权的自动学习与升级 |
| trace | 最小 trace schema(任务/工具调用/决策/产物) | PROV/OTel 完整对齐、replay harness、评估框架 |
| 客户端 | daemon + CLI + localhost Web 控制台 | Tauri 桌面壳、托盘应用 |
| 部署 | 单机自托管(Docker Compose 一条命令) | 多租户云服务、团队后端 |

选 Slack 而不是 ClickUp 作为唯一入口的理由:任务进口、审批按钮、手机推送三件事在同一个集成里解决,省掉整条自研通知链路;且 Slack 的 agent 生态心智已经建立(用户见过 @Devin,教育成本最低)。

---

## 2. 里程碑总览

```
周   1  2  3  4  5  6  7  8  9  10 11 12
M0  ██ ██                                    技术验证 Spike
M1        ██ ██ ██                           Agent Core + Runtime Daemon
M2              ██ ██ ██                     Decision MCP + 决策收件箱
M3                    ██ ██ ██               Slack 入口闭环
M4                          ██ ██            Trace + 控制台
M5                                ██ ██ ██   Dogfood + 私测打磨
```

M1–M4 有意重叠:决策协议(M2)不依赖 Slack 入口(M3)即可先用 CLI 验证;控制台(M4)从 M1 起就以最粗糙的形态存在,M4 只是补齐。

---

## 3. 里程碑详情

### M0 · 技术验证 Spike(第 1–2 周)

目的:把四个"整个产品成立与否系于此"的技术假设,在写任何正式代码之前各用一天级别的原型打穿。

1. **Codex CLI 非交互驱动**:用 `codex exec --json` 以编程方式提交任务、注入 AGENTS.md / `PREFERENCES.md` / 任务线程上下文、解析 JSONL 事件流、拿到 session id,验证 `codex exec resume <SESSION_ID>` 可恢复。
2. **Codex hooks/permissions 拦截**:PreToolUse / PermissionRequest hook 能否在工具调用或审批请求前触发、把调用信息外送给本地授权服务、并根据返回映射为放行/拒绝/转人工决策。这是 Human Gate 的技术根基,**如果此路不通,整个授权模型要换方案,必须最先知道**。
3. **Slack 三合一**:一个 Slack App 同时做到:监听 @mention 事件、发送带 Approve/Reject/选项按钮的 Block Kit 消息、按钮回调回本地服务(经由公网隧道或 Socket Mode——自托管场景下 **Socket Mode 是关键验证点**,它决定用户是否需要公网暴露)。
4. **中断—决策—恢复**:Codex hook/approval 阻塞 → 人在 Slack 点按钮 → 本地授权服务收到结果 → Codex CLI 会话继续或 daemon 用 session id resume,端到端打通一次,哪怕全是硬编码。

验收:四个 spike 各有一段能跑的脏代码 + 一页结论(可行/需绕行/换方案)。

### M1 · Agent Core + Runtime Daemon(第 3–5 周)

个人智能体的"员工档案"与本地执行底座。

- 本地 daemon:常驻进程,任务队列,单任务生命周期(pending → running → needs_human → resumed → done/failed),超时与取消。
- Workspace 管理:每个任务独立 run 目录 / git worktree,产物归集到统一 artifacts 目录。
- 记忆与授权文件:账号目录下的 `PREFERENCES.md`(手写)、`AUTHORIZATION.md`(静态规则:工具白名单、路径边界、高风险动作清单)、`DECISIONS.log`(自动追加)。任务启动时作为 Codex CLI 的上下文与运行配置注入。
- Codex CLI runner:每个任务生成独立 prompt/context 包,以 `codex exec --json --sandbox workspace-write` 启动本地 Codex,消费 JSONL 事件流并归档 stdout/stderr/session id。
- Executor 接口:定义 adapter 接口(submit / status / interrupt / resume / collect),Phase 1 只有 CodexCliExecutor 一个实现,但接口先立住,防止实现渗漏。
- CLI:`second task add / list / show / cancel`,daemon 的最小操作面。

验收:命令行提交一个真实任务(如"给 X 仓库补一个 README 章节"),daemon 驱动 Codex CLI 在隔离 worktree 完成,产物落盘,全程状态可查。

### M2 · Decision MCP + 决策收件箱(第 5–7 周)

Human Gate 从机制变成协议。

- Decision MCP server:实现 `decision_request / decision_result / decision_list / decision_reply / decision_resolve` 五个工具,作为 Codex CLI 可调用的本地 MCP 服务,本地存储决策记录。
- 证据包 schema v0:背景、风险等级、推荐选项、备选项、影响范围、关联 task/session/artifact 链接。字段宁少勿滥,但结构从第一天起是结构化的。
- 两条触发路径:(a)Codex 主动调用 decision_request(缺信息/选方向);(b)Codex PreToolUse / PermissionRequest hook 拦截高风险动作后自动生成 decision_request。
- 恢复语义:决策 resolve 后,daemon 依据 session id 恢复原任务继续执行;决策超时策略(默认挂起,不默认放行)。
- 此阶段决策交互先走 CLI(`second decision list / approve / reject`),不等 Slack。

验收:一个任务中途触发高风险动作 → 被 Codex hook/approval 拦下 → CLI 里看到带证据包的决策项 → 批准 → Codex 任务从断点继续并完成。**这是产品核心叙事的第一次完整成立。**

### M3 · Slack 入口闭环(第 7–9 周)

人正式跳出中转循环。

- 任务进口:在频道或 DM 中 @Second 分身(MVP 中分身以独立 Slack App/Bot 身份出现,挂用户名字,如 `@zhangsan-second`),消息文本 + 线程上下文被解析为任务提交给 daemon。
- 任务确认策略:分身接单后在线程回帖认领,附预估动作摘要;授权范围内直接执行,范围外先出一条"计划 + 请求授权"消息。
- 决策出口:M2 的决策项以 Block Kit 按钮消息推送给本人(轻决策直接按钮解决;重决策附控制台深链)。手机推送由 Slack 移动端天然承担。
- 结果回传:任务完成后在原线程回帖结果摘要 + 产物(文件或链接),失败时回帖失败原因与 trace 链接。
- 安全默认:仅响应绑定用户配置允许的频道/人员;所有写操作按 AUTHORIZATION.md 边界执行。

验收(即 Phase 1 的核心 demo 剧本):同事在 Slack 线程里 @ 你的分身发任务 → 分身认领并在你本机执行 → 中途一条决策请求推到你手机,你点了一个按钮 → 结果回到原线程 → 你从头到尾没有打开过终端、没有复制过任何上下文。

### M4 · Trace + 控制台(第 8–10 周)

玻璃机房的第一块玻璃。

- Trace schema v0:统一事件流(task 事件、工具调用、决策事件、产物、失败/恢复),append-only 本地存储,每条事件带 task/session/decision 关联 id。
- localhost Web 控制台四个页面:任务列表与详情(状态、时间线)、trace 查看器(按任务展开事件流)、决策收件箱(重决策的完整证据包视图 + 决策历史)、授权与设置(展示当前规则、编辑白名单)。
- 紧急停止:控制台与 CLI 均可一键暂停/终止任务。
- 不做的:图表、评估指标面板、trace 导出格式对齐(记录格式预留扩展字段即可)。

验收:任何一个历史任务都能在控制台还原"谁发起 → 分身做了什么 → 哪一步被拦 → 谁批的 → 产物是什么"的完整链条。

### M5 · Dogfood + 私测打磨(第 10–12 周)

- 第 10 周起团队自己全量使用:所有互相委托的任务必须走 Second,禁止私下中转。每天记录摩擦点。
- 安装体验:Docker Compose(或单二进制)一条命令起 daemon + 控制台,`second init` 引导完成 Slack App 配置与 Codex CLI 检测(登录、模型、sandbox、hooks/MCP 配置),目标 **30 分钟内从零到第一个任务跑通**。
- 邀请 3–5 个外部私测用户(优先有真实团队协作场景的技术团队),每人一次安装陪跑 + 一周后回访。
- 收集三个核心指标的第一批真实数据(见第 4 节)。
- 产出:已知问题清单、Phase 2 输入(用户最先撞到的墙就是 Phase 2 的排序依据)。

---

## 4. Phase 1 度量

只看三个数,全部可从 trace 直接计算:

1. **零中转率**:经 Second 完成的任务中,发起人/受托人除决策外零操作的比例。这是产品命题本身,目标 > 70%。
2. **决策延迟**(decision request 发出 → 人点击按钮):衡量"决策去人所在处"是否成立,目标中位数 < 10 分钟(工作时间)。
3. **决策打扰密度**(每任务平均决策次数):过高说明授权边界太紧或证据包不足以让 agent 自主,过低要抽查是否漏拦了高风险动作。MVP 期先记录基线,不设目标。

辅助观察:任务成功率、恢复正确率(决策后任务是否真的从断点正确继续)。

---

## 5. 风险与预案

| 风险 | 影响 | 预案 |
|---|---|---|
| Codex hooks/PermissionRequest 无法同步阻塞或能力受限 | Human Gate 根基动摇 | M0 第一优先验证;备选:MCP 工具包装层代理所有敏感工具,拦截逻辑放包装层 |
| Slack Socket Mode 限制或审核问题 | 自托管用户需公网暴露,安装门槛陡增 | M0 验证;备选:官方托管一个轻量消息中继(只转发决策消息,不经手任务数据) |
| Codex CLI 账号/计费/自动化使用方式不适合私测 | 成本模型与合规风险 | 默认使用用户本机已登录的 Codex CLI;`second init` 只做检测不托管凭证;API key 模式仅作为 `codex exec` 的可选路径并在文档中明示 |
| Codex CLI 版本迭代破坏 hooks/JSONL 输出格式 | 持续维护税 | executor 层锁版本 + 兼容性冒烟测试,升级手动确认 |
| 分身"代答"引发同事反感或责任纠纷 | 产品社交层面翻车 | MVP 默认保守:认领必回帖、超授权必先问、结果标注"由 Second 代理执行";dogfood 期重点观察 |
| 决策疲劳(按钮点到麻木) | 安全形同虚设 | 记录打扰密度;证据包强制含风险等级;同类低风险决策支持"本任务内不再询问"的临时授权 |

---

## 6. 交付物清单(Phase 1 结束时应存在的东西)

工程侧:`second-daemon`(runtime + agent core + executor)、`second-cli`、`second-console`(localhost Web)、`second-slack-app`、`decision-mcp`(独立包,可脱离 Second 被任何 MCP runtime 使用——这是后续开源先行的那颗子弹)。

文档侧:30 分钟安装指南、AUTHORIZATION.md 规则参考、Decision 证据包 schema v0、trace schema v0、已知限制说明。

数据侧:团队 dogfood + 私测用户产生的第一批真实 trace 与决策数据——它同时是 Phase 2(learned patterns)的原料和第一篇论文(Human-Gated Decision Protocol)的实验素材。

---

## 7. Phase 1 之后的第一个决策点

第 12 周结束时,用 dogfood 数据回答一个问题:**用户最强的续用理由是"任务零中转"还是"决策收件箱"?**前者成立则 Phase 2 优先铺第二入口(Linear/ClickUp)扩大接单面;后者成立则优先开源 Decision MCP、把决策控制面做深(策略、批量、委托)。不要两头并进——Phase 2 的资源只够押一边。
