# Decision Evidence Schema v0

Decision records are stored in `.second/state.json` and appended to `.second/profile/DECISIONS.log`.

Required fields:

- `id`: stable decision id, for example `D-MRA16PGBYD6G`.
- `type`: `审批`, `授权`, `选择`, `补充`, or an adapter-specific subtype.
- `risk`: `低`, `中`, or `高`.
- `title`: human-readable decision title.
- `taskId`: related Second task id when available.
- `taskTitle`: related task title.
- `source`: origin, such as `Decision MCP`, `Codex PreToolUse hook`, or `Slack C...`.
- `agent`: personal agent display name.
- `engine`: execution engine, currently `Codex CLI`.
- `status`: `pending`, `approved`, or `rejected`.
- `selectedOption`: selected option id.
- `createdAt`: ISO timestamp.
- `summary`: concise evidence package.
- `impact`: list of affected files, services, tools, or external systems.
- `options`: list of decision options with `id`, `label`, `description`, and optional `recommended`.
- `artifacts`: list of related artifacts or links.

Optional fields:

- `decidedAt`: ISO timestamp when resolved.
- `replies`: follow-up notes appended through `decision_reply`.
- `slack`: Slack channel/thread metadata when the decision should be pushed to Slack.
