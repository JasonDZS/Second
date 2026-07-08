# Second Slack Setup

Phase 1 now includes Slack as the first channel adapter. It supports Slack Events API task intake, Block Kit decision buttons, and result replies.

Second supports two Slack transports:

- HTTP callbacks: Slack calls `/slack/events` and `/slack/interactive` through a public HTTPS tunnel.
- Socket Mode: Second calls Slack over WebSocket, so no public tunnel is required.

## Environment

```bash
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_SIGNING_SECRET="..."
export SECOND_PUBLIC_URL="https://your-tunnel.example.com"
export SECOND_SLACK_DECISION_CHANNEL="C0123456789"
export SECOND_SLACK_ALLOWED_USERS="U0123456789,U9876543210"
export SECOND_SLACK_ALLOWED_CHANNELS="C0123456789"
```

`SECOND_PUBLIC_URL` may include or omit the trailing slash; Second normalizes it when generating the manifest.

`SECOND_SLACK_DECISION_CHANNEL` is optional when a decision is attached to a Slack-origin task; otherwise it is the fallback channel for decision requests.

For Socket Mode, use an app-level token instead of `SECOND_PUBLIC_URL`:

```bash
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_APP_TOKEN="xapp-..."
export SECOND_SLACK_SOCKET_MODE=1
export SECOND_SLACK_DECISION_CHANNEL="C0123456789"
export SECOND_SLACK_ALLOWED_USERS="U0123456789,U9876543210"
export SECOND_SLACK_ALLOWED_CHANNELS="C0123456789"
```

The app-level token must include the `connections:write` scope.

The generated bot manifest includes metadata scopes such as `channels:read`,
`groups:read`, `im:read`, and `mpim:read` so Second can resolve Slack channel
IDs into readable source labels in task traces. After adding these scopes to an
existing Slack app, reinstall the app to the workspace.

The allowlist variables are optional for local tests. When set, Second ignores Slack task intake from users or channels outside the list.

## Slack App Manifest · HTTP Callback Mode

Generate a manifest:

```bash
node bin/second.js slack manifest
```

Set the generated request URLs to:

- Events: `https://your-tunnel.example.com/slack/events`
- Interactivity: `https://your-tunnel.example.com/slack/interactive`

The HTTP implementation uses Slack Events API plus interactivity callbacks through the generic channel adapter layer.

## Slack App Manifest · Socket Mode

Generate a Socket Mode manifest:

```bash
node bin/second.js slack manifest --socket-mode
```

Import that manifest in Slack, install the app to the workspace, then create an app-level token from **Basic Information -> App-Level Tokens** with `connections:write`. Start Second with `SLACK_APP_TOKEN` and `SECOND_SLACK_SOCKET_MODE=1`.

When Socket Mode is enabled, Slack does not need Request URLs; events and interactivity arrive over the WebSocket connection opened by Second.

## Supported Flow

1. A user mentions the Second app in Slack, sends a DM to the app, or replies inside a thread that Second already handled.
2. HTTP mode: `/slack/events` creates a Second task. Socket Mode: the WebSocket envelope creates the same Second task.
3. If Codex calls `decision_request`, Second creates a Human Gate decision in the Second inbox. Approval, rejection, and option selection are managed inside Second.
4. If the task is ambiguous or needs missing information, Second may ask for clarification in the original Slack thread and then resume the same Codex session.
5. Second posts task completion or failure back to the original Slack thread.

## Adapter Boundary

Slack-specific parsing and Socket Mode transport live in `server/channels/slack.js`. Message formatting, manifest generation, Web API calls, text helpers, and target selection live under `server/channels/slack/`. The daemon consumes normalized channel envelopes:

- `task.requested`: create a Second task and dispatch Codex CLI.
- `decision.resolved`: legacy/native channel approval callback shape. Slack currently keeps Human Gate approval inside Second.

Linear, ClickUp, Feishu, and DingTalk should implement the same adapter contract. See `docs/channel-adapters.md`.

## Hermes-Inspired Shape

Second follows the same core Slack architecture as Hermes-agent:

- receive Slack events and interactivity through Socket Mode when available;
- send replies, task results, and approval buttons with Slack Web API;
- use bot token (`xoxb-...`) for Web API and app token (`xapp-...`) for Socket Mode;
- filter bot messages and optionally enforce user/channel allowlists.

The generated manifest subscribes to `app_mention`, DM messages, channel messages, private-channel messages, and MPIM messages. Second still does not process every channel message: non-DM channel messages are accepted only when they are app mentions or replies in a thread that Second has already activated. After changing these bot events or scopes in the manifest, reinstall the Slack app to the workspace.

Second intentionally does not copy Hermes' broader surface yet: slash commands, file ingestion, multi-workspace routing, rich Block Kit rendering, and per-channel prompt binding remain future adapter capabilities.
