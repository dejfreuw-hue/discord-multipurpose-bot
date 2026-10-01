import { createHash } from 'node:crypto';
import { PermissionFlagsBits, userMention, type Attachment, type Message } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { UserError } from '../../core/errors.js';
import { isStaff } from '../../core/permissions.js';
import { timeout } from '../moderation/actions.js';
import { postModLog } from '../moderation/modlog.js';
import { complete, providerFor } from './engine.js';
import type { ImageInput } from './providers/types.js';
import { parseScanResult, SCAN_PROMPT, type ScanResult } from './scan-result.js';
import type { AiSettings } from './settings.js';

const MAX_IMAGES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const CACHE_MS = 60 * 60 * 1000;

// Scam images get reposted word for word, so remember verdicts by image hash for an hour.
const verdicts = new Map<string, { result: ScanResult; at: number }>();

function isImage(attachment: Attachment): boolean {
  return Boolean(attachment.contentType?.startsWith('image/')) && attachment.size > 0;
}

async function download(attachment: Attachment): Promise<{ image: ImageInput; hash: string } | null> {
  // Discord's media proxy can resize and convert on the fly, which keeps uploads to the
  // provider small and in a format every provider accepts.
  const url = new URL(attachment.proxyURL);
  url.searchParams.set('width', String(Math.min(attachment.width ?? 1024, 1024)));
  url.searchParams.set('height', String(Math.min(attachment.height ?? 1024, 1024)));
  url.searchParams.set('format', 'webp');

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
  const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'image/webp';
  return { image: { mimeType, data: bytes.toString('base64') }, hash: createHash('sha256').update(bytes).digest('hex') };
}

export function shouldScan(message: Message<true>, settings: AiSettings, staffRoles: readonly string[]): boolean {
  const { scanner } = settings;
  if (!scanner.enabled || !message.member || !message.attachments.some(isImage)) return false;
  if (scanner.channels.length > 0 && !scanner.channels.includes(message.channelId) && !scanner.channels.includes(message.channel.parentId ?? '')) {
    return false;
  }
  const member = message.member;
  return !(member.permissions.has(PermissionFlagsBits.Administrator) || isStaff(member, staffRoles));
}

async function scanOne(bot: Bot, message: Message<true>, settings: AiSettings, attachment: Attachment): Promise<ScanResult | null> {
  const downloaded = await download(attachment);
  if (!downloaded) return null;
  const cached = verdicts.get(downloaded.hash);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.result;

  const text = await complete(bot, message.guild, providerFor(bot, settings), {
    system: SCAN_PROMPT,
    messages: [{ role: 'user', content: 'Is this image a scam?', images: [downloaded.image] }],
    vision: true,
    maxTokens: 300,
  });
  const result = parseScanResult(text);
  if (!result) {
    bot.logger.debug({ text: text.slice(0, 200) }, 'unreadable scan verdict');
    return null;
  }
  if (verdicts.size > 2000) verdicts.clear();
  verdicts.set(downloaded.hash, { result, at: Date.now() });
  return result;
}

/**
 * Scans a message's images and applies the server's thresholds to the most suspicious one.
 * Returns true when the message was deleted.
 */
export async function scanMessage(bot: Bot, message: Message<true>, settings: AiSettings): Promise<boolean> {
  let worst: ScanResult | null = null;
  for (const attachment of message.attachments.filter(isImage).first(MAX_IMAGES)) {
    try {
      const result = await scanOne(bot, message, settings, attachment);
      if (result && (!worst || result.score > worst.score)) worst = result;
    } catch (err) {
      // Budget and provider problems would hit every other image too, and were already logged.
      if (!(err instanceof UserError)) bot.logger.warn({ err }, 'image scan failed');
      break;
    }
  }
  if (!worst) return false;

  const { alert, delete: del, timeout: mute, timeoutMinutes } = settings.scanner;
  const hits = (threshold: number) => threshold > 0 && worst.score >= threshold;
  if (!hits(alert) && !hits(del) && !hits(mute)) return false;

  const core = await bot.settings.get(message.guildId);
  const t = (key: string, vars?: Record<string, string | number>) => bot.i18n.t(bot.guildLocale(core), key, vars);
  const reason = t('ai.scanner.reason', { score: worst.score, reason: worst.reason || '-' });
  const taken: string[] = [];

  let deleted = false;
  if (hits(del) && message.deletable) {
    deleted = await message.delete().then(
      () => true,
      () => false,
    );
    if (deleted) taken.push(t('ai.scanner.deleted'));
  }
  if (hits(mute) && message.member) {
    try {
      await timeout(bot, {
        guild: message.guild,
        user: message.author,
        moderator: null,
        reason,
        duration: timeoutMinutes * 60_000,
        source: 'scanner',
      });
      taken.push(t('ai.scanner.timedOut', { minutes: timeoutMinutes }));
    } catch (err) {
      bot.logger.info({ err: err instanceof Error ? err.message : err, user: message.author.id }, 'scanner timeout skipped');
    }
  }

  await postModLog(
    bot,
    message.guild,
    bot
      .panel(worst.score >= 80 ? 0xed4245 : 0xfaa61a)
      .title(t('ai.scanner.title', { score: worst.score }))
      .thumbnail(message.attachments.find(isImage)?.proxyURL)
      .fields([
        { name: t('moderation.case.user'), value: `${userMention(message.author.id)} ${message.author.tag}`, inline: true },
        { name: t('ai.scanner.message'), value: message.url, inline: true },
        { name: t('moderation.case.reason'), value: worst.reason || '-' },
        { name: t('ai.scanner.actions'), value: taken.join(', ') || t('ai.scanner.alertOnly') },
      ]),
  );
  return deleted;
}
