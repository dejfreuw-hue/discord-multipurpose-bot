import { SlashCommandBuilder, time, TimestampStyles, type AutocompleteInteraction } from 'discord.js';
import { Types } from 'mongoose';
import { z } from 'zod';
import { formatDuration, parseDuration } from '../../core/duration.js';
import { UserError } from '../../core/errors.js';
import { nextSequence } from '../../core/models/counter.js';
import { defineCommand, defineComponent, defineModule } from '../../core/module.js';
import { startReminderClock } from './deliver.js';
import { ReminderModel, type ReminderDoc } from './model.js';

const remindersConfig = z.object({
  maxPerUser: z.number().int().min(1).max(500).default(25),
  maxDays: z.number().int().min(1).max(3650).default(365),
  /** Shortest allowed repeat interval, in minutes. */
  minRepeatMinutes: z.number().int().min(1).default(60),
});

const MIN_DELAY_MS = 60_000;

async function reminderAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const list = await ReminderModel.find({ userId: interaction.user.id, done: false }).sort({ dueAt: 1 }).limit(25).lean<ReminderDoc[]>();
  await interaction.respond(list.map((r) => ({ name: `#${r.number} ${r.text}`.slice(0, 100), value: r.number })));
}

const remind = defineCommand({
  scope: 'anywhere',
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('reminders.command.description')
    .addSubcommand((s) =>
      s
        .setName('me')
        .setDescription('reminders.command.me')
        .addStringOption((o) => o.setName('in').setDescription('reminders.command.options.in').setRequired(true).setMaxLength(50))
        .addStringOption((o) => o.setName('text').setDescription('reminders.command.options.text').setRequired(true).setMaxLength(1000))
        .addStringOption((o) => o.setName('repeat').setDescription('reminders.command.options.repeat').setMaxLength(50))
        .addBooleanOption((o) => o.setName('dm').setDescription('reminders.command.options.dm')),
    )
    .addSubcommand((s) => s.setName('list').setDescription('reminders.command.list'))
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('reminders.command.delete')
        .addIntegerOption((o) => o.setName('number').setDescription('reminders.command.options.number').setRequired(true).setAutocomplete(true)),
    ),
  defer: 'ephemeral',
  autocomplete: reminderAutocomplete,
  async run(ctx) {
    const { options } = ctx.interaction;
    const userId = ctx.interaction.user.id;
    const sub = options.getSubcommand();
    const config = ctx.bot.moduleConfig({ name: 'reminders', config: remindersConfig });

    if (sub === 'list') {
      const list = await ReminderModel.find({ userId, done: false }).sort({ dueAt: 1 }).limit(25).lean<ReminderDoc[]>();
      const lines = list.map(
        (r) =>
          `**#${r.number}** ${time(r.dueAt, TimestampStyles.RelativeTime)}${r.repeatMs ? ` (${ctx.t('reminders.every', { interval: formatDuration(r.repeatMs) })})` : ''}\n${r.text.slice(0, 200)}`,
      );
      await ctx.respond(ctx.panel().title(ctx.t('reminders.listTitle')).text(lines.join('\n\n') || ctx.t('reminders.empty')));
      return;
    }

    if (sub === 'delete') {
      const number = options.getInteger('number', true);
      const removed = await ReminderModel.deleteOne({ userId, number, done: false });
      if (!removed.deletedCount) throw new UserError('reminders.errors.notFound', { number });
      await ctx.respond(ctx.successPanel(ctx.t('reminders.deleted', { number })));
      return;
    }

    const delay = parseDuration(options.getString('in', true));
    if (delay === null) throw new UserError('reminders.errors.duration', { value: options.getString('in', true) });
    if (delay < MIN_DELAY_MS || delay > config.maxDays * 86_400_000) throw new UserError('reminders.errors.range', { days: config.maxDays });
    const rawRepeat = options.getString('repeat');
    const repeatMs = rawRepeat ? parseDuration(rawRepeat) : null;
    if (rawRepeat && repeatMs === null) throw new UserError('reminders.errors.duration', { value: rawRepeat });
    if (repeatMs !== null && repeatMs < config.minRepeatMinutes * 60_000) {
      throw new UserError('reminders.errors.repeatTooShort', { interval: formatDuration(config.minRepeatMinutes * 60_000) });
    }
    if ((await ReminderModel.countDocuments({ userId, done: false })) >= config.maxPerUser) {
      throw new UserError('reminders.errors.limit', { count: config.maxPerUser });
    }

    // Only post in the channel when the bot is actually in this server; user-installed use gets DMs.
    const inChannel = ctx.guild && !options.getBoolean('dm') && ctx.interaction.channel?.isSendable();
    const dueAt = new Date(Date.now() + delay);
    const number = await nextSequence(`reminder:${userId}`);
    await ReminderModel.create({
      number,
      userId,
      guildId: inChannel ? ctx.guild!.id : null,
      channelId: inChannel ? ctx.interaction.channelId : null,
      text: options.getString('text', true),
      locale: ctx.locale,
      dueAt,
      repeatMs,
    });
    const where = ctx.t(inChannel ? 'reminders.whereChannel' : 'reminders.whereDm');
    await ctx.respond(
      ctx.successPanel(
        ctx.t(repeatMs ? 'reminders.savedRepeat' : 'reminders.saved', {
          number,
          time: time(dueAt, TimestampStyles.LongDateTime),
          relative: time(dueAt, TimestampStyles.RelativeTime),
          interval: repeatMs ? formatDuration(repeatMs) : '',
          where,
        }),
      ),
    );
  },
});

const snooze = defineComponent({
  kind: 'button',
  id: 'reminders:snooze',
  scope: 'anywhere',
  defer: 'ephemeral',
  async run(ctx, [id, minutes]) {
    if (!id || !Types.ObjectId.isValid(id) || !['10', '60'].includes(minutes ?? '')) throw new UserError('errors.expired');
    const dueAt = new Date(Date.now() + Number(minutes) * 60_000);
    // Only the owner can snooze, and only once: the reminder must still be the delivered one.
    const snoozed = await ReminderModel.findOneAndUpdate(
      { _id: id, userId: ctx.interaction.user.id, done: true },
      { done: false, expireAt: null, dueAt },
      { lean: true },
    );
    if (!snoozed) throw new UserError('reminders.errors.snooze');
    await ctx.respond(ctx.successPanel(ctx.t('reminders.snoozed', { time: time(dueAt, TimestampStyles.RelativeTime) })));
  },
});

let stopClock: (() => void) | undefined;

export default defineModule({
  name: 'reminders',
  toggleable: true,
  config: remindersConfig,
  commands: [remind],
  components: [snooze],
  start(bot) {
    stopClock = startReminderClock(bot);
  },
  stop() {
    stopClock?.();
  },
});
