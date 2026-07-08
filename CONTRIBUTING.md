# Contributing

## Local Setup

```bash
npm install
npm test
npm start
```

Open `http://127.0.0.1:7317/`.

Local runtime state, secrets, and task workspaces live under `.second/` and must not be committed.

## Module Boundaries

- `public/timeline-core.js` owns Trace data assembly and channel/runtime registries that can run without the DOM.
- `public/actions.js` owns UI action dispatch and side-effect orchestration.
- `public/api-client.js` owns browser API calls and SSE construction.
- `public/auth-view.js` owns the authorization and memory page rendering.
- `public/inbox-view.js` owns the decision inbox list, selected decision detail, decision options, and human reply composer.
- `public/mobile-view.js` owns the mobile/Slack decision preview page rendering.
- `public/runtime-view.js` owns the runtime dashboard, local task launcher, running task rows, file activity, and event-log rendering.
- `public/settings-view.js` owns the settings page rendering for engines, channels, Slack config, MCP, and runtime toggles.
- `public/presentation.js` owns shared display labels, colors, escaping, and time/path formatting.
- `public/profile.js` owns profile form normalization and Nice Avatar URL/markup helpers.
- `public/render-signature.js` owns state signatures used to avoid unnecessary full rerenders.
- `public/shell-view.js` owns the sidebar, profile modal, and shared shell chrome rendering.
- `public/slack-settings.js` owns Slack settings form/status helpers.
- `public/task-trace-agent-view.js` owns agent runtime bundle cards, activity aggregation, and runtime-card rendering in the task trace.
- `public/task-trace-format.js` owns Trace text cleanup, secret redaction, and runtime-card formatting helpers.
- `public/task-trace-source-view.js` owns source-message and channel-origin cards in the task trace.
- `public/task-trace-view.js` owns the task list, task detail header, timeline rows, and delegates source/agent-specific rendering.
- `public/ui-store.js` owns initial UI state shape and small state helpers.
- `public/app.js` owns view composition, state updates, selection, and browser-only helpers.
- `server/domain/` owns domain logic such as decisions, profile validation, metrics, and public state shaping.
- `server/domain/decision-test-task.js` owns the local end-to-end decision harness used by tests and demos.
- `server/http/` owns HTTP API routing, JSON/body helpers, SSE, static serving, and request handlers.
- `server/runtime-manager.js` owns runtime engine probing, process tracking, stdout/stderr supervision, and state-change notification.
- `server/runtime/` owns daemon/runtime recovery, resume helpers, and generic task execution lifecycle.
- `server/runtimes/` owns runtime adapter registration, engine probe metadata, and runtime-specific event normalization.
- `server/codex/` owns Codex event parsing, prompt construction, process-close reconciliation, and runtime config file generation.
- `server/channels/` owns message-channel adapters, HTTP/channel controllers, envelope processing, and transport routing.
- `server/channels/slack/` owns Slack Block Kit, events/envelope normalization, manifest, Web API, text, and target helpers.
- `server/state.js` owns local state paths, persistence entry points, profile file bootstrap, and state normalization.
- `server/state/seed.js` owns demo seed data and static demo trace fixtures.
- `test/phase1/` groups Phase 1 tests by subsystem; keep new coverage near the module it exercises.

## Checks

Before opening a PR, run:

```bash
npm run check
npm test
```
