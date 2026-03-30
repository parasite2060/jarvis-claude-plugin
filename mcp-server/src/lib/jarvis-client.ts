/**
 * Typed HTTP client for Jarvis server communication.
 * Reads server URL and API key from env vars injected by .mcp.json.
 * Returns null on any error — callers handle graceful degradation.
 */

const JARVIS_SERVER_URL = process.env.JARVIS_SERVER_URL ?? 'http://localhost:8000';
const JARVIS_API_KEY = process.env.JARVIS_API_KEY ?? '';

function buildHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${JARVIS_API_KEY}`,
  };
}

export async function jarvisGet<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${JARVIS_SERVER_URL}${path}`, {
      method: 'GET',
      headers: buildHeaders(),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function jarvisPost<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const response = await fetch(`${JARVIS_SERVER_URL}${path}`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
