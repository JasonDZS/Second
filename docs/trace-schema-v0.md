# Trace Schema v0

Second currently stores trace data in three layers:

- `.second/state.json.tasks[].trace`: human-facing task timeline.
- `.second/state.json.tasks[].agentEvents`: normalized Codex JSONL events.
- `.second/state.json.events`: daemon-level append-style event feed, capped at the latest 500 events.

## Task Trace Event

```json
{
  "kind": "runtime",
  "actor": "李哲的分身",
  "time": "刚刚",
  "title": "分身开始执行",
  "description": "分身已接管任务。",
  "meta": "optional metadata",
  "decisionId": "D-...",
  "agentEventId": "T-...:initial:3"
}
```

Known `kind` values: `entry`, `agent`, `runtime`, `gate`, `decision`, `out`.

## Normalized Agent Event

```json
{
  "id": "T-...:initial:3",
  "seq": 3,
  "ts": "2026-07-07T02:29:42.584Z",
  "runtime": "codex",
  "source": "codex-jsonl",
  "phase": "initial",
  "rawType": "item_completed",
  "kind": "tool",
  "type": "stdout",
  "title": "MCP Tool",
  "text": "second-decision/decision_request",
  "detail": "...",
  "meta": "completed",
  "tone": "tool"
}
```

Known `kind` values: `system`, `assistant`, `reasoning`, `command`, `command-output`, `tool`, `web`, `patch`, `plan`, `success`, `warning`, `error`.

## Daemon Event

```json
{
  "id": "E-...",
  "at": "2026-07-07T02:29:42.584Z",
  "type": "decision.request",
  "text": "decision.request D-... · title",
  "taskId": "T-...",
  "decisionId": "D-..."
}
```

This is intentionally minimal for Phase 1. PROV/OpenTelemetry alignment remains out of scope.
