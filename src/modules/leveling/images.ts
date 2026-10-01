/** Downloads an image, refusing anything that isn't one or is too large. Returns null on failure. */
export async function fetchImage(url: string, maxBytes: number): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) return null;
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > maxBytes) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > 0 && bytes.length <= maxBytes ? bytes : null;
  } catch {
    return null;
  }
}
