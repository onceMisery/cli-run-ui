# cli-run-ui

Local agent workspace for Claude Code and Codex.

[简体中文说明](./README.zh-CN.md)

## What It Is

`cli-run-ui` turns local Claude Code and Codex activity into one browser workspace. It combines transcript browsing, headless task execution, interactive terminals, browser-side chat, multi-agent relay rooms, and a GitHub-oriented task loop in a single UI.

The project is designed for local-first workflows:

- run against your existing repositories
- keep the server bound to `127.0.0.1`
- reuse your installed `codex` / `claude` CLIs
- preserve recent runtime history across restarts

## Current Capabilities

### Workspace UI

- Unified session dashboard for Claude Code and Codex transcripts
- Real-time updates over SSE
- English / Chinese UI toggle
- Multiple theme colors
- One-click copy for message content and tool input/output

### Run Surfaces

- `Headless run` for fire-and-forget coding or review tasks
- `Interactive terminal` backed by a real PTY
- Browser chat box that can send directly into an existing terminal session or auto-open one

### Multi-Agent Collaboration

- Agent relay rooms with Claude/Codex participants
- Built-in room templates
- Custom relay templates saved in the browser
- Human interventions during relay execution
- Pinned rules that persist across turns
- Relay transcript export

### GitHub Task Loop

- Create a repo task on a dedicated branch
- Optionally import a GitHub issue into the task draft
- Hand the task to Claude or Codex for background execution
- Inspect diff summary, changed files, test output, and agent logs
- Create a PR from the UI
- Review, request changes, merge, and post-merge cleanup from the UI
- Surface PR reviews, PR comments, check runs, branch protection, and merge readiness

## Quick Start

### Requirements

- Node.js 20+
- `pnpm` via Corepack
- `git`
- `codex` and/or `claude` available on `PATH`, or configured via environment variables

### One Command Local Startup

```bash
corepack pnpm local
```

This will install dependencies and start the monorepo dev environment.

If dependencies are already installed:

```bash
corepack pnpm dev
```

Default local URLs:

- Web: `http://127.0.0.1:5173`
- Server: `http://127.0.0.1:4000`

## Remote Access

You can point the UI to a remote cli-run-ui server for mobile or another desktop.

1. Start the server on the host machine with an external bind and optional token:

```bash
CLI_RUN_UI_HOST=0.0.0.0
CLI_RUN_UI_ALLOWED_ORIGINS=https://your-ui-host
CLI_RUN_UI_TOKEN=your_shared_token
PORT=4000
```

2. In the browser UI, open the Remote access panel and set:

- API base URL: `https://your-host:4000`
- Token: the same value as `CLI_RUN_UI_TOKEN`

Leave the base URL empty to use the local proxy during development. To preconfigure a default base URL for builds, set `VITE_API_BASE`.

## Typical Workflow

### 1. Browse Existing Sessions

Open the workspace and inspect existing Claude / Codex transcripts, token usage, and project activity.

### 2. Launch a Run

Use either:

- `Headless run` for a single implementation / review pass
- `Interactive terminal` when you want a true CLI session

### 3. Chat from the Browser

Use the browser chat composer to send instructions directly to the active agent terminal.

### 4. Run a Task Loop

From the task panel you can:

1. Create a task branch
2. Optionally import a GitHub issue URL
3. Assign the task to Claude or Codex
4. Watch logs, diff, tests, checks, and PR activity
5. Open a PR
6. Approve / request changes / merge

## GitHub Integration

GitHub actions are implemented through the GitHub REST API.

To enable one-click PR / review / merge actions, configure either:

```bash
CLI_RUN_UI_GITHUB_TOKEN=your_token_here
```

or:

```bash
GITHUB_TOKEN=your_token_here
```

Notes:

- The repo `origin` must point to GitHub.
- Task start is blocked if the working tree is already dirty, to avoid mixing agent changes with local changes.
- Merge readiness is computed from PR state, reviews, checks, and branch protection data.
- Remote branch deletion after merge is optional and disabled by default.

## Configuration

### CLI Commands

Use these when `codex` or `claude` are not available on your default `PATH`:

```bash
CLI_RUN_UI_CODEX_COMMAND=codex
CLI_RUN_UI_CLAUDE_COMMAND=claude
```

These values can also be full executable paths.

### Runtime Storage

```bash
CLI_RUN_UI_DATA_DIR=.cli-run-ui
CLI_RUN_UI_HISTORY_FILE=.cli-run-ui/runtime-history.json
```

- `CLI_RUN_UI_DATA_DIR` sets the runtime data directory
- `CLI_RUN_UI_HISTORY_FILE` overrides the exact history file path

### Server / Security

```bash
PORT=4000
CLI_RUN_UI_TOKEN=optional_shared_token
```

- `PORT` changes the server port
- `CLI_RUN_UI_TOKEN` enables a simple bearer-token gate for API access

### GitHub Advanced Options

```bash
CLI_RUN_UI_GITHUB_API_BASE_URL=https://api.github.com
CLI_RUN_UI_DELETE_REMOTE_BRANCH_ON_MERGE=1
```

- `CLI_RUN_UI_GITHUB_API_BASE_URL` is useful for GitHub Enterprise
- `CLI_RUN_UI_DELETE_REMOTE_BRANCH_ON_MERGE=1` attempts remote branch deletion after merge

## Persistence

Recent runtime history is persisted across server restarts.

This includes:

- runs
- terminal sessions
- task metadata
- relay metadata
- recent output excerpts

It does not reattach to old processes. If the server restarts while a run or terminal is still active, the restored entry is marked stopped/closed for safety.

## Security Notes

- The server binds to `127.0.0.1` by default.
- Logs, transcripts, prompts, and diffs may contain sensitive project data.
- Do not expose the dev server to untrusted networks without adding your own access controls.

## Monorepo Layout

- `apps/web`: Vite + React frontend
- `apps/server`: local orchestration server
- `packages/core`: shared DTOs, parsers, provider logic

## Next Focus

The current recommended next stage is:

1. automation and connectors
2. team capabilities such as sharing, permissions, audit trails, and cost visibility
