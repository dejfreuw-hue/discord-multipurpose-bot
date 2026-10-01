import type { Collection, GuildTextBasedChannel, Message } from 'discord.js';
import type { TranscriptMessage } from './transcript.js';

/** Fetches up to `limit` messages, oldest first, in the shape the transcript renderer wants. */
export async function collectMessages(channel: GuildTextBasedChannel, limit: number): Promise<TranscriptMessage[]> {
  const messages: Message[] = [];
  let before: string | undefined;
  while (messages.length < limit) {
    const page: Collection<string, Message> = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (page.size === 0) break;
    messages.push(...page.values());
    before = page.last()!.id;
    if (page.size < 100) break;
  }

  return messages
    .slice(0, limit)
    .reverse()
    .map((m) => ({
      id: m.id,
      authorName: m.member?.displayName ?? m.author.displayName,
      authorAvatar: m.author.displayAvatarURL({ size: 64 }),
      authorColor: m.member && m.member.displayColor !== 0 ? m.member.displayHexColor : null,
      bot: m.author.bot,
      timestamp: m.createdAt,
      edited: m.editedTimestamp !== null,
      // cleanContent shows @name instead of <@id>, which is what a reader expects.
      content: m.cleanContent || textOfComponents(m),
      attachments: [...m.attachments.values()].map((a) => ({
        name: a.name,
        url: a.url,
        size: a.size,
        image: Boolean(a.contentType?.startsWith('image/')),
      })),
      embeds: m.embeds.map((e) => ({ title: e.title, description: e.description, color: e.hexColor })),
    }));
}

// The bot's own Components V2 messages have no content; their text lives in text displays.
function textOfComponents(message: Message): string {
  const texts: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const data = node as { type?: number; content?: unknown; components?: unknown[]; accessory?: unknown };
    if (typeof data.content === 'string') texts.push(data.content);
    data.components?.forEach(walk);
  };
  message.components.forEach((c) => walk(c.toJSON()));
  return texts.join('\n');
}
