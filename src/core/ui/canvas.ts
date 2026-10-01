import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { fromRoot } from '../paths.js';

// Bundled so images look the same everywhere; slim Docker images and many Linux hosts have no
// system fonts at all, which would leave the text invisible.
GlobalFonts.registerFromPath(fromRoot('assets', 'fonts', 'OpenSans-Regular.ttf'), 'Card');
GlobalFonts.registerFromPath(fromRoot('assets', 'fonts', 'OpenSans-Semibold.ttf'), 'Card SemiBold');
GlobalFonts.registerFromPath(fromRoot('assets', 'fonts', 'OpenSans-Bold.ttf'), 'Card Bold');

/** Gradient backgrounds that need no image, shared by rank and welcome cards. */
export const PRESETS: Record<string, [string, string]> = {
  midnight: ['#141e30', '#243b55'],
  sunset: ['#ee5a24', '#f9a03f'],
  ocean: ['#1a6e8e', '#36c2d8'],
  forest: ['#134e5e', '#4f9a63'],
  grape: ['#2f0743', '#6a2c91'],
  mono: ['#1c1c1e', '#3a3a3c'],
};
export const PRESET_NAMES = Object.keys(PRESETS);

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
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

/** Shortens text with "..." until it fits `maxWidth` in the current font. */
export function fit(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}...`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}...`;
}

/** Fills the canvas with an uploaded background, or a preset gradient when there is none. */
export async function drawBackground(ctx: SKRSContext2D, w: number, h: number, image: Buffer | null, preset: string): Promise<void> {
  if (image) {
    drawCover(ctx, await loadImage(image), w, h);
    return;
  }
  const [from, to] = PRESETS[preset] ?? PRESETS.midnight!;
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

/** A round avatar with a coloured ring. Missing avatars become a grey circle. */
export async function drawAvatar(ctx: SKRSContext2D, avatar: Buffer | null, x: number, y: number, size: number, ring: string): Promise<void> {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (avatar) {
    ctx.drawImage(await loadImage(avatar), x, y, size, size);
  } else {
    ctx.fillStyle = '#4f545c';
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
  ctx.strokeStyle = ring;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 + 3, 0, Math.PI * 2);
  ctx.stroke();
}

/** Resizes an uploaded image to the given size and re-encodes it, so stored backgrounds stay small. */
export async function prepareBackground(input: Buffer, width: number, height: number): Promise<Buffer> {
  const image = await loadImage(input);
  if (image.width < 50 || image.height < 20) throw new Error('image too small');
  const canvas = createCanvas(width, height);
  drawCover(canvas.getContext('2d'), image, width, height);
  return canvas.toBuffer('image/jpeg', 85);
}
