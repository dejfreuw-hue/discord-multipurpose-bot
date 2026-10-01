import { createCanvas } from '@napi-rs/canvas';
// Imported for its side effect: it registers the bundled fonts the captcha is drawn with.
import '../../../core/ui/canvas.js';

// No 0/O, 1/I/l or 5/S: they're too easy to mix up once the letters are rotated.
const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';

export function generateCode(length = 5, random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < length; i++) code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return code;
}

/** Case-insensitive, ignores spaces: what people actually type into a phone keyboard. */
export function codeMatches(expected: string, input: string): boolean {
  return input.replace(/\s+/g, '').toUpperCase() === expected.toUpperCase();
}

/**
 * Draws the code with rotated, offset letters and noise. Readable for people, annoying enough
 * for the simple bots that join servers in bulk. It's a speed bump, not a fortress.
 */
export function renderCaptcha(code: string, random: () => number = Math.random): Buffer {
  const width = 320;
  const height = 110;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const rand = (min: number, max: number) => min + random() * (max - min);

  ctx.fillStyle = '#1e1f22';
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = `hsla(${rand(0, 360)}, 60%, 60%, 0.35)`;
    ctx.fillRect(rand(0, width), rand(0, height), 2, 2);
  }

  const step = (width - 40) / code.length;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  [...code].forEach((char, i) => {
    ctx.save();
    ctx.translate(20 + step * (i + 0.5), height / 2 + rand(-12, 12));
    ctx.rotate(rand(-0.45, 0.45));
    ctx.font = `${Math.round(rand(44, 56))}px "Card Bold"`;
    ctx.fillStyle = `hsl(${rand(0, 360)}, 70%, 72%)`;
    ctx.fillText(char, 0, 0);
    ctx.restore();
  });

  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = `hsla(${rand(0, 360)}, 60%, 65%, 0.6)`;
    ctx.lineWidth = rand(1.5, 3);
    ctx.beginPath();
    ctx.moveTo(rand(0, width / 3), rand(0, height));
    ctx.bezierCurveTo(rand(0, width), rand(0, height), rand(0, width), rand(0, height), rand((width * 2) / 3, width), rand(0, height));
    ctx.stroke();
  }
  return canvas.toBuffer('image/png');
}
