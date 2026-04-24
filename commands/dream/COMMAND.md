# /dream

Trigger a manual deep dream cycle to consolidate your memories.

## Instructions

When the user runs `/dream`, invoke the MCP `dream` tool.

The user may supply an optional date (e.g. `/dream 2026-04-20`) to backfill a past day — in that case pass `{ "source_date": "2026-04-20" }` as the tool's arguments. If no date is given, pass `{}` and the dream targets today.

The tool returns a confirmation once the dream is queued. Report the confirmation message back to the user verbatim. The dream runs asynchronously; do not wait for it to complete.

If the tool returns an error (e.g. "Jarvis server unreachable"), surface the error clearly so the user can diagnose connectivity issues.
