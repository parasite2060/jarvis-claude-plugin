---
name: memory-usage
description: Use whenever you need anything about the user's identity, persona, preferences, decisions, or project history — including "do you know me", "what did I decide about X", "what's my stack", before recommending a library, before starting new feature work, and proactively after the user states a preference, decision, correction, or lesson learned. The user's second brain is at JARVIS_CACHE_DIR — read SOUL/IDENTITY/MEMORY first, then folder _index.md files, then specific decision/pattern/lesson files. Use the memory_add MCP tool to record durable facts and memory_search for semantic queries.
---

# Memory Usage Skill

Instructions for using Jarvis memory tools during Claude Code sessions. Follow these guidelines proactively throughout the entire session.

## When to Use memory_add

Call `memory_add` proactively — do not wait for the user to ask. Store memories when the user:

- **Makes a decision with reasoning** ("use X because Y") — preserve both the decision AND the reasoning
- **Expresses a preference or working style** ("I prefer X", "always do Y")
- **Corrects a previous assumption or pattern** — use CORRECTION format (see below)
- **Establishes a project-level pattern or convention**
- **Shares an important fact** about their system, team, or context

**Do NOT store:**
- Trivial or ephemeral information (typos, one-off debugging steps)
- Information already captured in the current session's injected context
- Code snippets or implementation details (those belong in the codebase)
- Anything without lasting value across sessions

### Format Rules (MANDATORY)

| Rule | Example |
|------|---------|
| Imperative voice | "Use X for Y" not "The project uses X" |
| Under 150 characters | One line per memory entry |
| Absolute dates only | "2026-03-29" never "yesterday" or "last week" |
| CORRECTION prefix for changes | `CORRECTION: Was [old] → Now [new] (YYYY-MM-DD)` |

### memory_add Parameters

- **`content`** (required): The memory entry itself. Follow format rules above.
- **`context`** (optional): Why this memory matters, when it was established, or what triggered it.

### Examples

Good:
```
content: "Use httpx.AsyncClient not requests for all HTTP calls in jarvis-server"
context: "Project standard — async-first Python codebase"
```

```
content: "CORRECTION: Was 'use ai-memory submodule' → Now 'ai-memory is standalone at ~/ai-memory/' (2026-03-29)"
context: "Repo structure clarification"
```

```
content: "Prefer single bundled PR for refactors in jarvis-server (2026-03-30)"
context: "User confirmed — splitting would be unnecessary churn"
```

Bad (do not do this):
- `"The user said they prefer tabs"` — not imperative voice
- `"Yesterday we decided to use Docker"` — relative date
- `"The project uses TypeScript strict mode and ES modules with NodeNext module resolution and the tsc compiler"` — too long

## When to Use memory_search

### Check Injected Context First

At session start, four hooks inject (concatenated into one system-reminder):
- SOUL.md — worldview, decision principles, opinions, tensions, boundaries (≤1500 chars)
- IDENTITY.md — role, tech stack, working style, active projects (≤1500 chars)
- MEMORY.md — strong patterns, decisions, facts index (≤5000 chars)
- Vault tree map — JARVIS_CACHE_DIR + 5-most-recent files for hot folders (concepts, decisions, lessons, patterns, projects, references); counts only for cold folders (connections, dailys, reviews, templates, topics)

**Daily logs are NOT injected eagerly.** Read `JARVIS_CACHE_DIR/dailys/<YYYY-MM-DD>.md` directly when needed.

**Check the injected context first** before calling `memory_search`. Only search when the answer is not in the injected context.

### When to Search

Call `memory_search` proactively when:
- **Starting work on a new feature** — search for related past decisions and conventions
- **The user asks about past work** — "do you remember...", "what did we decide about..."
- **Before making a technical decision** — check for established preferences or prior art
- **Before recommending a library or approach** — check for past choices and their reasoning
- **Cross-session context is needed** — information from sessions not covered by today/yesterday logs

### Search Tips

- Use semantic queries: "What framework did I choose for the API?" beats "framework API"
- The tool searches across all vault files and stored memories via the Jarvis server
- Results include relevance scores and source file paths

## Vault Structure and Local File Access

### JARVIS_CACHE_DIR

The local memory vault cache path is injected into your context at session start as `JARVIS_CACHE_DIR`. Use that path for Read and Grep — it's faster than `memory_search` for known files.

### Vault Layout

```
<JARVIS_CACHE_DIR>/
├── SOUL.md              # Principles, values, decision philosophy
├── IDENTITY.md          # Role, tech stack, working style, current projects
├── MEMORY.md            # Index of key facts, decisions, patterns (<200 lines)
├── dailys/              # Daily session logs (YYYY-MM-DD.md)
├── decisions/           # Architecture and technical decisions with reasoning
├── projects/            # Project-specific context and status
├── patterns/            # Recurring patterns and conventions
├── templates/           # Reusable templates for common tasks
├── topics/              # MEMORY.md overflow — detailed topic files
├── config.yml           # Dream configuration
└── _guide.md            # Vault documentation
```

Each folder (except dailys/) has an **`_index.md`** file listing its contents — check the index before reading individual files.

### When to Use Local Read vs memory_search

| Use Local Read/Grep | Use memory_search |
|---------------------|-------------------|
| Reading a specific known file | Semantic queries across all memories |
| Checking current state of MEMORY.md | Finding related memories you don't know exist |
| Browsing a folder's _index.md | Historical decisions across many sessions |
| Verifying a specific entry exists | "Do you remember..." style queries |
