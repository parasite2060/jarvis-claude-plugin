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

## Plugin Structure

```
.claude-plugin/
└── plugin.json              # Plugin manifest with userConfig schema

hooks/
├── hooks.json               # Hook definitions (SessionStart, Stop, PreCompact)
├── session-start.js         # Context injection + worker startup
├── session-end.js           # Transcript capture (Stop)
├── pre-compact.js           # Transcript capture (PreCompact)
└── lib/
    ├── jarvis-client.js     # HTTP client for Jarvis Server API
    ├── transcript.js         # JSONL parsing + sensitive data filtering
    └── worker-manager.js     # Local worker lifecycle management

mcp-server/
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
├── dream/
│   └── COMMAND.md           # /dream command definition
└── recall/
    └── COMMAND.md           # /recall command definition

skills/
└── memory-usage/
    └── SKILL.md             # Instructs Claude when/how to use memory tools
```

## Configuration

Plugin configuration is managed through Claude Code's `userConfig` system (stored in keychain for sensitive values):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `serverUrl` | string | `http://localhost:8000` | Jarvis Server URL |
| `apiKey` | string (sensitive) | — | API key for Jarvis Server (stored in keychain) |
| `cacheDir` | string | `~/.jarvis-cache/ai-memory` | Local vault file cache directory |
| `workerPort` | number | `37777` | Local file sync worker port |

## Installation

```bash
# Clone the plugin
git clone https://github.com/parasite2060/jarvis-claude-plugin.git

# Install MCP server dependencies
cd mcp-server && npm install && npm run build && cd ..

# Load in Claude Code
claude code --plugin-dir ./jarvis-claude-plugin
```

On first load, Claude Code will prompt for `serverUrl` and `apiKey` configuration.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Hooks | Node.js (cross-platform, no bash) |
| MCP Server | TypeScript + @modelcontextprotocol/sdk (stdio transport) |
| Worker | Node.js (detached background process) |
| Validation | Zod |
| Testing | Vitest |

## Security

- API key stored in system keychain via Claude Code's `userConfig` (never in files)
- Transcript filtering removes API keys (`sk-*`), AWS keys (`AKIA*`), bearer tokens, and JSON fields containing passwords/secrets before sending to server
- All hooks exit 0 on failure — never blocks Claude Code
- MCP server communicates via stdio (no network exposure)

## Related Repositories

| Repository | Description |
|-----------|-------------|
| [jarvis-server](https://github.com/parasite2060/jarvis-server) | Backend server (FastAPI, dreaming engine, git ops) |
| [memU-server](https://github.com/parasite2060/memU-server) | Semantic memory search engine |
| [memU-ui](https://github.com/parasite2060/memU-ui) | MemU web interface |
| [memU](https://github.com/parasite2060/memU) | Memory framework library (memu-py) |

## License

Private — all rights reserved.
