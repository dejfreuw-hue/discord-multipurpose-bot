export const PROVIDERS = ['openai', 'anthropic', 'gemini', 'compatible'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export interface ImageInput {
  mimeType: string;
  /** Base64 without the data: prefix. */
  data: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: ImageInput[];
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
}

export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface Provider {
  readonly name: ProviderName;
  chat(request: ChatRequest, signal: AbortSignal): Promise<ChatResult>;
}

/** A provider call that failed. `kind` drives the message users see; details only go to the log. */
export class ProviderError extends Error {
  override name = 'ProviderError';

  constructor(
    readonly kind: 'auth' | 'rate_limit' | 'bad_request' | 'unavailable' | 'empty' | 'timeout',
    message: string,
  ) {
    super(message);
  }
}

/** Shared HTTP handling: maps status codes and network failures to ProviderErrors. */
export async function postJson<T>(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new ProviderError('timeout', 'request timed out');
    throw new ProviderError('unavailable', err instanceof Error ? err.message : String(err));
  }
  if (res.ok) return (await res.json()) as T;

  // The body explains what went wrong (bad model name, quota) and never echoes the key.
  const detail = `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`;
  if (res.status === 401 || res.status === 403) throw new ProviderError('auth', detail);
  if (res.status === 429) throw new ProviderError('rate_limit', detail);
  if (res.status >= 400 && res.status < 500) throw new ProviderError('bad_request', detail);
  throw new ProviderError('unavailable', detail);
}

export function requireText(text: string | undefined, raw: unknown): string {
  if (!text?.trim()) throw new ProviderError('empty', `no text in response: ${JSON.stringify(raw).slice(0, 300)}`);
  return text.trim();
}
