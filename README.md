# Reuw

An all-in-one Discord bot by ReuwTheDev. You host it yourself, so your data and API keys stay yours.

Included so far: the core framework, **General** (help, bot info, ping, setup wizard) **Moderation** (bans, kicks, timeouts, warnings, purge, slowmode, channel locks, cases, temporary roles and a mod log) and **AutoMod** (invite, link, bad word, spam, mass mention, caps and ghost ping filters with decaying strikes and escalating punishments).

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
   | Server Members | Moderation, welcome messages, auto-roles, leveling, verification |
   | Message Content | AutoMod, AI chat, leveling, counting, sticky messages |
   | Presence | Not needed |

   General and Moderation need none of them. AutoMod needs Message Content. The bot only requests intents for modules that are enabled, so you can leave the rest off.
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
4. Run `java -jar Lavalink.jar`.

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

**Temporary bans don't expire**
The bot must be running and still have Ban Members. Expiries are checked every `expiryCheckSeconds`, so they can be up to that late.

**"Something went wrong" with a reference code**
Search the log for the code. The full error is right there.

**`npm install` fails on Windows**
Make sure you're on Node 20.19+ (`node -v`). No build tools are needed; if an old `node_modules` folder exists, delete it and run `npm install` again.

**License check failed**
Copy the key again from your BuiltByBit purchase page into `LICENSE_KEY`. If it still fails, open a ticket in the support server.
