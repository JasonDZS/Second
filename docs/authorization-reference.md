# Authorization Reference

Second keeps authorization separate from preferences.

## Files

- `.second/profile/PREFERENCES.md`: user style and execution preferences. These are context, not permission.
- `.second/profile/AUTHORIZATION.md`: human-readable authorization summary used as prompt context only.
- `.second/profile/AUTHORIZATION.yml`: daemon-loaded policy file and the authority for allow/gate/deny rules.
- `.second/profile/DECISIONS.log`: append-only record of decision requests and outcomes.
- `.second/profile/AUTHORIZATION_AUDIT.log`: append-only authorization events, including allow/gate/deny, grant consume/expire, quota trips, and rule creation.

`AUTHORIZATION.yml` is declarative:

```yaml
version: 1
defaults:
  unknown_action: gate
deny:
  - id: deny.expose_credentials
    risk_tag: expose_credentials
gate:
  - id: gate.deploy
    action: deploy
    granularity: [once, plan]
green:
  - id: allow.read_workspace
    action: read
    scope: workspace
```

Rules are evaluated in this order: deny, active grant, gate, green allow, unknown default. Policy load failures fail closed as deny.

## Default Boundaries

Allowed:

- Read and write files inside the assigned Second run workspace.
- Run local tests, linters, formatters, and read-only repository inspection commands.
- Send Slack messages to configured task or decision channels when Slack credentials are present.

Human Gate required:

- Production database writes or migrations.
- Publishing packages, deploying services, or modifying remote infrastructure.
- Mutating remote git or GitHub state, including push, merge, release, and destructive branch operations.
- Reading or writing outside the assigned workspace.

Denied:

- Reading `.env`, private keys, SSH keys, token files, or files containing secrets unless explicitly provided for the task.
- Destructive filesystem operations such as wiping home directories or deleting unrelated repositories.
- Modifying Second authorization files, decision logs, audit logs, trace files, or hook/policy enforcement.

## Intent And API

`POST /api/authorize` accepts tool payloads from hooks, MCP, or Authorization Lab. Dry-run requests use `dryRun: true` or `mode: "dry_run"` and do not mutate state.

The daemon normalizes each tool call into an intent:

- `action`: `read`, `write`, `exec`, `communicate`, `push`, `deploy`, `install_package`, `system_change`, or `unknown`.
- `target`: path, repository, branch, domain, recipient, service, database, or tool.
- `environment`: `local`, `dev`, `staging`, `prod`, `external`, or `unknown`.
- `reversibility`: `reversible`, `hard_to_reverse`, `irreversible`, or `unknown`.
- `identity`: `agent`, `user_named`, `service_account`, `external_facing`, or `unknown`.

The response includes `action`, `reason`, `ruleId`, `intent`, `fingerprint`, `matchedRule`, `decisionId` when gated, and grant preview fields in dry-run mode.

## Grants

Approved authorization decisions create scoped grants:

- `once`: one retry of the same task and same fingerprint; consumed immediately.
- `session`: same task, same action/target/environment/identity; expires when the task is terminal.
- `plan`: same task and only structured plan items; plan text alone is not authorization scope.

Rejected decisions create no grant. Deny rules are evaluated before grants, so a grant cannot override a red-zone action.

## Runtime Enforcement

Each Codex run workspace receives `.codex/hooks.json`, `.codex/config.toml`, and the Second policy hook. The hook injects `SECOND_TASK_ID`, calls daemon `/api/authorize`, and fails closed when the daemon is unavailable or returns invalid data.

When a decision is approved or rejected, Second resumes the captured Codex session if a session id was recorded.

Runtimes declare authorization capability. Codex currently uses action-level hooks. No-hook runtimes are restricted: yellow-zone actions are treated as denied unless routed through a Second MCP proxy tool. The Decision MCP server exposes `authorization_check` for generic MCP authorization checks.

Profile authorization files are created with owner-only modes where the filesystem supports POSIX permissions: `.second/profile` is `0700`, and `AUTHORIZATION.yml`, `AUTHORIZATION.md`, `DECISIONS.log`, and `AUTHORIZATION_AUDIT.log` are `0600`. This is local hardening; a separate daemon OS user remains the stronger production boundary.

## Network Proxy

`POST /api/proxy/http` is the daemon-owned outbound HTTP path. It accepts `method`, `url`, optional `headers`, optional `body`, and optional `taskId`, then calls the same authorization engine before any outbound request is made. Gate/deny responses do not touch the network.

Codex run environments receive `SECOND_AUTH_PROXY=<daemon>/api/proxy/http`. Agent-supplied credential headers such as `Authorization`, `Cookie`, and `X-Api-Key` are stripped; long-lived service credentials should stay inside daemon channel adapters or future credential proxy code, not inside agent context.

The UI network toggle enables this authorized proxy path for new runs. It does not set Codex `sandbox_workspace_write.network_access=true`; raw Codex network access requires an explicit daemon launch environment override, `SECOND_CODEX_RAW_NETWORK_ACCESS=1`, and should be treated as a debugging escape hatch.
