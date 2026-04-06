export type JarvisResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

interface JarvisErrorBody {
  error?: { code?: string; message?: string };
}

// Config comes from env vars set by Claude Code via .mcp.json ${user_config.*} templates
const JARVIS_SERVER_URL = process.env.JARVIS_SERVER_URL || 'http://localhost:8000';
const JARVIS_API_KEY = process.env.JARVIS_API_KEY || '';
const JARVIS_EXTRA_HEADERS_RAW = process.env.JARVIS_EXTRA_HEADERS || '';

function parseExtraHeaders(): Record<string, string> {
  if (!JARVIS_EXTRA_HEADERS_RAW) return {};
  try {
    const parsed = JSON.parse(JARVIS_EXTRA_HEADERS_RAW);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

const EXTRA_HEADERS = parseExtraHeaders();

function buildHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${JARVIS_API_KEY}`,
    ...EXTRA_HEADERS,
  };
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as JarvisErrorBody;
    if (body.error?.code && body.error?.message) {
      return `Server error: ${body.error.code} - ${body.error.message}`;
    }
    if (body.error?.message) {
      return `Server error: ${body.error.message}`;
    }
  } catch {
    // response body not JSON — fall through
  }
  return `Server error: HTTP ${response.status}`;
}

export async function jarvisGet<T>(path: string): Promise<JarvisResult<T>> {
  try {
    const response = await fetch(`${JARVIS_SERVER_URL}${path}`, {
      method: 'GET',
      headers: buildHeaders(),
    });
    if (!response.ok) {
      return { ok: false, error: await extractErrorMessage(response) };
    }
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Jarvis server unreachable: ${message}` };
  }
}

export async function jarvisPost<T>(path: string, body: unknown): Promise<JarvisResult<T>> {
  try {
    const response = await fetch(`${JARVIS_SERVER_URL}${path}`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return { ok: false, error: await extractErrorMessage(response) };
    }
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Jarvis server unreachable: ${message}` };
  }
}
