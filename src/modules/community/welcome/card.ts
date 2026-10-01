import { createCanvas } from '@napi-rs/canvas';
import { drawAvatar, drawBackground, fit, hex, prepareBackground as prepare, roundRect } from '../../../core/ui/canvas.js';

export const WELCOME_WIDTH = 1024;
export const WELCOME_HEIGHT = 450;

export interface WelcomeCardData {
  title: string;
  name: string;
  subtitle: string;
  avatar: Buffer | null;
  background: Buffer | null;
  preset: string;
  accent: number;
}

export async function renderWelcomeCard(data: WelcomeCardData): Promise<Buffer> {
  const canvas = createCanvas(WELCOME_WIDTH, WELCOME_HEIGHT);
  const ctx = canvas.getContext('2d');
  const accent = hex(data.accent);

  roundRect(ctx, 0, 0, WELCOME_WIDTH, WELCOME_HEIGHT, 28);
  ctx.clip();
  await drawBackground(ctx, WELCOME_WIDTH, WELCOME_HEIGHT, data.background, data.preset);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  roundRect(ctx, 24, 24, WELCOME_WIDTH - 48, WELCOME_HEIGHT - 48, 22);
  ctx.fill();

  const size = 170;
  await drawAvatar(ctx, data.avatar, (WELCOME_WIDTH - size) / 2, 48, size, accent);

  const center = WELCOME_WIDTH / 2;
  const maxWidth = WELCOME_WIDTH - 120;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = accent;
  ctx.font = '54px "Card Bold"';
  ctx.fillText(fit(ctx, data.title, maxWidth), center, 300);
  ctx.fillStyle = '#ffffff';
  ctx.font = '40px "Card SemiBold"';
  ctx.fillText(fit(ctx, data.name, maxWidth), center, 352);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = '26px "Card"';
  ctx.fillText(fit(ctx, data.subtitle, maxWidth), center, 396);

  return canvas.toBuffer('image/png');
}

export function prepareWelcomeBackground(input: Buffer): Promise<Buffer> {
  return prepare(input, WELCOME_WIDTH, WELCOME_HEIGHT);
}
