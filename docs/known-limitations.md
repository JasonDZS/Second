# Known Limitations

These are Phase 1 limitations, not Phase 2 feature requests.

- Codex hook blocking depends on the installed Codex CLI honoring workspace `.codex/` hooks and rules.
- Authorization now has a daemon-side `/api/authorize` path, intent parser, once/session/plan grants, audit log, fail-closed Codex hook, a generic MCP `authorization_check` proxy, and a daemon-owned `/api/proxy/http` outbound path, but OS-level multi-user file permissions and OS-enforced network egress routing are not yet implemented.
- Authorization Lab is a dry-run tester only; it does not create decisions, grants, or long-term rules.
- Session/plan grants require structured decision payloads; free-form natural-language plans are intentionally not treated as authorization scope.
- Runtime coverage is strongest for Codex hooks. MCP authorization proxy support exists, but concrete sensitive-tool wrappers for MCP-only runtimes are still limited.
- A hook-created decision can only resume automatically after Codex has emitted a resumable session id.
- Docker Compose starts the daemon and console, but full Codex execution is best run on the host where the user is already logged in to Codex.
- Slack decision cards now render decision options as buttons, but heavy evidence review still belongs in the localhost console.
- Slack result replies include the final task text. Rich artifact upload and trace deep links are not yet implemented.
- Run isolation uses `.second/runs/<task-id>` directories. When the provided workspace is a git repository, Second attempts a detached git worktree under the run directory; non-git paths run directly in the provided path.
- Phase 1 metrics are computed from local trace/state only; they are not exported to a warehouse or analytics service.
- Rule candidates can be extracted from repeated approved authorization decisions, but dogfood-grade rollback/regret signals and cooldown policy are still basic.
