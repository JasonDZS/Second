# Repository Guidelines

## Project Structure & Module Organization

Second is a local decision console and daemon for routing agent work through human review. Core server code lives in `server/`: `server/http/` contains API routing, `server/domain/` owns business logic, `server/runtime/` and `server/runtimes/` handle execution adapters, `server/codex/` contains Codex-specific parsing and prompts, and `server/channels/` contains message-channel integrations such as Slack. Browser UI modules live in `public/`, with shared Trace rendering split across `task-trace-*` and `timeline-core.js`. Tests are in `test/phase1/*.test.js`, with shared fixtures in `test/helpers/`. Docs are in `docs/`, assets in `public/logos/` and `design/`, and local runtime data in `.second/` is ignored.

## Build, Test, and Development Commands

- `npm install`: install Node dependencies.
- `npm start` or `npm run dev`: start the local daemon at `http://127.0.0.1:7317/`.
- `npm run check`: run `node --check` across project JavaScript and CommonJS files.
- `npm test`: run the Node test suite.
- `npm run desktop`: launch the Electron shell.
- `npm run mcp`: serve the local Decision MCP bridge.

## Coding Style & Naming Conventions

Use CommonJS modules with `"use strict";`. Keep indentation at two spaces and prefer small, focused modules over adding logic to already broad files. Use descriptive function names such as `createRuntimeResumeController` or `normalizeSlackEvent`. Browser modules should export factory/helper functions and avoid hidden global state unless they are explicitly UI-store concerns. Keep comments short and only where they clarify non-obvious behavior.

## Testing Guidelines

Tests use Node's built-in `node:test` and `node:assert/strict`. Add subsystem tests under `test/phase1/` using the `*.test.js` suffix. Keep shared setup in `test/helpers/phase1-context.js` instead of duplicating imports. Run both `npm run check` and `npm test` before submitting changes.

## Commit & Pull Request Guidelines

The current history uses concise Conventional-style commits, for example `chore: prepare repo for collaboration`. Prefer `<type>: <summary>` with types such as `feat`, `fix`, `chore`, `docs`, or `test`. Pull requests should include a short purpose statement, risk/rollback notes for daemon or runtime changes, linked issues when available, and screenshots for UI changes.

## Security & Configuration Tips

Never commit `.second/`, `.env`, tokens, or local logs. Use `.env.example` for documented configuration shape. Slack secrets are stored under `.second/secrets/` and must remain local. When adding a new channel or runtime, document required scopes, environment variables, and safe failure behavior.
