# Second 授权体系实现计划

> 本文档承接 `docs/second-authorization-design.md`,目标是把授权体系从设计原则拆成可执行的工程阶段。每个阶段都定义:何时可以开始、实现范围、测试验收、不得带入下一阶段的未决风险。
>
> 核心排序原则:先打通"解析 -> dry-run 可视化测试 -> 拦截 -> 决策 -> 授权凭证 -> resume 后放行同一动作"的最小闭环,再做规则学习、环境加固和多 runtime 扩展。

---

## 0. 总体验收口径

授权体系不是 UI 功能,而是 daemon 侧的执法链路。任何阶段完成时都必须满足四条底线:

1. **失败关闭**:规则解析失败、daemon 不可达、动作无法分类时,不得默认放行。
2. **可审计**:每次 allow / gate / deny / grant 消耗 / grant 过期都能在本地审计日志或 task trace 中找到原因、规则 id 与 task/decision 关联。
3. **不靠 prompt 执法**:prompt 只提示 agent 主动配合;真正放行、拒绝、挂起只能由 daemon 授权引擎决定。
4. **前端不做裁判**:前端只负责展示、测试、管理请求与人工确认;不得在浏览器里复制一套授权规则,也不得让浏览器本地判断成为 allow/gate/deny 的来源。

所有代码阶段的基础命令:

```bash
npm run check
npm test
```

授权相关测试优先放在 `test/phase1/authorization*.test.js` 或既有 `test/phase1/domain-http.test.js` 中;涉及前端的用例覆盖 Auth view render/action,涉及 hook 子进程的用例覆盖真实 stdin/stdout/exit code。

---

## 1. Phase A · 现状冻结与契约确认

### 何时开始

- `docs/second-authorization-design.md` 已作为产品原则冻结。
- 团队确认当前 Phase 1 现状只是策略雏形:正则判断、默认 allow、没有授权凭证账本、规则候选主要是 UI scaffolding。
- 暂不改用户可见行为,先把实现契约写清楚。

### 实现范围

- 补一份当前差距清单:现有 `server/policy.js`、Codex hook、Decision MCP、resume、Auth view 分别已覆盖什么、缺什么。
- 定义授权引擎输入输出契约:
  - 输入:`tool`, `args`, `task_ctx`, `runtime_ctx`, `actor_ctx`。
  - 输出:`allow | gate | deny`, `reason`, `ruleId`, `intent`, `fingerprint`, `decisionId?`。
- 定义 intent 五元组的数据结构:
  - `action`: read / write / exec / communicate / spend / deploy / system_change / unknown。
  - `target`: path / repo / branch / domain / recipient / service。
  - `environment`: local / dev / staging / prod / external / unknown。
  - `reversibility`: reversible / hard_to_reverse / irreversible / unknown。
  - `identity`: agent / user_named / service_account / external_facing / unknown。

### 测试验收

- 文档审阅通过,且没有把未确认的工程假设写成事实。
- 后续 Phase B/C/D/E 的测试矩阵能从本文档直接派生。
- 不要求运行代码测试;这是 planning-only 阶段。

### 不得遗留到下一阶段

- 不得继续用"工具名正则"作为长期授权模型。
- 不得保留"unknown 默认 allow"作为可接受目标。

---

## 2. Phase B · 结构化规则文件与纯函数授权引擎

### 何时开始

- Phase A 的输入输出契约确认。
- 确认权威规则文件采用结构化格式,建议新增 `.second/profile/AUTHORIZATION.yml`;现有 `AUTHORIZATION.md` 只作为人类可读摘要和 prompt 投影。

### 实现范围

- 新增 `server/authorization/`:
  - `policy-loader.js`:加载默认规则与用户规则,校验版本、字段、默认策略。
  - `engine.js`:实现 deny > active grant > gate > green allow > unknown gate 的判定顺序。
  - `types.js` 或常量模块:集中定义 action、scope、granularity、risk。
- `server/policy.js` 保持兼容导出,内部委托给新授权引擎。
- 默认规则必须覆盖:
  - workspace 内 read/write/exec 可自动放行。
  - push、deploy、package publish、prod/staging 写操作进入 gate。
  - secret 暴露、自我保护、不可恢复删除直接 deny。
  - unknown action 进入 gate。

### 测试验收

- 单元测试:
  - 默认规则能加载。
  - 非法 YAML / 缺字段 / 版本不支持时 fail closed。
  - deny 优先级高于 allow 和 grant。
  - unknown action 返回 gate。
  - workspace 内普通读写返回 allow。
- 回归测试:
  - 既有 `evaluateToolUse({ tool: "Bash", command: "rg TODO server" })` 仍 allow。
  - `psql prod update` 仍 gate。
  - `cat .env` 仍 deny。

### 不得遗留到下一阶段

- 授权判定不能依赖 prompt 文本。
- 规则加载失败不能静默回退到全 allow。

---

## 3. Phase C · 动作解析器与标签库

### 何时开始

- Phase B 的引擎可以接受结构化 intent。
- 已收集第一批需要支持的 tool payload 样例:Codex `Bash`, `apply_patch`, `Edit`, `Write`, MCP tool call。

### 实现范围

- 新增 `intent-parser.js`:
  - Bash 命令解析:git push、gh merge/release、npm publish、psql/mysql/redis/kubectl/terraform、curl 外发、rm/dd/chmod 等。
  - 文件写解析:目标路径是否在 task workspace 内、是否触碰 `.second/profile`, trace, decision log, `.env`, secret 文件。
  - 通信解析:Slack/email/Teams 等对外发送行为先进入 gate,模板化 daemon 通知单独标记为可放行。
- 新增 `labels.js`:
  - workspace root、source workspace、run workspace。
  - shared branch 规则。
  - prod/staging/dev 关键词与用户配置标签。
  - external recipient/domain 标签。
- 解析不确定时输出 `action: unknown`,不得输出 allow。

### 测试验收

- 对抗测试:
  - 命令拼接:`sh -c`, `bash -lc`, `npm run deploy`, `make deploy`。
  - 路径绕过:`../`, symlink 目标、带空格路径、大小写变体。
  - secret 名称变体:`.env.local`, `id_rsa`, `private_key`, `token`。
  - 外发命令:`curl -X POST`, `gh issue comment`, `slack send`。
- 标签测试:
  - workspace 内写 allow。
  - workspace 外写 gate。
  - `.second/profile/AUTHORIZATION.yml` 修改 deny。
  - prod/staging 未打标时按最高敏感度处理。

### 不得遗留到下一阶段

- 不得用"没匹配到危险正则"推导安全。
- 不得把未打标目标当作 dev/local。

---

## 4. Phase D · 授权测试 API 与前端 Authorization Lab

### 何时开始

- Phase B/C 的纯函数授权引擎与动作解析器已有单元测试。
- 现有 Auth view 能承载"授权与规则"入口,不需要先重做整套设置页。
- 团队需要一个不启动真实 Codex、不创建真实 decision 的方式来验证规则、标签和 parser。

### 实现范围

- 新增或预留 `POST /api/authorize` 的 dry-run 模式:
  - 请求体包含 `dryRun: true` 或 `mode: "dry_run"`。
  - 返回与正式授权相同的判定结构:`action`, `reason`, `ruleId`, `intent`, `fingerprint`, `matchedRule`, `grantPreview`。
  - dry-run 不创建 decision,不写 grant,不改变 task status。
- 在 `public/auth-view.js` 增加 Authorization Lab:
  - 输入 Bash 命令、文件路径、MCP tool payload 或 raw JSON。
  - 选择 task/workspace/env 标签,默认使用当前 daemon state 中的 workspace 样例。
  - 调用同源 `/api/authorize`,不写死 localhost 后端地址。
  - 展示判定结果、intent 五元组、命中规则、fingerprint、原因、是否会创建 decision、是否会消耗 grant。
  - 提供 allow/gate/deny 样例按钮,便于快速回归。
- 增加只读授权管理骨架:
  - 当前规则摘要。
  - 标签库摘要。
  - 最近 authorization decisions。
  - active / consumed / expired grants。
  - 规则候选入口仍保持"需用户确认后才生效"。

### 测试验收

- HTTP dry-run 测试:
  - 与正式引擎返回同样的 action/intent/fingerprint。
  - 不创建 decision。
  - 不写 grant。
  - 不改变 task status。
- 前端测试:
  - Auth view 渲染 Authorization Lab。
  - 提交测试 payload 调用 `/api/authorize` 且 body 带 dry-run 标记。
  - UI 展示 allow/gate/deny、intent、ruleId、fingerprint。
  - 前端代码不包含独立策略判断分支,只渲染后端结果。
- 手工验收:
  - 在浏览器中输入 `rg TODO server`,显示 allow。
  - 输入 `psql prod -c 'update orders set status=1'`,显示 gate 和 prod/write intent。
  - 输入 `cat .env`,显示 deny。

### 不得遗留到下一阶段

- 不得让 Authorization Lab 创建真实 decision 或 grant。
- 不得在前端复制规则正则或硬编码 allow/gate/deny 判断。
- 不得把前端测试结果写成长期授权规则;规则修改必须走后续管理 API 和审计。

---

## 5. Phase E · 正式 `/api/authorize` 与 hook fail-closed

### 何时开始

- Phase B/C 的授权引擎是纯函数,已有覆盖主要 intent 的单元测试。
- Phase D 的 dry-run API 和 Authorization Lab 能稳定解释判定结果。
- Decision domain 已能创建 pending decision 并让 task 进入 `needs_human`。

### 实现范围

- 扩展 daemon 路由:`POST /api/authorize` 的正式执法模式。
- Codex hook 改为调用 daemon:
  - 输入 Codex hook payload + `SECOND_TASK_ID`。
  - daemon 返回 allow/gate/deny。
  - hook 只做传输、输出和 exit code 映射。
- daemon 不可达时 hook fail closed:
  - 对明显绿区动作也可以选择 gate/deny,但绝不能 allow。
  - 记录 hook transport failure。
- gate 去重:
  - 同 task、同 fingerprint 已有 pending decision 时复用 decisionId,避免同一动作循环刷卡。
- decision 记录必须保存:
  - `authorization.intent`
  - `authorization.fingerprint`
  - `authorization.ruleId`
  - `authorization.granularityAllowed`

### 测试验收

- HTTP 路由测试:
  - allow 返回 200 + action allow。
  - gate 创建 decision,task 变 `needs_human`。
  - deny 不创建可批准 decision,但写审计事件。
  - 重复 gate 复用 pending decision。
- Hook 子进程测试:
  - allow 时 exit 0。
  - gate/deny 时 exit 非 0。
  - daemon 不可达时 exit 非 0。
- 手工验收:
  - 启动 daemon,提交一个会触发 `git push` 或模拟高风险命令的任务。
  - 控制台 inbox 能看到带 intent/fingerprint 的决策卡片。
  - Authorization Lab 中同一 payload 的 dry-run 结果与真实 hook gate 原因一致。

### 不得遗留到下一阶段

- hook 不得直接写 state 绕过 daemon。
- pending decision 不得丢失 taskId 或 fingerprint。

---

## 6. Phase F · 单次授权凭证账本

### 何时开始

- Phase E 可以稳定创建带 fingerprint 的 authorization decision。
- resolve decision 后可以触发 Codex resume。

### 实现范围

- 新增 `grants.js`:
  - `once`:批准后只允许同 task、同 fingerprint 的下一次动作。
  - `session`:预留字段,本阶段只建 schema 不开放 UI。
  - `plan`:预留字段,本阶段只建 schema 不开放 UI。
- `resolveDecision(approved)` 写入 grant ledger。
- `/api/authorize` 在规则判定前检查有效 grant:
  - 匹配则 allow。
  - once grant 被消费后立即标记 consumed。
  - 拒绝决策不写 grant。
- resume prompt 只告诉 agent 决策结果;是否放行仍由下一次 hook 调用匹配 grant 决定。

### 测试验收

- 单元测试:
  - approve 后同 fingerprint 下一次 allow。
  - once grant 消耗后,第三次同动作重新 gate。
  - 同 action 不同 target 不匹配。
  - rejected 不产生 grant。
  - expired/consumed grant 不匹配。
- 端到端验收:
  - 高风险动作第一次被 hook gate。
  - 用户批准。
  - Codex resume 后重试同一动作,hook allow。
  - grant audit 显示 consumed。

### 不得遗留到下一阶段

- 不得把"decision.status === approved"当作永久放行依据。
- 不得用自然语言 summary 匹配授权范围;必须用 fingerprint/intent。

---

## 7. Phase G · 授权审计、trace 与熔断

### 何时开始

- Phase F 的 allow/gate/deny/grant 消耗闭环已稳定。
- UI 已能展示 task trace 和 decision detail。

### 实现范围

- 新增授权审计 JSONL,建议 `.second/profile/AUTHORIZATION_AUDIT.log`。
- 每次 authorize 写入:
  - event: allow/gate/deny/grant.consume/grant.expire/quota.trip。
  - taskId, decisionId, ruleId, intent, fingerprint, reason。
- task trace 中写摘要事件,避免 trace 过长但保持可追溯。
- 加入配额熔断:
  - 单任务命令次数。
  - 文件访问/写入次数。
  - gate/deny 突增。
  - 外发请求次数。
- 红区请求来自任务内容时标记 `suspected_prompt_injection` 并挂起。

### 测试验收

- 审计测试:
  - green allow 也有审计记录。
  - deny 记录命中规则。
  - grant consume 记录原 decisionId。
  - audit 文本不包含 secret 明文。
- 熔断测试:
  - 超过命令次数阈值进入 gate 或 pause。
  - deny 突增创建告警事件。
- UI 验收:
  - 一个历史任务可还原:动作 -> 判定 -> 决策 -> 授权 -> resume -> 完成。

### 不得遗留到下一阶段

- 绿区动作不能隐形。
- 熔断不能默认批准继续执行。

---

## 8. Phase H · 环境加固与凭据不落地

### 何时开始

- 主执法路径已经闭环,否则环境层问题会和 hook 问题混在一起难以定位。
- 已列出 runtime 必需环境变量清单。

### 实现范围

- Codex child process env 改为 allowlist,不再透传整个 `process.env`。
- secret-bearing 设置改为系统 Keychain / 本地 secret store 引用,前端只显示 masked 状态。
- agent 需要使用外部服务凭据时,走 daemon proxy 或 channel adapter,不给明文 token。
- `.second/profile`、trace、decision log、authorization log 在任务 workspace 内不可写。
- 网络策略:
  - 默认 sandbox network off。
  - 开启网络时仍通过授权引擎判断未知域名/外发请求。

### 测试验收

- env 测试:
  - spawned Codex env 不包含 `OPENAI_API_KEY`, Slack token, GitHub token 等未授权变量。
  - 必需变量 `SECOND_ROOT`, `SECOND_TASK_ID`, `SECOND_DAEMON`, `NO_COLOR` 仍存在。
- secret 测试:
  - 设置页保存 secret 后 state/frontend 不出现明文。
  - agent 输出、audit、trace 不包含 token-shaped 文本。
- 文件权限/路径测试:
  - 任务尝试修改 `.second/profile/AUTHORIZATION.yml` 被 deny。
  - 任务尝试读取 `.env` 被 deny。

### 不得遗留到下一阶段

- 不得继续把宿主进程完整环境变量传给 agent。
- 不得让 agent 持有可复制到外部的长期 secret 明文。

---

## 9. Phase I · 计划级与临时授权

### 何时开始

- once grant 已稳定运行一段 dogfood,且同类重复批准是实际痛点。
- decision evidence schema 已能表达动作计划和风险边界。

### 实现范围

- 支持 `session` grant:
  - 仅本 task 内有效。
  - 有明确 action/target/env 边界。
  - task done/failed/archived 后过期。
- 支持 `plan` grant:
  - 任务开始或执行中提交计划。
  - 计划项转为多个 scoped grant。
  - 计划外动作继续 gate。
- 规则可声明禁用粗粒度:
  - prod deploy 只允许 once。
  - self-protection/secret/irreversible delete 永远 deny。
- UI decision options 增加:
  - 批准本次。
  - 本任务内同类不再问。
  - 批准此计划。
  - 拒绝并要求替代方案。

### 测试验收

- session grant:
  - 同 task 多次同类动作 allow。
  - 另一个 task 不继承。
  - task 完成后 grant 过期。
- plan grant:
  - 计划内多个动作不重复打扰。
  - 计划外动作 gate。
  - 高风险规则禁止 plan 时,即使 UI 请求也降级为 once 或拒绝。
- 用户验收:
  - 一个包含 3 个 staging 变更的任务,批准计划后只出现 1 次决策。
  - 一个 prod 变更仍强制单次审批。

### 不得遗留到下一阶段

- 计划授权不能是"批准整段自然语言"。
- 临时授权不能跨 task 泄漏。

---

## 10. Phase J · 规则候选与长期授权

### 何时开始

- 至少有一段 dogfood 数据,能看到重复批准模式。
- audit 中已稳定记录 intent、fingerprint、decision outcome、grant 类型。

### 实现范围

- 从审计和 decision log 提取候选:
  - 同类动作连续 N 次批准。
  - 无 reject、无 rollback、无后悔标记。
  - 风险等级低或中,且不触碰强制 gate/deny 类别。
- 候选进入 Auth view,但默认不生效。
- 用户确认后写入 `AUTHORIZATION.yml` 的 green/gate override,并记录 lineage:
  - 候选 id。
  - 支撑的历史 decision ids。
  - 操作人和时间。
- 忽略候选后进入冷却期。

### 测试验收

- 候选提取测试:
  - 全批准样本生成候选。
  - 有一次 reject 不生成候选。
  - prod/secret/self-protection 不生成 green 候选。
- 确认测试:
  - 用户确认后规则生效。
  - 规则修改写 audit。
  - prompt 投影摘要更新。
- 回归验收:
  - 候选确认前动作仍 gate。
  - 确认后同类低风险动作 green allow。

### 不得遗留到下一阶段

- 学到的 preference 不能自动变 authorization rule。
- rule candidate 不能绕过用户确认。

---

## 11. Phase K · 多 runtime 与 MCP 代理

### 何时开始

- Codex CLI 路径已稳定。
- 授权引擎与 hook 传输协议不再依赖 Codex 专属 payload。

### 实现范围

- 给 runtime adapter 增加 capability:
  - `hooks`:动作级拦截。
  - `sdk_callback`:宿主回调拦截。
  - `mcp_proxy_only`:敏感工具通过 Second MCP 代理。
  - `none`:受限支持。
- 对无动作级拦截的 runtime:
  - 黄区能力整体降级为红区。
  - 敏感工具不直接暴露,只暴露 Second 代理工具。
- MCP proxy 工具统一走 `/api/authorize`。

### 测试验收

- adapter 测试:
  - hooks runtime 完整支持 allow/gate/deny。
  - mcp-only runtime 只能通过代理触发敏感动作。
  - no-hook runtime 对黄区动作直接 deny。
- 端到端验收:
  - 同一 authorization rule 可服务 Codex hook 与 MCP proxy。
  - 审计日志能区分 runtime/source,但判定语义一致。

### 不得遗留到下一阶段

- 不得为了接入 runtime 而绕过授权引擎。
- 不得把"runtime 自己说安全"当作授权来源。

---

## 12. 发布门槛

授权体系进入默认启用前,必须通过以下发布门槛:

1. **安全门槛**
   - unknown 默认 gate。
   - deny 永远不能被 grant 覆盖。
   - daemon/hook 失败关闭。
   - agent 不持有长期 secret 明文。

2. **产品门槛**
   - 人能在控制台看到为什么被拦、批准什么、放行范围是什么。
   - 用户能在 Authorization Lab 中复现一个判定,并看到与真实 hook 相同的 intent、rule 和 fingerprint。
   - 批准后任务能继续,不会因为同一动作重复刷卡。
   - 拒绝后 agent 能走替代方案或明确停止。

3. **工程门槛**
   - `npm run check` 和 `npm test` 通过。
   - 授权关键模块有对抗测试。
   - 规则/标签/审计文件格式有文档。
   - `docs/known-limitations.md` 同步更新仍未完成的执法边界。

---

## 13. 推荐首个实现切片

首个代码切片只做 Phase B 到 Phase F 的最小闭环:

```text
AUTHORIZATION.yml
  -> intent parser for Bash + file writes
  -> /api/authorize dry-run
  -> Authorization Lab visualizes intent/rule/fingerprint
  -> /api/authorize enforcement
  -> hook calls daemon
  -> gate creates decision with fingerprint
  -> approve writes once grant
  -> resume retry consumes grant and allow
```

这个切片完成后,授权体系才真正从"能提醒 agent"变成"能被用户看懂且能强制执法"。Phase G 之后的加固和学习都应建立在这个闭环之上。
