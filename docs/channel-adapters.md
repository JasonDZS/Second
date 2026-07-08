# Second Channel Adapter Layer

Second separates collaboration channels from the local agent runtime. A channel adapter owns external I/O; the daemon owns task creation, Human Gate decisions, Codex execution, and trace persistence.

## Adapter Contract

An adapter is registered from `server/channels/index.js` and exposes:

- `id`, `name`, `httpPrefix`, `supports`: discovery metadata.
- `receiveHttp({ req, url, rawBody, profile })`: parses inbound HTTP callbacks and returns a normalized envelope.
- `startTransport(options)`: optionally starts a long-lived transport such as Slack Socket Mode.
- `sendTaskAccepted(task)`: acknowledges that Second accepted the task.
- `sendDecisionRequested(decision, task)`: pushes an approval/choice card to the human.
- `sendDecisionResolved(decision, task)`: reports the chosen decision back to the channel.
- `sendTaskResult(task, result)`: replies with the final task result.

The normalized inbound envelopes are:

```json
{
  "kind": "task.requested",
  "channelId": "slack",
  "taskInput": {
    "title": "Fix the failing checkout test",
    "prompt": "Slack user U123 asked Second...",
    "source": "Slack C123",
    "run": true,
    "channel": {
      "id": "slack",
      "name": "Slack",
      "external": {
        "channel": "C123",
        "threadTs": "1720000000.000100",
        "user": "U123"
      }
    }
  }
}
```

```json
{
  "kind": "decision.resolved",
  "channelId": "slack",
  "decisionId": "D-...",
  "verdict": "approved",
  "optionId": "a"
}
```

Any future Linear or ClickUp adapter should map its native webhook/card events into these envelopes and reuse the same Second task/decision pipeline.

## Current Slack Adapter

Slack is composed from `server/channels/slack.js` plus helpers under `server/channels/slack/`:

- `POST /slack/events`: Slack Events API task intake.
- `POST /slack/interactive`: legacy Block Kit callback normalization, kept for compatibility.
- Socket Mode: `SLACK_APP_TOKEN` + `SECOND_SLACK_SOCKET_MODE=1` opens Slack WebSocket envelopes without a public tunnel.
- `chat.postMessage`: task accepted and task result replies. Human Gate decisions stay in the Second inbox; Slack is used only for task intake, thread follow-ups, and clarification prompts.
- `server/channels/slack/blocks.js`: Block Kit payload helpers.
- `server/channels/slack/manifest.js`: Slack manifest generation.
- `server/channels/slack/web-api.js`: Slack Web API calls and profile identity fallback.

HTTP mode needs a public HTTPS URL or tunnel for callbacks. Socket Mode does not.

The Slack adapter intentionally follows the Hermes-agent integration shape for the MVP: Socket Mode receives events/interactions, Slack Web API sends messages, and optional user/channel allowlists bound who may trigger local execution.

## Additional Message Sources

Second also exposes implemented adapters for Discord, Telegram, WhatsApp, DingTalk, and Feishu. They follow the same gateway shape used by Hermes Agent: a platform-specific transport receives messages, normalizes them into a `task.requested` envelope, and the daemon owns execution plus final result delivery back to the source conversation.

These adapters can be configured from Settings -> 信息接收渠道 in the browser console. Secrets are written to `.second/secrets/<channel>.json` with local-only file permissions and are not echoed back to the frontend. Environment variables still override local settings, which keeps deployments scriptable and makes local UI configuration safe for developer machines.

Current endpoints:

- Discord Gateway: when `DISCORD_BOT_TOKEN` is configured, Second opens Discord Gateway, listens for DMs, bot mentions, and known task threads, and replies through the Discord Bot API. Set `DISCORD_APPLICATION_ID` or fill Application ID in the UI to generate a one-click Bot invite URL without using Discord's OAuth2 URL Generator. By default Second requests only non-privileged intents so the Gateway can connect immediately after saving a bot token. Enable `SECOND_DISCORD_MESSAGE_CONTENT_INTENT=1` or the UI switch only after the same privileged intent is enabled in Discord Developer Portal. `POST /discord/webhook` also accepts relay payloads or interaction pings.
- `POST /telegram/webhook`: Telegram Bot API updates; replies through `sendMessage` with `TELEGRAM_BOT_TOKEN`. Optional request verification uses `TELEGRAM_WEBHOOK_SECRET`.
- `GET|POST /whatsapp/webhook`: WhatsApp Cloud API webhook verification and message events; replies through the Graph API with `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`.
- `POST /dingtalk/webhook`: DingTalk outgoing robot payloads; replies through a custom robot `DINGTALK_WEBHOOK_URL`, optionally signed with `DINGTALK_SECRET`.
- `POST /feishu/webhook`: Feishu/Lark event subscription payloads including `url_verification`; replies through `FEISHU_WEBHOOK_URL`.

All five adapters support optional allowlists with `SECOND_<PLATFORM>_ALLOWED_USERS` and `SECOND_<PLATFORM>_ALLOWED_*` channel/chat variables documented in `.env.example`. Human Gate decision events remain in Second, matching Slack: message platforms are used for intake, follow-ups, and final-result delivery.
