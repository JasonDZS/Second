# Authorization Reference

Second keeps authorization separate from preferences.

## Files

- `.second/profile/PREFERENCES.md`: user style and execution preferences. These are context, not permission.
- `.second/profile/AUTHORIZATION.md`: static allow, Human Gate, and deny rules.
- `.second/profile/DECISIONS.log`: append-only record of decision requests and outcomes.

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

## Runtime Enforcement

Each Codex run workspace receives `.codex/hooks.json`, `.codex/config.toml`, and the Second policy hook. The hook injects `SECOND_TASK_ID`, evaluates the attempted tool call, and creates a Human Gate decision when the action matches high-risk policy.

When a decision is approved or rejected, Second resumes the captured Codex session if a session id was recorded.
