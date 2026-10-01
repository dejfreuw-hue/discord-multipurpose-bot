# Listing graphics

The BuiltByBit images, built as HTML/CSS and exported with Playwright. This folder is for the
seller only: it isn't part of the bot, the bot's lint and Docker build skip it, and it shouldn't
go into the zip buyers download.

| File | Output |
| --- | --- |
| `cover.html` | 1920x1080 cover, exported at 2x and 3x |
| `features.html` | 1200px wide overview with hero, stats and feature cards |
| `previews.html` | 1200px wide "In action" grid of Discord message mockups |

## Exporting

```bash
cd promo
npm install
npx playwright install chromium   # once; skip if you point CHROMIUM_PATH at a Chromium you have
npm run export                    # all pages
node export.js cover              # one page
```

Images land in `promo/out/` as PNG and JPG (quality 92): `cover@2x`, `cover@3x`, `features@2x`,
`previews@2x`. Pages taller than 2600px are also saved as `-part1`, `-part2`, ... cut between
sections, for sites that shrink tall images.

You can also open any page straight in a browser to check it while editing.

## Changing things

- **Colours**: the block at the top of `theme.css`. Discord's own colours are in `discord.css`.
- **Names, price and numbers**: the `window.PROMO` block at the top of each HTML file. The
  stats are real counts from the codebase (slash commands, modules, tests); update them when
  those change.
- **Rank card and welcome card**: these are rendered by the bot's own code. After changing the
  card design, run `npm run cards` (from this folder) to regenerate `assets/*.png`.

Everything shown is made up: members, songs, artists and the giveaway prize. Avatars and album
covers are SVG generated from a seed in `art.js`.

## Fonts

Inter (UI), Bricolage Grotesque (headings), JetBrains Mono (labels) and Noto Sans (standing in for
Discord's own font in the mockups) are bundled in `fonts/` under the SIL Open Font License; the
license texts are next to them. Slot machine symbols use your system's colour emoji font.
