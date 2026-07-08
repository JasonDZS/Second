# Known Limitations

These are Phase 1 limitations, not Phase 2 feature requests.

- Codex hook blocking depends on the installed Codex CLI honoring workspace `.codex/` hooks and rules.
- A hook-created decision can only resume automatically after Codex has emitted a resumable session id.
- Docker Compose starts the daemon and console, but full Codex execution is best run on the host where the user is already logged in to Codex.
- Slack decision cards now render decision options as buttons, but heavy evidence review still belongs in the localhost console.
- Slack result replies include the final task text. Rich artifact upload and trace deep links are not yet implemented.
- Run isolation uses `.second/runs/<task-id>` directories. When the provided workspace is a git repository, Second attempts a detached git worktree under the run directory; non-git paths run directly in the provided path.
- Phase 1 metrics are computed from local trace/state only; they are not exported to a warehouse or analytics service.
- Rule candidates in the UI are seeded/manual product scaffolding. Automatic learned-pattern extraction is not part of this Phase 1 implementation.
