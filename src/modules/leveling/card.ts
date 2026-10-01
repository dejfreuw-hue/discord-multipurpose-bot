import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { fromRoot } from '../../core/paths.js';
import { PRESETS } from './settings.js';

export const CARD_WIDTH = 934;
export const CARD_HEIGHT = 282;

// Bundled so cards look the same everywhere; slim Docker images and many Linux hosts have no
// system fonts at all, which would leave the text invisible.
GlobalFonts.registerFromPath(fromRoot('assets', 'fonts', 'OpenSans-Regular.ttf'), 'Card');
GlobalFonts.registerFromPath(fromRoot('assets', 'fonts', 'OpenSans-Semibold.ttf'), 'Card SemiBold');
GlobalFonts.registerFromPath(fromRoot('assets', 'fonts', 'OpenSans-Bold.ttf'), 'Card Bold');

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

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
}

/** Draws an image scaled to fill the box, cropping the overflow, like CSS object-fit: cover. */
export function drawCover(ctx: SKRSContext2D, image: Image, w: number, h: number): void {
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function fit(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}...`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}...`;
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
  if (data.background) {
    drawCover(ctx, await loadImage(data.background), CARD_WIDTH, CARD_HEIGHT);
  } else {
    const [from, to] = PRESETS[data.preset] ?? PRESETS.midnight!;
    const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  }

  // A dark panel keeps the text readable on any background.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  roundRect(ctx, 20, 20, CARD_WIDTH - 40, CARD_HEIGHT - 40, 18);
  ctx.fill();

  const avatarSize = 180;
  const ax = 50;
  const ay = (CARD_HEIGHT - avatarSize) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax + avatarSize / 2, ay + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (data.avatar) {
    ctx.drawImage(await loadImage(data.avatar), ax, ay, avatarSize, avatarSize);
  } else {
    ctx.fillStyle = '#4f545c';
    ctx.fillRect(ax, ay, avatarSize, avatarSize);
  }
  ctx.restore();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(ax + avatarSize / 2, ay + avatarSize / 2, avatarSize / 2 + 3, 0, Math.PI * 2);
  ctx.stroke();

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

/** Resizes an uploaded image to card size and re-encodes it, so stored backgrounds stay small. */
export async function prepareBackground(input: Buffer): Promise<Buffer> {
  const image = await loadImage(input);
  if (image.width < 50 || image.height < 20) throw new Error('image too small');
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  drawCover(canvas.getContext('2d'), image, CARD_WIDTH, CARD_HEIGHT);
  return canvas.toBuffer('image/jpeg', 85);
}
