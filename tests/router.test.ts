import { MessageFlags, PermissionFlagsBits, PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { Bot } from '../src/core/bot.js';
import { Cooldowns } from '../src/core/cooldowns.js';
import { UserError } from '../src/core/errors.js';
import type { GuildSettingsData } from '../src/core/guild-settings.js';
import { I18n } from '../src/core/i18n.js';
import { defineModule, type Command } from '../src/core/module.js';
import { fromRoot } from '../src/core/paths.js';
import { routeInteraction } from '../src/core/router.js';
import { Panel } from '../src/core/ui/panel.js';

const i18n = I18n.fromDirectory(fromRoot('locales'), 'en');

function fakeBot(command: Command, settings: Partial<GuildSettingsData> = {}) {
  const mod = defineModule({ name: 'sample', toggleable: true, commands: [command] });
  const data: GuildSettingsData = { guildId: 'g', locale: null, color: null, staffRoles: [], disabledModules: [], modules: {}, ...settings };
  const logger = pino({ level: 'silent' });
  const bot = {
    stopping: false,
    logger,
    i18n,
    cooldowns: new Cooldowns(),
    config: { bot: { locale: 'en', color: 0 }, commands: { cooldowns: {}, defaultCooldown: 3 } },
    commands: new Map([[command.data.name, { item: command, module: mod }]]),
    components: new Map(),
    settings: { peek: () => undefined, get: async () => data },
    isOwner: () => false,
    guildLocale: (s: GuildSettingsData | null) => s?.locale ?? 'en',
    panel: (color = 0) => new Panel(color, true),
  };
  return { bot: bot as unknown as Bot, logger };
}

function fakeInteraction(name: string, perms: bigint = PermissionFlagsBits.SendMessages, roles: string[] = []) {
  const i = {
    commandName: name,
    user: { id: 'u' },
    guildId: 'g',
    guild: { id: 'g' },
    member: { permissions: new PermissionsBitField(perms), roles: { cache: new Map(roles.map((r) => [r, {}])) } },
    memberPermissions: new PermissionsBitField(perms),
    appPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
    locale: 'en-US',
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    inCachedGuild: () => true,
    deferReply: vi.fn(async () => {
      i.deferred = true;
    }),
    reply: vi.fn(async () => {
      i.replied = true;
    }),
    editReply: vi.fn(async () => {
      i.replied = true;
    }),
    followUp: vi.fn(async () => undefined),
    deleteReply: vi.fn(async () => undefined),
  };
  return i;
}

const route = (bot: Bot, i: ReturnType<typeof fakeInteraction>) => routeInteraction(bot, i as never);

function command(run: Command['run'], extra: Partial<Command> = {}): Command {
  return { data: new SlashCommandBuilder().setName('sample').setDescription('x'), run, ...extra } as Command;
}

describe('routeInteraction', () => {
  it('defers publicly by default, then runs the command', async () => {
    const run = vi.fn(async () => undefined);
    const { bot } = fakeBot(command(run));
    const i = fakeInteraction('sample');
    await route(bot, i);
    expect(i.deferReply).toHaveBeenCalledWith({});
    expect(run).toHaveBeenCalledOnce();
  });

  it('refuses users without the required permissions before deferring', async () => {
    const run = vi.fn(async () => undefined);
    const { bot } = fakeBot(command(run, { permissions: { user: PermissionFlagsBits.BanMembers } }));
    const i = fakeInteraction('sample');
    await route(bot, i);
    expect(run).not.toHaveBeenCalled();
    expect(i.deferReply).not.toHaveBeenCalled();
    const reply = (i.reply.mock.calls[0] as unknown[])[0] as { flags: number[] };
    expect(reply.flags).toContain(MessageFlags.Ephemeral);
  });

  it('turns a crash after a public defer into an ephemeral error with a reference', async () => {
    const { bot, logger } = fakeBot(
      command(async () => {
        throw new Error('boom');
      }),
    );
    const error = vi.spyOn(logger, 'error');
    const i = fakeInteraction('sample');
    await route(bot, i);
    expect(i.deleteReply).toHaveBeenCalled();
    expect(i.followUp).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ ref: expect.any(String) }), 'interaction failed');
  });

  it('edits an ephemeral deferral with a UserError message and does not log it as a failure', async () => {
    const { bot, logger } = fakeBot(
      command(
        async () => {
          throw new UserError('errors.staffOnly');
        },
        { defer: 'ephemeral' },
      ),
    );
    const error = vi.spyOn(logger, 'error');
    const i = fakeInteraction('sample');
    await route(bot, i);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(i.editReply).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it('enforces cooldowns per user', async () => {
    const run = vi.fn(async () => undefined);
    const { bot } = fakeBot(command(run));
    await route(bot, fakeInteraction('sample'));
    const second = fakeInteraction('sample');
    await route(bot, second);
    expect(run).toHaveBeenCalledOnce();
    expect(second.reply).toHaveBeenCalledOnce();
  });

  it('blocks commands of modules turned off in the guild', async () => {
    const run = vi.fn(async () => undefined);
    const { bot } = fakeBot(command(run), { disabledModules: ['sample'] });
    await route(bot, fakeInteraction('sample'));
    expect(run).not.toHaveBeenCalled();
  });

  it('answers unknown commands instead of letting the interaction time out', async () => {
    const { bot } = fakeBot(command(async () => undefined));
    const i = fakeInteraction('gone');
    await route(bot, i);
    expect(i.reply).toHaveBeenCalledOnce();
  });

  it('lets staff roles stand in for Discord permissions when allowStaff is set', async () => {
    const run = vi.fn(async () => undefined);
    const { bot } = fakeBot(command(run, { permissions: { user: PermissionFlagsBits.BanMembers, allowStaff: true } }), { staffRoles: ['staff'] });
    await route(bot, fakeInteraction('sample', PermissionFlagsBits.SendMessages, ['staff']));
    expect(run).toHaveBeenCalledOnce();
  });

  it('still refuses members with neither the permission nor a staff role', async () => {
    const run = vi.fn(async () => undefined);
    const { bot } = fakeBot(command(run, { permissions: { user: PermissionFlagsBits.BanMembers, allowStaff: true } }), { staffRoles: ['staff'] });
    const i = fakeInteraction('sample');
    await route(bot, i);
    expect(run).not.toHaveBeenCalled();
    expect(i.followUp).toHaveBeenCalledOnce();
  });
});
