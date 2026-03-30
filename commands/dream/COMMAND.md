# /dream

Trigger a manual dream cycle to consolidate your memories.

## Instructions

When the user runs /dream:
1. Call POST on the Jarvis server at `${serverUrl}/dream` with body `{"type": "deep"}`
2. Use the API key from plugin config for authentication (Bearer token)
3. Report: "Dream cycle triggered. Your memories will be consolidated shortly."
4. If the server is unreachable, report: "Could not reach Jarvis server. Is it running?"
