import { createCanvas } from '@napi-rs/canvas';
import { drawAvatar, drawBackground, fit, hex, prepareBackground as prepare, roundRect } from '../../core/ui/canvas.js';

export const CARD_WIDTH = 934;
export const CARD_HEIGHT = 282;

export interface RankCardData {
  displayName: string;
  username: string;
  avatar: Buffer | null;
  /** A pre-sized uploaded background. Wins over `preset` when set. */
  background: Buffer | null;
  preset: string;
  accent: number;
  rank: number | null;
  level: number;
  current: number;
  needed: number;
  labels: { rank: string; level: string; xp: string };
}

export function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return value.toLocaleString('en-US');
}

export async function renderRankCard(data: RankCardData): Promise<Buffer> {
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');
  const accent = hex(data.accent);

  roundRect(ctx, 0, 0, CARD_WIDTH, CARD_HEIGHT, 24);
  ctx.clip();
  await drawBackground(ctx, CARD_WIDTH, CARD_HEIGHT, data.background, data.preset);

  // A dark panel keeps the text readable on any background.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  roundRect(ctx, 20, 20, CARD_WIDTH - 40, CARD_HEIGHT - 40, 18);
  ctx.fill();

  const avatarSize = 180;
  const ax = 50;
  const ay = (CARD_HEIGHT - avatarSize) / 2;
  await drawAvatar(ctx, data.avatar, ax, ay, avatarSize, accent);

  const left = 270;
  const right = CARD_WIDTH - 50;

  // Rank and level, right-aligned: small label then big number, drawn from the right edge.
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'right';
  let x = right;
  const stat = (label: string, value: string, color: string) => {
    ctx.font = '48px "Card Bold"';
    ctx.fillStyle = color;
    ctx.fillText(value, x, 98);
    x -= ctx.measureText(value).width + 10;
    ctx.font = '22px "Card SemiBold"';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillText(label, x, 98);
    x -= ctx.measureText(label).width + 28;
  };
  stat(data.labels.level, compact(data.level), accent);
  if (data.rank !== null) stat(data.labels.rank, `#${compact(data.rank)}`, '#ffffff');

  ctx.textAlign = 'left';
  ctx.font = '38px "Card Bold"';
  ctx.fillStyle = '#ffffff';
  const nameWidth = Math.max(120, x - left);
  ctx.fillText(fit(ctx, data.displayName, nameWidth), left, 98);
  ctx.font = '22px "Card"';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  // The username sits below the stats, so it can use the full width.
  ctx.fillText(fit(ctx, `@${data.username}`, right - left), left, 132);

  const barY = 186;
  const barH = 38;
  const barW = right - left;
  ctx.font = '22px "Card SemiBold"';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${compact(data.current)} / ${compact(data.needed)} ${data.labels.xp}`, right, barY - 12);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  roundRect(ctx, left, barY, barW, barH, barH / 2);
  ctx.fill();
  const ratio = data.needed > 0 ? Math.min(1, Math.max(0, data.current / data.needed)) : 0;
  if (ratio > 0) {
    ctx.fillStyle = accent;
    // Never narrower than the bar's height, or the rounded ends turn into a smudge.
    roundRect(ctx, left, barY, Math.max(barH, barW * ratio), barH, barH / 2);
    ctx.fill();
  }

  return canvas.toBuffer('image/png');
}

/** Resizes an uploaded image to rank card size. */
export function prepareBackground(input: Buffer): Promise<Buffer> {
  return prepare(input, CARD_WIDTH, CARD_HEIGHT);
}
