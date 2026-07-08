# Second Local

Second is a local decision console and execution shell for personal agents. This implementation follows the supplied design files and provides:

- pixel-faithful localhost Web console with desktop and mobile breakpoints
- local daemon with persistent JSON state under `.second/state.json`
- real Codex CLI detection plus `codex exec --json` / `codex exec resume` task execution
- Decision MCP stdio server for agent runtimes
- interaction channel adapter layer, with Slack implemented first
- Electron desktop shell that reuses an existing daemon when one is already running

## Run

```bash
npm install
npm start
```

Open `http://127.0.0.1:7317/`.

Start the daemon from a normal local shell, not a restricted sandbox, because Codex CLI needs to persist resumable session state under `~/.codex`.

Desktop shell:

```bash
npm run desktop
```

CLI:

```bash
node bin/second.js doctor
node bin/second.js init
node bin/second.js task list
node bin/second.js decision list
node bin/second.js channel list
node bin/second.js task add "Write a README summary"
node bin/second.js task run <task-id>
node bin/second.js task show <task-id>
node bin/second.js task cancel <task-id>
node bin/second.js mcp serve
node bin/second.js slack manifest
node bin/second.js slack manifest --socket-mode
```

Codex MCP configuration should include the Second server and auto-approve only the decision request tool:

```toml
[mcp_servers.second-decision]
command = "/Volumes/Samsung_T5/project/Second/bin/second.js"
args = ["mcp", "serve"]

[mcp_servers.second-decision.env]
SECOND_DAEMON = "localhost:7317"

[mcp_servers.second-decision.tools.decision_request]
approval_mode = "approve"
```

Create a front-end approval test task:

```bash
curl -sS -X POST http://127.0.0.1:7317/api/test/decision-task \
  -H 'Content-Type: application/json' \
  -d '{"title":"测试: 前端审批后继续执行"}'
```

Approve or reject the new decision in the console. Second writes the continuation result to `.second/runs/<task-id>/decision-result.json`.

## Notes

- The default execution engine is the local `codex` binary found on `PATH`.
- New tasks run in isolated `.second/runs/<task-id>` workspaces. If a supplied workspace path is a git repository, Second creates a detached worktree under the run directory; non-git paths run directly in the supplied path.
- Each run workspace receives a generated `.codex/` config with Second's Decision MCP server and Human Gate hooks, so policy checks stay attached to the task id while Codex runs in isolation.
- When Codex requests a Second decision, the daemon records the `thread_id`, stops at `SECOND_WAITING_FOR_DECISION:<id>`, and resumes that same session after front-end approval.
- `node bin/second.js init` creates `.second/profile/PREFERENCES.md`, `.second/profile/AUTHORIZATION.md`, and `.second/profile/DECISIONS.log`.
- Project-local Codex hooks and rules live under `.codex/`; review and trust them with `/hooks` in Codex before relying on hook-based blocking.
- Slack HTTP endpoints are `/slack/events` and `/slack/interactive`; Slack Socket Mode is available with `SLACK_APP_TOKEN` and `SECOND_SLACK_SOCKET_MODE=1`. See `docs/slack-setup.md` and `docs/channel-adapters.md`.
- The Electron dependency is pinned to Electron 37 so it works with the current Node 20 runtime.

Phase 1 docs:

- `docs/30-minute-install-guide.md`
- `docs/authorization-reference.md`
- `docs/decision-evidence-schema-v0.md`
- `docs/trace-schema-v0.md`
- `docs/known-limitations.md`
