import { fetchText } from '../../core/http.js';

export interface Video {
  id: string;
  title: string;
  url: string;
  published: Date;
  isShort: boolean;
}

export interface YouTubeFeed {
  channelId: string;
  name: string;
  videos: Video[];
}

type ParsedFeed = Omit<YouTubeFeed, 'channelId'>;

const CHANNEL_ID = /^UC[\w-]{22}$/;

/** What someone pasted: a channel ID, a channel URL, a handle or a handle URL. */
export function parseChannelInput(input: string): { channelId: string } | { handle: string } | null {
  const text = input.trim();
  if (CHANNEL_ID.test(text)) return { channelId: text };
  const byId = /youtube\.com\/channel\/(UC[\w-]{22})/i.exec(text);
  if (byId) return { channelId: byId[1]! };
  const byHandle = /(?:youtube\.com\/)?@([\w.-]{3,30})\/?$/i.exec(text);
  if (byHandle) return { handle: byHandle[1]! };
  return null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity] ?? whole;
  });
}

function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? decodeXml(match[1]!.trim()) : null;
}

/** Reads the Atom feed YouTube publishes for every channel. Newest videos come first. */
export function parseFeed(xml: string): ParsedFeed {
  const head = xml.split('<entry>')[0] ?? '';
  const videos: Video[] = [];
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const id = tag(entry!, 'yt:videoId');
    const published = tag(entry!, 'published');
    if (!id || !published) continue;
    const link = /<link rel="alternate" href="([^"]+)"/.exec(entry!)?.[1];
    const url = link ? decodeXml(link) : `https://www.youtube.com/watch?v=${id}`;
    videos.push({ id, title: tag(entry!, 'title') ?? '', url, published: new Date(published), isShort: url.includes('/shorts/') });
  }
  return { name: tag(head, 'title') ?? '', videos };
}

export async function fetchFeed(channelId: string): Promise<YouTubeFeed> {
  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  return { ...parseFeed(xml), channelId };
}

/** Finds the channel ID on a channel page, for people who only know the @handle. */
export function channelIdFromPage(html: string): string | null {
  const patterns = [
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /"externalId":"(UC[\w-]{22})"/,
    /"channelId":"(UC[\w-]{22})"/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return match[1]!;
  }
  return null;
}

export async function resolveChannel(input: string): Promise<YouTubeFeed | null> {
  const parsed = parseChannelInput(input);
  if (!parsed) return null;
  let channelId = 'channelId' in parsed ? parsed.channelId : null;
  if (!channelId) {
    // Without these cookies, visitors from the EU get a consent page instead of the channel.
    const html = await fetchText(`https://www.youtube.com/@${'handle' in parsed ? parsed.handle : ''}`, {
      headers: { cookie: 'SOCS=CAI; CONSENT=YES+1', 'accept-language': 'en' },
    }).catch(() => null);
    channelId = html ? channelIdFromPage(html) : null;
  }
  if (!channelId) return null;
  return fetchFeed(channelId).catch(() => null);
}
