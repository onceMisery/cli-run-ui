# cli-run-ui

Local runboard for Claude Code and Codex sessions.

[简体中文说明](./README.zh-CN.md)

## Features
- Aggregates local Claude and Codex transcripts into one dashboard
- Streams session and conversation updates over SSE
- Launches headless runs for `codex exec` and `claude --print`
- Opens interactive PTY-backed terminals for Claude/Codex, including resume mode
- Shows recent runs, terminal sessions, token usage, and project-level activity
- Persists recent run and terminal history across server restarts
- Remembers the agent workspace draft locally in the browser

## Quick Start
```bash
corepack pnpm install
corepack pnpm dev
```

The web app runs on `http://127.0.0.1:5173` and the server on `http://127.0.0.1:4000`.

## CLI Overrides
If the executables are not available on your default `PATH`, set one or both of these:

```bash
CLI_RUN_UI_CODEX_COMMAND=codex
CLI_RUN_UI_CLAUDE_COMMAND=claude
CLI_RUN_UI_DATA_DIR=.cli-run-ui
```

These values can also point to full executable paths.
If you need a specific file instead of a directory, set `CLI_RUN_UI_HISTORY_FILE`.

## Current Model
- `Headless run` is best for fire-and-forget implementation, review, or summarize tasks.
- `Interactive terminal` uses a real PTY and is closer to a `claude-run` style workflow.
- When launching a terminal from the UI, the prompt box is optionally auto-sent after the CLI starts.

## Notes
- The server binds to `127.0.0.1` only.
- Logs and transcripts may contain sensitive data. Avoid exposing the port.
- By default, runtime history is stored at `.cli-run-ui/runtime-history.json` under the current working directory.
