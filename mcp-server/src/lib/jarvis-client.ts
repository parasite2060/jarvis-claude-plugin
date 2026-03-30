export type JarvisResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

interface JarvisErrorBody {
  error?: { code?: string; message?: string };
}

const JARVIS_SERVER_URL = process.env.JARVIS_SERVER_URL ?? 'http://localhost:8000';
const JARVIS_API_KEY = process.env.JARVIS_API_KEY ?? '';

function buildHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${JARVIS_API_KEY}`,
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
