// Renders the promo pages to PNG and JPG with Playwright.
//
//   node export.js            all pages
//   node export.js cover      only cover.html
//
// Output goes to ./out. Set CHROMIUM_PATH to use a specific Chromium build instead of the one
// Playwright downloads with `npx playwright install chromium`.

import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');

const PAGES = [
  { name: 'cover', width: 1920, height: 1080, scales: [2, 3] },
  { name: 'features', width: 1200, scales: [2] },
  { name: 'previews', width: 1200, scales: [2] },
];

const JPEG_QUALITY = 92;
// Pages taller than this (in CSS pixels) are also saved in parts, cut between sections, since
// listing sites and image viewers often shrink very tall images until they're unreadable.
const SPLIT_ABOVE = 2600;
const MAX_PART = 2200;

/**
 * Where to cut a tall page: always between [data-section] blocks, starting a new part whenever
 * the next block would push the current one past MAX_PART. A single huge section stays whole.
 */
function partsFor(sectionTops, pageHeight) {
  const bounds = [...sectionTops.filter((t) => t > 0 && t < pageHeight).sort((a, b) => a - b), pageHeight];
  const cuts = [0];
  let previous = 0;
  for (const top of bounds) {
    if (top - cuts.at(-1) > MAX_PART && previous > cuts.at(-1)) cuts.push(previous);
    previous = top;
  }
  return cuts.map((y, i) => ({ y, height: (cuts[i + 1] ?? pageHeight) - y }));
}

async function exportPage(browser, page, scale) {
  const context = await browser.newContext({
    viewport: { width: page.width, height: page.height ?? 1000 },
    deviceScaleFactor: scale,
  });
  const tab = await context.newPage();
  const errors = [];
  tab.on('pageerror', (err) => errors.push(err.message));
  tab.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));

  await tab.goto(pathToFileURL(join(here, `${page.name}.html`)).href);
  // art.js sets this once fonts, generated artwork and images are all loaded.
  await tab.waitForSelector('html[data-ready="true"]', { timeout: 30_000 }).catch(() => {
    throw new Error(`${page.name}.html never became ready: ${errors.join('; ') || 'no errors reported'}`);
  });
  if (errors.length) throw new Error(`${page.name}.html: ${errors.join('; ')}`);

  const base = join(outDir, `${page.name}@${scale}x`);
  // Parts from an earlier, taller version of the page would otherwise linger next to the new ones.
  for (const file of await readdir(outDir)) {
    if (file.startsWith(`${page.name}@${scale}x-part`)) await rm(join(outDir, file));
  }
  const fullPage = !page.height;
  await tab.screenshot({ path: `${base}.png`, fullPage, type: 'png' });
  await tab.screenshot({ path: `${base}.jpg`, fullPage, type: 'jpeg', quality: JPEG_QUALITY });
  const written = [`${base}.png`, `${base}.jpg`];

  const height = await tab.evaluate(() => document.documentElement.scrollHeight);
  if (fullPage && height > SPLIT_ABOVE) {
    const tops = await tab.$$eval('[data-section]', (els) => els.map((el) => el.getBoundingClientRect().top + window.scrollY));
    // Cut a little above each section so borders and corner marks stay in one piece.
    const parts = partsFor(
      tops.map((t) => Math.max(0, Math.floor(t) - 10)),
      height,
    );
    for (const [i, part] of parts.entries()) {
      const clip = { x: 0, y: part.y, width: page.width, height: part.height };
      const file = `${base}-part${i + 1}`;
      await tab.screenshot({ path: `${file}.png`, clip, fullPage: true, type: 'png' });
      await tab.screenshot({ path: `${file}.jpg`, clip, fullPage: true, type: 'jpeg', quality: JPEG_QUALITY });
      written.push(`${file}.png`, `${file}.jpg`);
    }
  }
  await context.close();
  return { written, height };
}

const only = process.argv.slice(2);
const pages = only.length ? PAGES.filter((p) => only.includes(p.name)) : PAGES;
if (pages.length === 0) {
  console.error(`unknown page: ${only.join(', ')}. Pages: ${PAGES.map((p) => p.name).join(', ')}`);
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  for (const page of pages) {
    for (const scale of page.scales) {
      const { written, height } = await exportPage(browser, page, scale);
      console.log(`${page.name} @${scale}x (${page.width}x${page.height ?? height}): ${written.map((f) => f.slice(here.length + 1)).join(', ')}`);
    }
  }
} finally {
  await browser.close();
}
