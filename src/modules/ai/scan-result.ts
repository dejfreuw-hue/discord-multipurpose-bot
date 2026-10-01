export interface ScanResult {
  /** 0-100: how sure the model is that the image is a scam. */
  score: number;
  reason: string;
}

export const SCAN_PROMPT = [
  'You check images posted in a Discord server for scams.',
  'Common scams: fake Discord Nitro or Steam gifts, crypto or investment giveaways, QR codes asking people to log in or scan,',
  'fake Discord staff or "your account will be banned" notices, "I accidentally reported you" messages, phishing login pages,',
  'and screenshots promising money for clicking a link or sending a DM.',
  'Ordinary memes, screenshots, art and photos are not scams.',
  'Reply with only a JSON object and nothing else: {"scam": <0-100 confidence that this is a scam>, "reason": "<one short sentence>"}',
].join('\n');

/** Reads the model's verdict. Models sometimes wrap JSON in prose or code fences, so look for the object itself. */
export function parseScanResult(text: string): ScanResult | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const data = JSON.parse(text.slice(start, end + 1)) as { scam?: unknown; reason?: unknown };
      const score = Number(data.scam);
      if (Number.isFinite(score)) {
        return { score: Math.max(0, Math.min(100, Math.round(score))), reason: String(data.reason ?? '').slice(0, 200) };
      }
    } catch {
      // Fall through to the looser match below.
    }
  }
  const loose = /"?scam"?\s*[:=]\s*(\d{1,3})/i.exec(text);
  return loose ? { score: Math.min(100, Number(loose[1])), reason: '' } : null;
}
