import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import type { Logger } from 'pino';

/*
 * License check. This is the only file that talks to the license server.
 *
 * Request:  POST LICENSE_ENDPOINT
 *           { "key": "...", "product": "reuw-bot", "version": "1.0.0", "instance": "<hashed hostname>" }
 * Response: 200 { "valid": true }
 *           200 { "valid": false, "reason": "Key revoked" }
 * Anything else (timeouts, 5xx, garbage) counts as "server unreachable", which never blocks
 * the bot: buyers shouldn't lose their bot because the license server is down.
 */

const LICENSE_ENDPOINT = 'https://api.reuwthedev.com/v1/licenses/verify';
const PRODUCT = 'reuw-bot';
const TIMEOUT_MS = 10_000;
const RECHECK_MS = 6 * 60 * 60 * 1000;

export class LicenseError extends Error {
  override name = 'LicenseError';
}

type CheckResult = { status: 'valid' } | { status: 'invalid'; reason: string } | { status: 'unreachable'; reason: string };

async function check(key: string, version: string): Promise<CheckResult> {
  const instance = createHash('sha256').update(hostname()).digest('hex').slice(0, 16);
  let res: Response;
  try {
    res = await fetch(LICENSE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': `${PRODUCT}/${version}` },
      body: JSON.stringify({ key, product: PRODUCT, version, instance }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { status: 'unreachable', reason: err instanceof Error ? err.message : String(err) };
  }

  if (res.status >= 500) return { status: 'unreachable', reason: `HTTP ${res.status}` };

  const body = (await res.json().catch(() => null)) as { valid?: unknown; reason?: unknown } | null;
  if (!body || typeof body.valid !== 'boolean') return { status: 'unreachable', reason: `unexpected response (HTTP ${res.status})` };
  if (body.valid) return { status: 'valid' };
  return { status: 'invalid', reason: typeof body.reason === 'string' ? body.reason : 'the key was rejected' };
}

function invalidMessage(reason: string): string {
  return [
    `License check failed: ${reason}.`,
    '',
    'Make sure LICENSE_KEY in .env is the key from your BuiltByBit purchase, copied without spaces.',
    'If the key is correct and this keeps happening, open a ticket in the ReuwTheDev support server.',
  ].join('\n');
}

/**
 * Verifies the license key on startup and every few hours after. Throws a LicenseError with a
 * readable message if the key is missing or rejected. A key revoked while running triggers a
 * normal graceful shutdown.
 */
export async function verifyLicense(key: string, version: string, logger: Logger): Promise<void> {
  if (!key.trim()) {
    throw new LicenseError(
      'No license key found. Add LICENSE_KEY=your-key to .env (you can find the key on your BuiltByBit purchase page) and restart.',
    );
  }

  const result = await check(key.trim(), version);
  if (result.status === 'invalid') throw new LicenseError(invalidMessage(result.reason));
  if (result.status === 'unreachable') logger.warn({ reason: result.reason }, 'license server unreachable, continuing');
  else logger.info('license ok');

  const timer = setInterval(async () => {
    const recheck = await check(key.trim(), version);
    if (recheck.status === 'invalid') {
      logger.error(invalidMessage(recheck.reason));
      process.kill(process.pid, 'SIGTERM');
    } else if (recheck.status === 'unreachable') {
      logger.debug({ reason: recheck.reason }, 'license recheck skipped, server unreachable');
    }
  }, RECHECK_MS);
  timer.unref();
}
