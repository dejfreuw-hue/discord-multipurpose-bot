export interface TranscriptAttachment {
  name: string;
  url: string;
  size: number;
  image: boolean;
}

export interface TranscriptMessage {
  id: string;
  authorName: string;
  authorAvatar: string;
  authorColor: string | null;
  bot: boolean;
  timestamp: Date;
  edited: boolean;
  content: string;
  attachments: TranscriptAttachment[];
  embeds: { title: string | null; description: string | null; color: string | null }[];
}

export interface TranscriptMeta {
  title: string;
  guildName: string;
  guildIcon: string | null;
  channelName: string;
  details: [label: string, value: string][];
  generatedAt: Date;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) links become clickable; anything else (javascript:, data:) stays plain text. */
function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function inlineMarkdown(escaped: string): string {
  // Links and emojis become placeholders first, so the formatting rules below can't reach
  // into their URLs (an underscore in a link would otherwise turn into <em>).
  const tokens: string[] = [];
  const hold = (html: string) => `\ue000${tokens.push(html) - 1}\ue000`;

  return escaped
    .replace(/&lt;(a?):(\w{2,32}):(\d{17,20})&gt;/g, (_, animated: string, name: string, id: string) =>
      hold(`<img class="emoji" alt=":${name}:" title=":${name}:" src="https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'webp'}?size=48">`),
    )
    .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,:;"')\]]/g, (raw) => {
      // The text is already escaped, so decode &amp; before validating and re-escape after.
      const url = safeUrl(raw.replace(/&amp;/g, '&'));
      return url ? hold(`<a href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank">${raw}</a>`) : raw;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>')
    .replace(/\ue000(\d+)\ue000/g, (match, i: string) => tokens[Number(i)] ?? match);
}

function renderLines(text: string): string {
  return escapeHtml(text)
    .split('\n')
    .map((line) => {
      const quote = /^&gt; ?(.*)$/.exec(line);
      const heading = /^(#{1,3}) (.+)$/.exec(line);
      if (quote) return `<blockquote>${inlineMarkdown(quote[1]!)}</blockquote>`;
      if (heading) return `<span class="h${heading[1]!.length}">${inlineMarkdown(heading[2]!)}</span>`;
      return inlineMarkdown(line);
    })
    .join('<br>')
    .replace(/<\/blockquote><br>/g, '</blockquote>');
}

/** Discord-flavoured markdown to HTML. Everything is escaped first; formatting is added afterwards. */
export function renderMarkdown(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((part) => {
      if (part.startsWith('```') && part.endsWith('```') && part.length >= 6) {
        const body = part.slice(3, -3).replace(/^[\w+-]*\n/, '');
        return `<pre><code>${escapeHtml(body)}</code></pre>`;
      }
      return part
        .split(/(`[^`\n]+`)/g)
        .map((piece) => (piece.length > 2 && piece.startsWith('`') && piece.endsWith('`') ? `<code>${escapeHtml(piece.slice(1, -1))}</code>` : renderLines(piece)))
        .join('');
    })
    .join('');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderMessage(m: TranscriptMessage, grouped: boolean): string {
  const time = m.timestamp.toISOString().replace('T', ' ').slice(0, 16);
  const parts: string[] = [];
  if (m.content) parts.push(`<div class="content">${renderMarkdown(m.content)}${m.edited ? ' <span class="edited">(edited)</span>' : ''}</div>`);
  for (const a of m.attachments) {
    const url = safeUrl(a.url);
    if (!url) continue;
    const href = escapeHtml(url);
    parts.push(
      a.image
        ? `<a href="${href}" target="_blank" rel="noopener noreferrer"><img class="attachment" src="${href}" alt="${escapeHtml(a.name)}" loading="lazy"></a>`
        : `<a class="file" href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.name)} <span>${formatSize(a.size)}</span></a>`,
    );
  }
  for (const e of m.embeds) {
    if (!e.title && !e.description) continue;
    const color = e.color && /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : '#4f545c';
    parts.push(
      `<div class="embed" style="border-color:${color}">${e.title ? `<div class="embed-title">${renderMarkdown(e.title)}</div>` : ''}${
        e.description ? `<div>${renderMarkdown(e.description)}</div>` : ''
      }</div>`,
    );
  }

  const nameColor = m.authorColor && /^#[0-9a-f]{6}$/i.test(m.authorColor) ? ` style="color:${m.authorColor}"` : '';
  const header = grouped
    ? ''
    : `<img class="avatar" src="${escapeHtml(safeUrl(m.authorAvatar) ?? '')}" alt=""><div class="meta"><span class="name"${nameColor}>${escapeHtml(m.authorName)}</span>${
        m.bot ? '<span class="tag">BOT</span>' : ''
      }<span class="time">${time} UTC</span></div>`;
  return `<div class="message${grouped ? ' grouped' : ''}" id="m${escapeHtml(m.id)}">${header}<div class="body">${parts.join('')}</div></div>`;
}

const STYLE = `
*{box-sizing:border-box}body{margin:0;background:#313338;color:#dbdee1;font:15px/1.4 "gg sans","Segoe UI",Helvetica,Arial,sans-serif}
header{display:flex;gap:16px;align-items:center;padding:20px 24px;background:#2b2d31;border-bottom:1px solid #1f2023}
header img{width:56px;height:56px;border-radius:50%}header h1{margin:0;font-size:20px;color:#f2f3f5}header p{margin:2px 0 0;color:#949ba4}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0;padding:16px 24px;background:#2b2d31;border-bottom:1px solid #1f2023}
dt{color:#949ba4}dd{margin:0}main{padding:16px 0}
.message{display:grid;grid-template-columns:56px 1fr;padding:4px 24px 2px 16px;margin-top:14px}.message.grouped{margin-top:0}
.message:hover{background:#2e3035}.avatar{width:40px;height:40px;border-radius:50%;grid-row:span 2}
.meta{display:flex;gap:8px;align-items:baseline}.name{font-weight:600;color:#f2f3f5}.time,.edited{color:#949ba4;font-size:12px}
.tag{background:#5865f2;color:#fff;font-size:10px;font-weight:600;padding:1px 4px;border-radius:3px}
.body{grid-column:2;min-width:0;overflow-wrap:anywhere}.content{white-space:normal}
a{color:#00a8fc}code{background:#2b2d31;border-radius:4px;padding:1px 4px;font-family:Consolas,monospace;font-size:13px}
pre{background:#2b2d31;border:1px solid #1e1f22;border-radius:6px;padding:8px;overflow:auto;margin:4px 0}pre code{padding:0}
blockquote{margin:2px 0;padding-left:10px;border-left:4px solid #4e5058}.spoiler{background:#1e1f22;color:transparent;border-radius:3px}
.spoiler:hover{color:inherit}.h1{font-size:22px;font-weight:700}.h2{font-size:19px;font-weight:700}.h3{font-size:16px;font-weight:700}
.emoji{width:22px;height:22px;vertical-align:bottom}.attachment{display:block;max-width:400px;max-height:300px;border-radius:6px;margin-top:4px}
.file{display:inline-block;margin-top:4px;padding:8px 12px;background:#2b2d31;border:1px solid #1e1f22;border-radius:6px}.file span{color:#949ba4;font-size:12px}
.embed{margin-top:4px;padding:8px 12px;background:#2b2d31;border-left:4px solid;border-radius:4px;max-width:520px}.embed-title{font-weight:600;color:#f2f3f5}
footer{padding:16px 24px;color:#949ba4;font-size:12px;border-top:1px solid #1f2023}`;

/** A self-contained HTML page of the conversation, readable offline in any browser. */
export function renderTranscript(meta: TranscriptMeta, messages: readonly TranscriptMessage[]): string {
  const rows: string[] = [];
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    // Consecutive messages from one author within 7 minutes share a header, like in Discord.
    const grouped = Boolean(prev && prev.authorName === m.authorName && m.timestamp.getTime() - prev.timestamp.getTime() < 7 * 60_000);
    rows.push(renderMessage(m, grouped));
  });
  const icon = meta.guildIcon && safeUrl(meta.guildIcon);
  const details = meta.details.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(meta.title)}</title><style>${STYLE}</style></head>
<body><header>${icon ? `<img src="${escapeHtml(icon)}" alt="">` : ''}<div><h1>${escapeHtml(meta.title)}</h1><p>${escapeHtml(meta.guildName)} / #${escapeHtml(meta.channelName)}</p></div></header>
<dl>${details}</dl><main>${rows.join('\n')}</main>
<footer>${messages.length} messages. Generated ${meta.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC.</footer></body></html>
`;
}
