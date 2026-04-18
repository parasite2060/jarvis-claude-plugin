# /dream

Trigger a manual deep dream cycle to consolidate your memories.

## Instructions

When the user runs `/dream`, invoke the MCP `dream` tool.

The tool takes no arguments and returns a confirmation once the dream is queued. Report the confirmation message back to the user verbatim — do not paraphrase or add commentary. The dream runs asynchronously; do not wait for it to complete.

If the tool returns an error (e.g. "Jarvis server unreachable"), surface the error clearly so the user can diagnose connectivity issues.
