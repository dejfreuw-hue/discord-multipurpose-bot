// Renders a rank card and a welcome card with the bot's own code, so the listing shows real output.
// Run from the repository root: npx tsx promo/make-cards.ts
import { writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { renderWelcomeCard } from '../src/modules/community/welcome/card.js';
import { renderRankCard } from '../src/modules/leveling/card.js';

// A fictional member: a generated gradient avatar instead of a real picture.
function avatar(from: string, to: string, sun: string, hill: string): Buffer {
  const size = 256;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, from);
  bg.addColorStop(1, to);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(170, 92, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hill;
  ctx.beginPath();
  ctx.moveTo(0, 210);
  ctx.quadraticCurveTo(110, 120, 256, 190);
  ctx.lineTo(256, 256);
  ctx.lineTo(0, 256);
  ctx.fill();
  return canvas.toBuffer('image/png');
}

const card = await renderRankCard({
  displayName: 'Marlowe',
  username: 'marlowe.exe',
  avatar: avatar('#1d6f8a', '#0e2340', '#ffcf7a', '#3de0ff'),
  background: null,
  preset: 'midnight',
  accent: 0x3de0ff,
  rank: 7,
  level: 23,
  current: 1847,
  needed: 3215,
  labels: { rank: 'RANK', level: 'LEVEL', xp: 'XP' },
});
writeFileSync(new URL('./assets/rank-card.png', import.meta.url), card);
console.log('wrote promo/assets/rank-card.png');

const welcome = await renderWelcomeCard({
  title: 'WELCOME',
  name: 'Ottilie',
  subtitle: 'Member #1,284',
  avatar: avatar('#6b3a2e', '#20131f', '#ffe2a8', '#e9825a'),
  background: null,
  preset: 'ocean',
  accent: 0x3de0ff,
});
writeFileSync(new URL('./assets/welcome-card.png', import.meta.url), welcome);
console.log('wrote promo/assets/welcome-card.png');
