import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, time, userMention, type AutocompleteInteraction } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand } from '../../../core/module.js';
import { assertAssignableRole } from '../../../core/permissions.js';
import { daysUntil, isLeapYear, isValidBirthday, isValidTimeZone, localTime } from './dates.js';
import { BirthdayModel, type BirthdayDoc } from './model.js';
import { birthdaySettings } from './settings.js';

const zones = Intl.supportedValuesOf('timeZone');

async function timeZoneAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const typed = interaction.options.getFocused().toLowerCase().replace(/\s+/g, '_');
  const matches = (typed ? zones.filter((z) => z.toLowerCase().includes(typed)) : ['UTC', ...zones]).slice(0, 25);
  await interaction.respond(matches.map((z) => ({ name: z, value: z })));
}

function formatDate(doc: Pick<BirthdayDoc, 'month' | 'day' | 'year'>, locale: string): string {
  const date = new Date(Date.UTC(doc.year ?? 2000, doc.month - 1, doc.day));
  const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', timeZone: 'UTC', ...(doc.year ? { year: 'numeric' } : {}) };
  return date.toLocaleDateString(locale, options);
}

export const birthday = defineCommand({
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('birthdays.command.description')
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('birthdays.command.set')
        .addIntegerOption((o) => o.setName('month').setDescription('birthdays.command.options.month').setRequired(true).setMinValue(1).setMaxValue(12))
        .addIntegerOption((o) => o.setName('day').setDescription('birthdays.command.options.day').setRequired(true).setMinValue(1).setMaxValue(31))
        .addIntegerOption((o) => o.setName('year').setDescription('birthdays.command.options.year').setMinValue(1900))
        .addStringOption((o) => o.setName('timezone').setDescription('birthdays.command.options.timezone').setAutocomplete(true)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('birthdays.command.remove'))
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('birthdays.command.view')
        .addUserOption((o) => o.setName('user').setDescription('birthdays.command.options.user')),
    )
    .addSubcommand((s) => s.setName('upcoming').setDescription('birthdays.command.upcoming')),
  defer: 'ephemeral',
  autocomplete: timeZoneAutocomplete,
  async run(ctx) {
    const { options } = ctx.interaction;
    const sub = options.getSubcommand();
    const settings = await ctx.bot.settings.module(ctx.guild.id, birthdaySettings);
    const locale = ctx.interaction.locale;

    if (sub === 'set') {
      const month = options.getInteger('month', true);
      const day = options.getInteger('day', true);
      const year = options.getInteger('year');
      const timeZone = options.getString('timezone');
      if (!isValidBirthday(month, day)) throw new UserError('birthdays.errors.date');
      if (year && (year > new Date().getUTCFullYear() || (month === 2 && day === 29 && !isLeapYear(year)))) throw new UserError('birthdays.errors.date');
      if (timeZone && !isValidTimeZone(timeZone)) throw new UserError('birthdays.errors.timeZone');

      await BirthdayModel.updateOne({ guildId: ctx.guild.id, userId: ctx.member.id }, { $set: { month, day, year, timeZone } }, { upsert: true });
      await ctx.respond(ctx.successPanel(ctx.t('birthdays.saved', { date: formatDate({ month, day, year }, locale) })));
      return;
    }

    if (sub === 'remove') {
      const removed = await BirthdayModel.deleteOne({ guildId: ctx.guild.id, userId: ctx.member.id });
      if (!removed.deletedCount) throw new UserError('birthdays.errors.notSet');
      await ctx.respond(ctx.successPanel(ctx.t('birthdays.removed')));
      return;
    }

    if (sub === 'view') {
      const user = options.getUser('user') ?? ctx.interaction.user;
      const doc = await BirthdayModel.findOne({ guildId: ctx.guild.id, userId: user.id }).lean<BirthdayDoc>();
      if (!doc) throw new UserError('birthdays.errors.unknown', { user: userMention(user.id) });
      // Only the member themselves sees their birth year.
      const shown = user.id === ctx.member.id ? doc : { ...doc, year: null };
      const days = daysUntil(doc.month, doc.day, localTime(new Date(), doc.timeZone ?? settings.timeZone));
      await ctx.respond(
        ctx.panel().text(
          ctx.t('birthdays.view', { user: userMention(user.id), date: formatDate(shown, locale) }),
          days === 0 ? ctx.t('birthdays.today') : ctx.t('birthdays.inDays', { count: days }),
        ),
      );
      return;
    }

    const today = localTime(new Date(), settings.timeZone);
    const docs = await BirthdayModel.find({ guildId: ctx.guild.id }).limit(5000).lean<BirthdayDoc[]>();
    const upcoming = docs
      .map((d) => ({ ...d, days: daysUntil(d.month, d.day, today) }))
      .sort((a, b) => a.days - b.days)
      .slice(0, 10);
    const now = Date.now();
    const lines = upcoming.map(
      (d) => `${userMention(d.userId)}: ${formatDate({ ...d, year: null }, locale)} (${time(new Date(now + d.days * 86_400_000), 'R')})`,
    );
    await ctx.respond(ctx.panel().title(ctx.t('birthdays.upcomingTitle')).text(lines.join('\n') || ctx.t('birthdays.none')));
  },
});

export const birthdays = defineCommand({
  data: new SlashCommandBuilder()
    .setName('birthdays')
    .setDescription('birthdays.admin.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('settings')
        .setDescription('birthdays.admin.settings')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('birthdays.admin.options.channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addRoleOption((o) => o.setName('role').setDescription('birthdays.admin.options.role'))
        .addStringOption((o) => o.setName('timezone').setDescription('birthdays.admin.options.timezone').setAutocomplete(true))
        .addStringOption((o) => o.setName('message').setDescription('birthdays.admin.options.message').setMaxLength(1000))
        .addBooleanOption((o) => o.setName('reset').setDescription('birthdays.admin.options.reset')),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('birthdays.admin.remove')
        .addUserOption((o) => o.setName('user').setDescription('birthdays.admin.options.user').setRequired(true)),
    ),
  defer: 'ephemeral',
  permissions: { user: PermissionFlagsBits.ManageGuild, allowStaff: true },
  autocomplete: timeZoneAutocomplete,
  async run(ctx) {
    const { options } = ctx.interaction;

    if (options.getSubcommand() === 'remove') {
      const user = options.getUser('user', true);
      const removed = await BirthdayModel.deleteOne({ guildId: ctx.guild.id, userId: user.id });
      if (!removed.deletedCount) throw new UserError('birthdays.errors.unknown', { user: userMention(user.id) });
      await ctx.respond(ctx.successPanel(ctx.t('birthdays.admin.removed', { user: userMention(user.id) })));
      return;
    }

    const current = await ctx.bot.settings.module(ctx.guild.id, birthdaySettings);
    if (options.getBoolean('reset')) {
      await ctx.bot.settings.updateModule(ctx.guild.id, birthdaySettings, { channelId: null, roleId: null, message: null, timeZone: 'UTC' });
      await ctx.respond(ctx.successPanel(ctx.t('birthdays.admin.reset')));
      return;
    }
    const role = options.getRole('role');
    if (role) {
      const resolved = ctx.guild.roles.cache.get(role.id);
      if (!resolved) throw new UserError('errors.expired');
      await assertAssignableRole(resolved, ctx.member);
    }
    const timeZone = options.getString('timezone');
    if (timeZone && !isValidTimeZone(timeZone)) throw new UserError('birthdays.errors.timeZone');

    const s = await ctx.bot.settings.updateModule(ctx.guild.id, birthdaySettings, {
      channelId: options.getChannel('channel')?.id ?? current.channelId,
      roleId: role?.id ?? current.roleId,
      timeZone: timeZone ?? current.timeZone,
      message: options.getString('message') ?? current.message,
    });
    await ctx.respond(
      ctx.successPanel(
        ctx.t('birthdays.admin.saved', {
          channel: s.channelId ? `<#${s.channelId}>` : ctx.t('common.none'),
          role: s.roleId ? `<@&${s.roleId}>` : ctx.t('common.none'),
          timeZone: s.timeZone,
        }),
      ),
    );
  },
});
