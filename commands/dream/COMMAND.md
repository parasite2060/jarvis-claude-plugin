# /dream

Trigger a manual dream cycle to consolidate your memories.

## Instructions

When the user runs `/dream`, follow these steps exactly:

### Step 1: Read Configuration

- **Server URL**: Read from environment variable `CLAUDE_PLUGIN_OPTION_serverUrl` (default: `http://localhost:8000`)
- **API Key**: Read from environment variable `CLAUDE_PLUGIN_OPTION_apiKey`
- **Worker Port**: Read from environment variable `CLAUDE_PLUGIN_OPTION_workerPort` (default: `37777`)

### Step 2: Call the Dream Endpoint

Make an HTTP POST request:

- **URL**: `{serverUrl}/dream`
- **Headers**:
  - `Authorization: Bearer {apiKey}`
  - `Content-Type: application/json`
- **Body**: `{"type": "deep"}`

### Step 3: Handle the Response

**On success (HTTP 202)**:
Report to the user:
> Dream cycle triggered. Your memories will be consolidated shortly.
>
> The local worker will sync updated memory files within 5 minutes. To trigger an immediate sync, run: `POST http://localhost:{workerPort}/sync`

**On error response (HTTP 4xx/5xx)**:
Parse the response body as JSON. Extract the error from `{ "error": { "code": "...", "message": "..." }, "status": "error" }` format. Report:
> Dream request failed: {error.message} (code: {error.code})

If the response body cannot be parsed, report the HTTP status code.

**On network error (server unreachable)**:
Report:
> Could not reach Jarvis server. Is it running?

### Important Notes

- The `/dream` command always triggers a **deep dream** (full memory consolidation). Light dreams run automatically after sessions.
- The dream runs asynchronously on the server via a task queue. The 202 response means the dream has been queued, not completed.
- Do NOT block or wait for the dream to finish. Report the queued status and move on.
