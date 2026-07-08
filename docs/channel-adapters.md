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

Any future Linear, ClickUp, Feishu, or DingTalk adapter should map its native webhook/card events into these envelopes and reuse the same Second task/decision pipeline.

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
