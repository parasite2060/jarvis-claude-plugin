# Memory Usage Skill

Instructions for using Jarvis memory tools during Claude Code sessions.

## When to Use memory_add

Call `memory_add` proactively when the user:
- Makes a decision with reasoning ("use X because Y") — preserve both the decision AND the reasoning
- Expresses a preference or working style ("I prefer X", "always do Y")
- Corrects a previous assumption or pattern — use "CORRECTION: Was [old] → Now [new]"
- Establishes a project-level pattern or convention
- Shares an important fact about their system, team, or context

**Format guidance:**
- Keep content under 150 characters for MEMORY.md compatibility
- Use imperative voice: "Use X for Y" not "The project uses X"
- Include absolute dates when relevant: "2026-03-29" never "yesterday"
- Add `context` field to capture when/why the memory matters

## When to Use memory_search

Call `memory_search` proactively when:
- Starting work on a new feature (search for related past decisions)
- The user asks about something you've worked on before
- You're about to make a technical decision (check for established preferences)
- The user asks "do you remember..." or "what did we decide about..."
- Before recommending a library or approach (check for past choices)

## Vault Structure

The ai-memory vault lives at `JARVIS_CACHE_DIR` (default: `~/.jarvis-cache/ai-memory`).

Key files (always injected into session context via SessionStart hook):
- `SOUL.md` — principles and decision philosophy
- `IDENTITY.md` — role, tech stack, current projects
- `MEMORY.md` — index of key facts, decisions, patterns (hard cap: 200 lines)
- `dailys/` — today's and yesterday's session logs

The `memory_search` MCP tool performs semantic search across the full vault via the Jarvis server.
Use it for queries that go beyond what's in the injected MEMORY.md context.

## Memory Add Examples

Good:
```
content: "Use httpx.AsyncClient not requests for all HTTP calls in jarvis-server"
context: "Project standard — async-first Python codebase"
```

```
content: "CORRECTION: Was 'use ai-memory submodule' → Now 'ai-memory is standalone at ~/ai-memory/ (2026-03-29)'"
context: "Repo structure clarification"
```

Bad (do not do this):
- `content: "The user said they prefer tabs"` — not imperative voice
- `content: "Yesterday we decided to use Docker"` — not absolute date
- `content: "The project uses TypeScript strict mode and ES modules with NodeNext module resolution and the tsc compiler"` — too long
