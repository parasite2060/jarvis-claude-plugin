# /recall

Search your memories for past decisions, preferences, and context.

## Instructions

When the user runs `/recall`, follow these steps exactly:

### Step 1: Extract the Query

- Parse everything after `/recall ` as the search query.
- If no query text is provided (user typed just `/recall`), ask: **"What would you like to recall? Provide a search query."** and wait for their response.

### Step 2: Search Memories

Call the `memory_search` MCP tool with the user's query string.

### Step 3: Present Results

**If results are returned:**

1. Display each result with its relevance score and source file:
   - Quote the most relevant memory content directly
   - Group by relevance: high (>0.85), medium (0.60-0.85), low (<0.60)
2. After listing results, provide a brief synthesis:
   - If results relate to a past decision, state what was decided and why
   - If results show a pattern, summarize the pattern
   - Connect the results to the user's current context when possible
3. Use the results to inform your next response naturally — do not just dump raw data

**If no results are found:**

Report: **"No matching memories found."** Then suggest:
- Broader or alternative search terms
- Checking a specific vault folder if the topic area is known (e.g., "Try checking `decisions/` for architecture decisions")

### Tips for Better Results

- Use semantic queries, not keyword searches. "What framework did I choose for the API?" works better than "framework API".
- The `memory_search` tool searches across all vault files and stored memories, not just what is in the current session context.
- For known specific files, it may be faster to Read them directly from `JARVIS_CACHE_DIR` (injected at session start).
