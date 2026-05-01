# Jarvis Claude Plugin

A Claude Code plugin that gives Claude a persistent memory — it remembers who you are, how you think, and what you've decided across every session.

The plugin connects Claude Code to a self-hosted Jarvis Server, providing automatic context injection, passive conversation capture, real-time semantic memory search, and manual dream triggers.

## How It Works

```
Claude Code Session
    │
    ├── SessionStart hook ──► GET /memory/context ──► Injects SOUL + IDENTITY + MEMORY
    │
    ├── MCP Tools (during session)
    │   ├── memory_search ──► POST /memory/search ──► Semantic results from MemU
    │   └── memory_add ──► POST /memory/add ──► Store new memory
    │
    ├── PreCompact hook ──► POST /conversations ──► Backup transcript before compaction
    │
    └── Stop hook ──► POST /conversations ──► Capture full transcript for dreaming
```

## Requirements

- **Node.js ≥ 18.0.0** — the plugin, MCP server, and background worker all use Node's native `fetch` API (available since Node 18). Earlier versions will fail with `ReferenceError: fetch is not defined`. Enforced via `engines` + `.npmrc` `engine-strict=true`; `npm install` will exit non-zero on older versions.
- [Claude Code](https://claude.ai/claude-code) installed
- A running Jarvis server (default: `http://localhost:8000`). See [jarvis-server README](https://github.com/parasite2060/jarvis-server).

## Installation

### From Marketplace (recommended)

```bash
# Add the marketplace
/plugin marketplace add parasite2060/jarvis-claude-plugin

# Install the plugin
/plugin install jarvis-plugin@jarvis
```

### Manual

```bash
git clone https://github.com/parasite2060/jarvis-claude-plugin.git
claude code --plugin-dir ./jarvis-claude-plugin
```

After installation, go to `/plugin` > **Installed** > **jarvis-plugin** to configure `Server URL` and `API Key` before use.

## Features

### Hooks

| Hook | Event | Behavior |
|------|-------|----------|
| **SessionStart** | Session start, resume, clear, compact | Calls Jarvis Server for assembled context (SOUL.md, IDENTITY.md, MEMORY.md, daily logs, vault indexes). Injects into Claude's context. Ensures local file sync worker is running. |
| **Stop** | Session end (async) | Reads the JSONL transcript, filters sensitive data (API keys, tokens, passwords), POSTs to Jarvis Server for dreaming. |
| **PreCompact** | Before context compaction (sync) | Same as Stop — redundant capture ensures no transcript is lost. |

All hooks exit 0 on failure (graceful degradation — Claude works fine without Jarvis).

### MCP Tools

| Tool | Description |
|------|-------------|
| `memory_search` | Semantic search across all past memories. Calls Jarvis Server, which proxies to MemU (pgvector). Returns ranked results with source context. |
| `memory_add` | Store a new memory during a session. Claude proactively calls this when it observes decisions, preferences, corrections, or important facts. |

The MCP server is distributed as [`@parasite2060/jarvis-mcp-server`](https://github.com/parasite2060/jarvis-claude-plugin/packages) on GitHub Packages. Versioned via [release-please](https://github.com/googleapis/release-please) with automated publishing on release.

### Commands

| Command | Description |
|---------|-------------|
| `/dream` | Triggers a manual deep dream cycle — consolidates all recent sessions into organized MEMORY.md with strong patterns, resolved contradictions, and pruned stale entries. |
| `/recall <query>` | Interactive memory search — queries past memories and presents results grouped by relevance (high/medium/low). |

### Local File Sync Worker

A background Node.js process that keeps vault files synced locally:
- Polls the Jarvis Server file manifest every 5 minutes
- Downloads only changed files to `JARVIS_CACHE_DIR`
- Enables Claude to `Read`/`Grep` memory files with zero latency
- Auto-started by the SessionStart hook
- Persists between sessions via PID file

#### Worker on-disk state

Files the worker keeps under `${workerDir}` (default `~/.jarvis-cache/worker`):

- `${workerDir}/.worker.pid` — PID of the running worker; rewritten on every spawn, removed on clean shutdown.
- `${workerDir}/logs/worker.log` — rotating worker log.
- `${workerDir}/pending-conversations/*.json` — drained transcripts queued for the server.
- `${workerDir}/pending-conversations/*.json.attempts` — sidecar files holding the per-file retry count (single integer, atomic write). Cleared on success or once the budget is exhausted; mtime acts as the last-attempt timestamp for exponential backoff (1, 2, 4, 8, 16, 30, 30, 30 minutes, capped at 30 min).
- `${workerDir}/pending-conversations/.failed/*.json` — files moved here after the retry budget (default 8 attempts) is exhausted, after a 401/403 auth failure, or after the payload could not be parsed. Operator inspects and deletes manually.
- `${workerDir}/.spawn.lock` — transient; held during worker spawn (kill+spawn critical section in the SessionStart hook); auto-cleaned by the lock holder; safe to delete if no worker is running.
- `${workerDir}/.migrate.lock` — transient; held during legacy-workspace migration on worker boot; auto-cleaned; safe to delete.

#### When draining stops

If queued conversations are not making it to the server, work down this list:

1. `curl http://127.0.0.1:<workerPort>/health` — if the response includes `"authBlocked": true` with `authBlockedReason: "401"` or `"403"`, the worker has latched on an auth failure and is skipping every drain tick. Fix the API key (or server-side credentials), then clear the latch with `curl 'http://127.0.0.1:<workerPort>/health?clearAuthBlock=1'`. The next drain tick resumes normally; no worker restart required.
2. Check `${workerDir}/pending-conversations/.failed/` — files there were either auth-blocked or hit the retry budget (`reason=retry-budget-exhausted attempts=8 lastStatus=...`). Inspect, move them back into `pending-conversations/` if you want to re-attempt, or delete.
3. Check `${workerDir}/logs/worker.log` for `jarvis.drain.retryable:` (transient 5xx/network) and `jarvis.drain.failed-moved:` (terminal) lines.

## Configuration

Plugin configuration is managed through Claude Code's `userConfig` system (stored in keychain for sensitive values):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `serverUrl` | string | `http://localhost:8000` | Jarvis Server URL |
| `apiKey` | string (sensitive) | — | API key for Jarvis Server (stored in keychain) |
| `cacheDir` | string | `~/.jarvis-cache/ai-memory` | Local vault file cache directory |
| `workerPort` | number | `37777` | Local file sync worker port |

## Plugin Structure

```
.claude-plugin/
└── plugin.json              # Plugin manifest with userConfig schema

.mcp.json                    # MCP server registration (npx auto-install)

hooks/
├── hooks.json               # Hook definitions (SessionStart, Stop, PreCompact)
├── session-start.js         # Context injection + worker startup
├── session-end.js           # Transcript capture (Stop)
├── pre-compact.js           # Transcript capture (PreCompact)
└── lib/
    ├── jarvis-client.js     # HTTP client for Jarvis Server API
    ├── transcript.js         # JSONL parsing + sensitive data filtering
    └── worker-manager.js     # Local worker lifecycle management

mcp-server/                  # Published as @parasite2060/jarvis-mcp-server
├── src/
│   ├── index.ts             # MCP server entry (stdio transport)
│   ├── tools/
│   │   ├── memory-search.ts # memory_search tool handler
│   │   └── memory-add.ts    # memory_add tool handler
│   ├── lib/
│   │   └── jarvis-client.ts # Typed HTTP client for Jarvis Server
│   └── schemas.ts           # Zod schemas for tool inputs
├── package.json
└── tsconfig.json

worker/
└── server.js                # Background file sync worker

commands/
├── dream/COMMAND.md         # /dream command definition
└── recall/COMMAND.md        # /recall command definition

skills/
└── memory-usage/SKILL.md    # Instructs Claude when/how to use memory tools
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Hooks | Node.js (cross-platform, no bash) |
| MCP Server | TypeScript + @modelcontextprotocol/sdk (stdio transport) |
| Worker | Node.js (detached background process) |
| Validation | Zod |
| Testing | Vitest |
| CI/CD | GitHub Actions (CI on PR, release-please for versioning) |
| Package Registry | GitHub Packages (npm) |

## Releases

Managed by [release-please](https://github.com/googleapis/release-please):

- **Stable releases** — Push conventional commits to `main` → release-please creates a Release PR → merge → MCP package published with `latest` tag
- **Pre-releases** — Go to Actions → Release → Run workflow → Enter identifier (e.g., `alpha.1`) → MCP package published with `next` tag

Install a specific version:
```bash
npx --registry=https://npm.pkg.github.com @parasite2060/jarvis-mcp-server@0.2.0
npx --registry=https://npm.pkg.github.com @parasite2060/jarvis-mcp-server@next  # latest pre-release
```

## Security

- API key stored in system keychain via Claude Code's `userConfig` (never in files)
- Transcript filtering removes API keys (`sk-*`), AWS keys (`AKIA*`), bearer tokens, and JSON fields containing passwords/secrets before sending to server
- All hooks exit 0 on failure — never blocks Claude Code
- MCP server communicates via stdio (no network exposure)

### Network surface

The local file sync worker's HTTP server binds to `127.0.0.1` only by design — it is not reachable from any other host on the LAN. This is hard-coded (no opt-out config knob): a per-user worker exposing `/health`, `/sync`, and `/drain` to the LAN would be a side-channel into the operator's session state. A future feature requiring LAN access would need to introduce authentication AND an opt-in bind config; both must land together, never separately.

## Related Repositories

| Repository | Description |
|-----------|-------------|
| [jarvis-server](https://github.com/parasite2060/jarvis-server) | Backend server (FastAPI, dreaming engine, git ops) |
| [memU-server](https://github.com/parasite2060/memU-server) | Semantic memory search engine |
| [memU-ui](https://github.com/parasite2060/memU-ui) | MemU web interface |
| [memU](https://github.com/parasite2060/memU) | Memory framework library (memu-py) |

## License

Private — all rights reserved.
