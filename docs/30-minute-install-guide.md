# Second 30-Minute Install Guide

This guide is the Phase 1 happy path: local daemon, localhost console, Codex CLI, and Slack Socket Mode.

## Prerequisites

- Node.js 20.
- A working local `codex` CLI login on the host machine.
- A Slack app with a bot token (`xoxb-...`).
- For Socket Mode, a Slack app-level token (`xapp-...`) with `connections:write`.

## Local Host Setup

```bash
npm install
node bin/second.js init
node bin/second.js doctor
npm start
```

Open `http://127.0.0.1:7317/`.

`second init` creates:

- `.second/profile/PREFERENCES.md`
- `.second/profile/AUTHORIZATION.md`
- `.second/profile/DECISIONS.log`

New tasks create isolated run directories under `.second/runs/<task-id>`. Each run directory receives its own `.codex/` config so Codex can find the Second MCP server and Human Gate hooks while running inside that isolated workspace.

## Slack Socket Mode

1. Start the console and open Settings.
2. Enable Socket Mode.
3. Paste `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, and `SLACK_SIGNING_SECRET`.
4. Optionally set allowed user and channel IDs.
5. Click save and reconnect.
6. Send a DM to the Slack app or mention it in an allowed channel.

Socket Mode does not require ngrok or cloudflared because Second opens the WebSocket connection to Slack.

## Docker Compose

```bash
SECOND_SLACK_SOCKET_MODE=1 \
SLACK_BOT_TOKEN=xoxb-... \
SLACK_APP_TOKEN=xapp-... \
SLACK_SIGNING_SECRET=... \
docker compose up --build
```

Docker Compose starts the daemon and console. The Phase 1 Codex runtime still expects the `codex` CLI and its session state to be usable from the execution environment. For real Codex task execution, the recommended path is still the local host setup above.

## Smoke Test

```bash
node bin/second.js task add "Write a short README summary"
node bin/second.js task run <task-id>
node bin/second.js task list
```

For Human Gate UI verification:

```bash
curl -sS -X POST http://127.0.0.1:7317/api/test/decision-task \
  -H 'Content-Type: application/json' \
  -d '{"title":"Test: approve and continue"}'
```

Approve the decision in the console. The task should complete and write `decision-result.json` in its run directory.
