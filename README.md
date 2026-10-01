# Reuw

An all-in-one Discord bot by ReuwTheDev. You host it yourself, so your data and API keys stay yours.

Included so far: the core framework, **General** (help, bot info, ping, setup wizard) **Moderation** (bans, kicks, timeouts, warnings, purge, slowmode, channel locks, cases, temporary roles and a mod log) **AutoMod** (invite, link, bad word, spam, mass mention, caps and ghost ping filters with decaying strikes and escalating punishments) **AI** (a chatbot and a scam image scanner, using your own API key) **Tickets** (panels with forms, claim/lock/close, inactivity reminders, HTML transcripts and modmail through DMs) **Leveling** (text and voice XP, rank cards, leaderboards and role rewards) **Economy** (wallet and bank, daily/weekly/work, a shop with role items, blackjack, coinflip, slots and rob) and **Music** (YouTube, SoundCloud and Spotify links through Lavalink, a button controller, filters, lyrics and 24/7 mode).

## Requirements

- Node.js 20.19 or newer (22 LTS recommended)
- MongoDB 6 or newer, local or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster
- A Discord application with a bot user
- Lavalink v4 and Java 17+, only for the music module

Windows, Linux and macOS all work. Nothing needs compiling.

## 1. Create the Discord application

1. Open the [Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Under **Bot**, click **Reset Token** and copy the token. You'll need it in step 3.
3. Still under **Bot**, turn on the privileged intents the modules you use need:

   | Intent | Needed by |
   | --- | --- |
   | Server Members | Welcome messages, auto-roles and verification (Community module) |
   | Message Content | AutoMod, AI, Tickets (transcripts and modmail) |
   | Presence | Not needed |

   General and Moderation need none of them. AutoMod, AI and Tickets need Message Content. The bot only requests intents for modules that are enabled, so you can leave the rest off.
4. Under **Installation**, tick both **Guild Install** and **User Install**. User install lets people use `/botinfo` (and later `/userinfo` and `/rank`) anywhere.
5. Invite the bot: under **OAuth2 -> URL Generator**, tick the `bot` and `applications.commands` scopes, pick the permissions you want to grant (or Administrator for a quick test) and open the generated link. Once the bot runs, `/botinfo` has an **Invite** button with exactly the permissions it needs.

## 2. Get the code ready

```bash
npm install
cp .env.example .env      # on Windows: copy .env.example .env
```

## 3. Fill in `.env`

| Variable | What to put there |
| --- | --- |
| `DISCORD_TOKEN` | The token from step 1 |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/reuwbot` for a local MongoDB, or your Atlas connection string |
| `LICENSE_KEY` | The key from your BuiltByBit purchase |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | Only for the AI module. Fill in the ones you use |
| `AI_COMPAT_API_KEY` | Key for an OpenAI-compatible server, if it needs one |
| `SPOTIFY_ENABLED`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Optional, for Spotify links (docker-compose only; see Music) |
| `LAVALINK_*` | Only for music. The defaults match the bundled Lavalink setup |

For Atlas: create a free cluster, add a database user, allow your server's IP under **Network Access**, then use **Connect -> Drivers** to copy the connection string. Put a database name before the `?`, for example `...mongodb.net/reuwbot?retryWrites=true`.

## 4. Edit `config.yml`

Every option has a comment above it. At minimum set `bot.name`. While testing, set `commands.devGuildId` to your test server's ID so command changes show up instantly.

If the file has a mistake, the bot refuses to start and tells you which setting to fix, for example:

```
config.yml has 1 problem:
  - bot.color: must be a hex colour like "#5865F2" (in quotes)
```

## 5. Start it

```bash
npm run build
npm start
```

You should see `ready as YourBot#1234 in 1 guilds`. Commands register automatically on the first start. Run `/setup` in your server to pick a language, staff roles, accent colour and modules.

For development, `npm run dev` runs from source and restarts on changes.

## Running with Docker

The compose file starts the bot, MongoDB and Lavalink together.

```bash
cp .env.example .env     # fill in DISCORD_TOKEN, LICENSE_KEY and LAVALINK_PASSWORD
docker compose up -d --build
docker compose logs -f bot
```

`config.yml` and `locales/` are mounted from the host, so edit them and run `docker compose restart bot`. MongoDB isn't exposed outside the compose network.

## Lavalink without Docker

1. Install Java 17 or newer.
2. Download `Lavalink.jar` (v4) from the [Lavalink releases](https://github.com/lavalink-devs/Lavalink/releases).
3. Copy `lavalink/application.yml` next to it and set `lavalink.server.password` to match `LAVALINK_PASSWORD`.
4. Run `java -jar Lavalink.jar`. The first start downloads the plugins listed in the file.

The bot keeps retrying every 15 seconds until Lavalink is up, so start order doesn't matter.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/help [command]` | Everyone | Category menu of all commands, or details for one |
| `/ping` | Everyone | Gateway, round-trip and database latency |
| `/botinfo` | Everyone, also user-installed | Stats, versions and invite link |
| `/setup` | Manage Server | Wizard for language, staff roles, colour and modules |

### Moderation

| Command | Permission | What it does |
| --- | --- | --- |
| `/ban user [reason] [duration] [delete_messages]` | Ban Members | Ban, optionally temporary (`7d`, `2w`) |
| `/unban user [reason]` | Ban Members | Lift a ban. Paste the user ID if they're not in a shared server |
| `/kick user [reason]` | Kick Members | Remove a member |
| `/timeout add/remove` | Moderate Members | Time out for up to 28 days, or lift it |
| `/warn user [reason]` | Moderate Members | Record a warning and DM the member |
| `/purge amount [user] [filter]` | Manage Messages | Delete up to 100 recent messages, by user or type |
| `/slowmode duration [channel]` | Manage Channels | `5s`, `1m`, up to `6h`, or `off` |
| `/lock`, `/unlock [channel] [reason]` | Manage Channels | Stop or allow sending messages |
| `/case view/edit/delete/history` | Moderate Members | Look up and manage cases. Deleting needs Manage Server |
| `/temprole add/remove/list` | Manage Roles | Roles that remove themselves after a set time |

Members with a staff role from `/setup` can use these too, even without the Discord permission. By default Discord hides the commands from members who lack the permission; set `modules.moderation.hideCommands: false` in `config.yml` if your staff roles rely on the bot's own check.

Every action gets a numbered case (per server, never reused) and goes to the mod log channel picked in `/setup`. Bans, kicks and timeouts done through Discord's own menus are recorded too, as long as the bot has **View Audit Log**. Temporary bans and roles are stored in MongoDB, so they still expire correctly after a restart.

Before acting, the bot checks role order the way Discord does: nobody can act on the server owner, on someone with an equal or higher role, or on anyone above the bot's own role. If an action fails for that reason the message says which role to move.

### AutoMod

| Command | What it does |
| --- | --- |
| `/automod status` | Every filter, threshold, punishment and ignored role or channel at a glance |
| `/automod toggle filter enabled` | Turn one filter on or off |
| `/automod configure filter` | Opens a form for that filter's strikes and thresholds |
| `/automod words add/remove/list` | The bad word list. `*` is a wildcard: `scam*` |
| `/automod domains add/remove/list` | Domains the link filter allows. Subdomains are included |
| `/automod punishment add/remove` | What happens at a number of active strikes |
| `/automod decay duration` | How long strikes last |
| `/automod strikes view/clear user` | See or reset a member's strikes |

All of these need Manage Server. Filters, ignored roles and ignored channels are also in `/setup`.

How it works: a message that breaks a filter is deleted, the member gets a short warning in the channel, and the filter's strikes are added to their record. Strikes expire on their own after the decay time (24 hours by default). When a member's active strikes reach a step on the punishment ladder, that punishment runs through the Moderation module, so it gets a case, a DM and a mod log entry like any other action. The default ladder is a 10 minute timeout at 3 strikes, 1 hour at 5 and a kick at 8.

Server owners, administrators and (unless turned off) staff roles are never filtered. Ignoring a category ignores every channel in it, and ignoring a channel also covers its threads.

The bad word filter matches whole words, so `ass` won't flag `class`. It also catches common evasions: letter swaps (`1d10t`), accents, zero-width characters and spaced-out words (`i d i o t`, `i.d.i.o.t`). Ghost pings are reported in the channel when a message that pinged someone is deleted within the configured time; they give no strikes by default.

### AI

The AI module talks straight to the provider you choose, with your own API key. Nothing goes through ReuwTheDev's servers.

| Provider | `.env` key | Notes |
| --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |
| Google Gemini | `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com), has a free tier |
| OpenAI-compatible | `AI_COMPAT_API_KEY` (optional) | Set `modules.ai.providers.compatible.baseUrl` and the models. Works with OpenRouter, Groq, Ollama, LM Studio and similar |

Model names live in `config.yml` under `modules.ai.providers`. Providers change their lineups often, so check their docs if a model stops working; the bot logs the provider's error message when a request fails.

| Command | Who | What it does |
| --- | --- | --- |
| `/ask question` | Everyone | Ask the AI something |
| `/ai status` | Manage Server | Provider, model, limits, today's usage and scanner settings |
| `/ai provider`, `/ai personality`, `/ai persona` | Manage Server | Pick a provider, a preset personality, or write your own |
| `/ai channels add/remove` | Manage Server | Channels where the bot replies to every message |
| `/ai blacklist add/remove` | Manage Server | Block members or roles |
| `/ai limits` | Manage Server | Daily tokens, requests per user per minute, context size |
| `/ai scanner settings/add-channel/remove-channel` | Manage Server | The scam image scanner |

Outside its chat channels the bot answers when it's mentioned or replied to (turn this off in `/setup`). It reads the last few messages in the channel for context. Replies never ping anyone.

Every request counts against the server's daily token allowance, which resets at midnight UTC. `maxDailyTokens` in `config.yml` caps what any server can set, so one busy server can't run up your bill.

The scam image scanner sends images posted in the server to the provider's vision model and gets back a confidence score from 0 to 100 and a short reason. Each server sets three thresholds: post an alert to the mod log, delete the message, and time out the poster (0 turns an action off). Admins and staff are never scanned. Identical images are only checked once per hour. The scanner is off by default.

Messages the bot answers, and scanned images, are sent to the AI provider you configured. Mention that in your server rules if your members would want to know.

### Tickets and modmail

Setting up tickets takes four steps:

1. In `/setup`, pick the transcript channel, the Discord category new tickets go into, and the support roles.
2. `/tickets panel create title:Support style:Buttons` creates a panel. A panel can show buttons or a dropdown menu.
3. `/tickets category add panel:1 label:"Billing" emoji:... staff_role:@Billing` adds ticket types. Each type can have its own staff role, its own Discord category and a welcome message. Add up to five questions per type with `/tickets question add`; members fill them in a form before the ticket opens.
4. `/tickets panel send panel:1 channel:#support` posts it. Later changes update the posted panel automatically.

A server can have up to 25 panels with up to 25 ticket types each.

Each ticket is a private channel for the member, the support roles and staff. Staff can **claim** it (so others know it's handled), **lock** it (the member can read but not write), add or remove people and rename it with `/ticket`. The member or staff can **close** it with an optional reason.

On close, the bot saves an HTML transcript of the whole conversation to the transcript channel and, if enabled, DMs it to the member, then deletes the channel. Transcripts open in any browser and look like Discord. Attachments link to Discord's CDN, and Discord expires those links after a while, so save important files separately.

With reminders on (24 hours by default), the member is pinged when a ticket goes quiet. Auto-close (off by default) closes tickets that stay quiet for longer. Change both with `/tickets settings`.

**Modmail** lets members contact staff privately by DMing the bot. Turn it on in `/setup`. When someone DMs the bot, it asks which server they want to reach (only servers they share with the bot that have modmail on), then opens a staff-only channel. Everything they DM goes there, and everything staff write there goes back to them, except messages starting with `//`, which stay as internal notes. Staff can start a conversation with `/modmail open`, close it with `/modmail close` (transcripts work the same as tickets), and block abusers with `/modmail block`.

### Leveling

Members earn 15-25 XP per message (at most once a minute) and 10 XP per minute in voice, as long as they aren't alone, deafened or in the AFK channel. Everything is adjustable per server with `/levels`.

| Command | Who | What it does |
| --- | --- | --- |
| `/rank [user]` | Everyone, also user-installed | Rank card image. Outside a server with the bot, shows XP summed over all servers |
| `/leaderboard [by] [page]` | Everyone | Top members by XP, voice time or messages |
| `/rankcard preset/image/color/reset` | Everyone | Pick a background, upload one, or change the accent colour |
| `/levels status` | Manage Server | All leveling settings |
| `/levels text`, `/levels voice` | Manage Server | XP amounts, cooldown, voice rules |
| `/levels announce` | Manage Server | Level-up messages: same channel, DM, a set channel, or off, with an optional custom text |
| `/levels reward add/remove/mode` | Manage Server | Roles given at levels. Members keep all of them, or only the highest |
| `/levels multiplier set/remove` | Manage Server | More (or less) XP for certain roles, like boosters |
| `/levels ignore add/remove` | Manage Server | Channels, categories or roles that earn no XP |
| `/levels cards` | Manage Server | Server default card style, and whether members may customise theirs |
| `/levels xp give/take/set/reset`, `/levels reset-all` | Manage Server | Adjust XP by hand |

Uploaded backgrounds are resized and stored in MongoDB, so they keep working after Discord's attachment links expire. Rank cards use the bundled Open Sans font (in `assets/fonts`, Apache 2.0) so they look the same on every host.

Leveling doesn't need the Message Content intent. Reward roles are only given for roles below the bot's own role.

### Economy

Each server has its own economy with its own currency name or symbol.

| Command | What it does |
| --- | --- |
| `/balance`, `/baltop` | Wallet, bank and net worth; the richest members |
| `/deposit`, `/withdraw`, `/pay` | Move money. Money in the bank can't be robbed |
| `/daily`, `/weekly`, `/work` | Earn money. Daily rewards grow with a streak of consecutive days |
| `/rob user` | Steal part of someone's wallet, or pay a fine if caught |
| `/coinflip`, `/slots`, `/blackjack` | Casino games |
| `/shop view/buy`, `/inventory` | Buy roles and items |
| `/economy ...` | Admin: currency, rewards, robbery odds, bet limits, balances and the shop (Manage Server) |

Amounts can be typed as `500`, `1,500`, `2.5k`, `1m`, `half`, `all` or `25%`.

The odds are yours to set: the coinflip win chance, robbery success chance and percentages, the blackjack payout and bet limits are per server, and the slot machine's symbols and payouts are in `config.yml`. The bot calculates the slot machine's exact return rate and prints it on startup and in `/economy status`, so you can see the house edge before members do. Blackjack uses two decks; the dealer stands on all 17s.

Every balance change is a single conditional database update, so double-clicking a button or spamming a command can't spend money twice or go below zero. Blackjack stakes in an unfinished game are refunded if the bot shuts down.

### Music

Music plays through [Lavalink](https://lavalink.dev), a separate audio server; docker-compose starts one for you. `lavalink/application.yml` enables the YouTube plugin (Lavalink's built-in YouTube support no longer works reliably) and LavaSrc for Spotify links.

| Command | What it does |
| --- | --- |
| `/play query [next]` | Search or paste a YouTube, SoundCloud, Spotify, Twitch or direct audio link. Suggestions appear as you type |
| `/pause`, `/resume`, `/skip [to]`, `/previous`, `/stop`, `/leave` | Playback |
| `/seek time`, `/volume percent`, `/loop [mode]` | `1:30` style seeking, 0-150% volume, loop a song or the whole queue |
| `/queue view/remove/move/shuffle/clear` | Edit the queue |
| `/nowplaying` | The current song with control buttons |
| `/filter` | Bass boost, nightcore, vaporwave, 8D and karaoke |
| `/lyrics [song]` | Lyrics for the current song or any song, from [LRCLIB](https://lrclib.net) |
| `/247 enabled` | Stay in the voice channel around the clock (Manage Server) |

Each new song posts a now-playing message with buttons for previous, pause, skip, stop, loop, shuffle, volume and the queue; the old message is removed so the controls stay at the bottom of the chat.

**Who can control playback.** Without DJ roles, everyone in the voice channel can. With DJ roles (set in `/setup`), DJs and staff can do everything, members can skip and remove their own songs, and anyone alone with the bot can do anything.

**Restarts.** The queue is stored in MongoDB as it changes, and the playback position is saved every 15 seconds. After a restart of the bot or of Lavalink, the bot rejoins each voice channel and continues the song from where it was, with the same volume, loop mode and filters. Channels nobody is listening in are skipped, unless 24/7 mode is on.

**Spotify.** Spotify only shares song details, so the audio itself comes from YouTube. Create an app at the [Spotify developer dashboard](https://developer.spotify.com/dashboard), then put `SPOTIFY_ENABLED=true` and the client ID and secret in `.env` (docker-compose), or in `lavalink/application.yml` if you run Lavalink yourself.

Durations accept `30s`, `10m`, `2h`, `1d`, `1w` and combinations like `1d 12h`. A plain number means minutes.

`npm run commands:deploy` re-registers commands by hand. `npm run commands:clear` removes them all (useful after switching between `devGuildId` and global).

## Translating

Strings live in `locales/<code>.json`. To add a language:

1. Copy `locales/en.json` to, say, `locales/de.json`.
2. Set `_meta.name` to the language's name and `_meta.discord` to the matching [Discord locale codes](https://discord.com/developers/docs/reference#locales), e.g. `["de"]`.
3. Translate the values, keep the keys and the `{placeholders}`.

Missing keys fall back to the default language, so partial translations work. Command descriptions are translated too and show up in each user's Discord language. Servers pick their language in `/setup`.

## Customising

```
src/
  index.ts              startup and shutdown
  config/               config.yml and .env validation
  core/                 framework: router, contexts, settings cache, permissions, i18n, UI panels
  license/verify.ts     license check, the only file that talks to the license server
  modules/
    index.ts            list of modules, in load order
    core/               General module (help, ping, botinfo, setup)
  scripts/commands.ts   manual command registration
locales/                translations
tests/                  unit tests (npm test)
```

A module is a folder in `src/modules/` exporting `defineModule({...})` with its commands, components, events, setup wizard steps, config schema and per-server settings schema. Register it in `src/modules/index.ts`. The General module is a compact example of all of these.

A few conventions that keep things predictable:

- Command descriptions are locale keys (`.setDescription('core.ping.description')`), translated at registration.
- The router acknowledges every interaction for you. Set `defer: false` only when the handler shows a modal.
- Throw `new UserError('some.locale.key')` for anything the user did wrong. It becomes a friendly message. Any other error is logged with a reference code and the user gets a generic message with that code.
- Component custom IDs are `module:action:args`. The handler with the longest matching prefix runs.
- Per-server settings go through `bot.settings`, which caches in memory and writes through to MongoDB.

Set `ui.componentsV2: false` in `config.yml` to render every panel as a classic embed instead.

## Licensing

On startup the bot sends your `LICENSE_KEY` to the license server. If the server says the key is invalid, the bot stops with an explanation. If the license server can't be reached, the bot starts anyway and checks again later, so an outage on our side never takes your bot down.

## Logs

Logs go to the console and to `logs/bot.<date>.<n>.log`. Files rotate daily or when they reach `logging.maxSize`, and only the newest `logging.retainFiles` are kept. When you report a problem, include the error's reference code; it appears in the log next to the full error.

## Troubleshooting

**"Discord rejected the bot token"**
The token was reset or copied wrong. Reset it under **Bot** in the Developer Portal and paste it into `.env` again, without quotes or spaces.

**"Discord refused the requested gateway intents" / "Used disallowed intents"**
A module you enabled needs a privileged intent. Turn on the intents from step 1, or disable that module in `config.yml`.

**"Could not connect to MongoDB"**
Local: make sure the MongoDB service is running. Atlas: check the username and password in the URI and that your IP is allowed under Network Access. Special characters in the password must be URL-encoded (`@` becomes `%40`).

**Commands don't show up**
Global commands can take up to an hour to appear. Set `commands.devGuildId` for instant updates while testing, or restart Discord with Ctrl+R. If you switched from a dev guild to global, run `npm run commands:clear` and restart to remove duplicates.

**"The application did not respond"**
Shouldn't happen. If it does, check the log for an `interaction expired before response` line. It usually means the host is overloaded or the clock is far off.

**"has a role equal to or higher than mine"**
Discord only lets a bot act on members and roles below its own highest role. In Server Settings -> Roles, drag the bot's role above the roles of the people it should moderate.

**AutoMod does nothing**
Check that Message Content is turned on under Developer Portal -> Bot, that the filter is on in `/automod status`, and that you're testing with an account that isn't an admin or staff member. AutoMod needs Manage Messages in the channel to delete messages.

**The AI says it isn't set up**
Add at least one provider key to `.env` and restart. On startup the log lists the providers it found (`ai providers ready`).

**The AI answers with an error about the API key or the model**
Check the key in `.env`, and the model names in `config.yml` against your provider's current list. The log has the provider's exact error message.

**Opening a ticket fails with a permissions error**
The bot needs Manage Channels and Manage Roles to create ticket channels, and it must be allowed to see the category you picked.

**Modmail says "not set up to take messages"**
Modmail must be on in `/setup` for that server, and the user must be a member of it.

**Music says the audio server isn't available**
The bot can't reach Lavalink. Check that it's running (`docker compose logs lavalink`), and that `LAVALINK_HOST`, `LAVALINK_PORT` and `LAVALINK_PASSWORD` in `.env` match `lavalink/application.yml`. The bot logs `lavalink connected` once it works.

**Songs don't load or YouTube stops working**
YouTube changes often, and the YouTube plugin needs updates to keep up. Update the plugin versions at the top of `lavalink/application.yml` to the latest releases and restart Lavalink.

**Temporary bans don't expire**
The bot must be running and still have Ban Members. Expiries are checked every `expiryCheckSeconds`, so they can be up to that late.

**"Something went wrong" with a reference code**
Search the log for the code. The full error is right there.

**`npm install` fails on Windows**
Make sure you're on Node 20.19+ (`node -v`). No build tools are needed; if an old `node_modules` folder exists, delete it and run `npm install` again.

**License check failed**
Copy the key again from your BuiltByBit purchase page into `LICENSE_KEY`. If it still fails, open a ticket in the support server.
