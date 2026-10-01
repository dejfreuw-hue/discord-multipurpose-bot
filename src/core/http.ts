/** A request to an outside service that failed. `status` is 0 for network errors and timeouts. */
export class HttpError extends Error {
  override name = 'HttpError';

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** Sent as JSON, or as a form when it's a URLSearchParams. */
  body?: unknown;
  timeoutMs?: number;
}

async function request(url: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  let body: string | URLSearchParams | undefined;
  if (options.body instanceof URLSearchParams) body = options.body;
  else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['content-type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(url, { method: options.method ?? (body ? 'POST' : 'GET'), headers, body, signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) });
  } catch (err) {
    throw new HttpError(0, err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) {
    // Keep the body short; it's for the log, and services sometimes return whole HTML pages.
    throw new HttpError(res.status, `${new URL(url).host} answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  return res;
}

export async function fetchJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  return (await request(url, options)).json() as Promise<T>;
}

export async function fetchText(url: string, options: RequestOptions = {}): Promise<string> {
  return (await request(url, options)).text();
}
