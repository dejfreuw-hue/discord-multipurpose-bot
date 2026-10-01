import {
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  time,
  TimestampStyles,
  userMention,
  type Guild,
  type Message,
  type TextChannel,
  type User,
} from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { UserError } from '../../core/errors.js';
import { nextSequence } from '../../core/models/counter.js';
import { GuildSettingsModel } from '../../core/models/guild-settings.js';
import { defineComponent } from '../../core/module.js';
import { touch, trackChannel, untrackChannel } from './activity.js';
import { overwritesFor, staffRolesFor } from './lifecycle.js';
import { TicketModel, type TicketDoc } from './models.js';
import { channelName } from './naming.js';
import { ticketSettings } from './settings.js';

/** Staff messages starting with this stay in the channel as internal notes. */
export const NOTE_PREFIX = '//';
const MAX_CHOICES = 25;
const PENDING_MS = 10 * 60_000;

// The first DM from someone with no open thread waits here while they pick a server.
const pending = new Map<string, { message: Message; at: number }>();

function dmText(bot: Bot, key: string, vars?: Record<string, string>): string {
  return bot.i18n.t(bot.config.bot.locale, key, vars);
}

/** Servers the user shares with the bot where modmail is on and they aren't blocked. */
async function modmailGuilds(bot: Bot, user: User): Promise<Guild[]> {
  const enabled = await GuildSettingsModel.find({ 'modules.tickets.modmail.enabled': true }, { guildId: 1 }).lean();
  const guilds: Guild[] = [];
  for (const { guildId } of enabled) {
    const guild = bot.client.guilds.cache.get(guildId);
    if (!guild || guilds.length >= MAX_CHOICES) continue;
    const core = await bot.settings.get(guildId);
    if (!bot.isEnabled('tickets', core)) continue;
    const settings = await bot.settings.module(guildId, ticketSettings);
    if (settings.modmail.blocked.includes(user.id)) continue;
    if (await guild.members.fetch(user.id).catch(() => null)) guilds.push(guild);
  }
  return guilds;
}

export async function openThread(bot: Bot, guild: Guild, user: User, openedBy: User): Promise<{ thread: TicketDoc; channel: TextChannel; created: boolean }> {
  const settings = await bot.settings.module(guild.id, ticketSettings);
  if (!settings.modmail.enabled) throw new UserError('tickets.modmail.disabled');
  if (settings.modmail.blocked.includes(user.id)) throw new UserError('tickets.modmail.isBlocked');

  const existing = await TicketModel.findOne({ guildId: guild.id, ownerId: user.id, kind: 'modmail', status: 'open' }).lean<TicketDoc>();
  const existingChannel = existing && (guild.channels.cache.get(existing.channelId) as TextChannel | undefined);
  if (existing && existingChannel) return { thread: existing, channel: existingChannel, created: false };

  const core = await bot.settings.get(guild.id);
  const t = (key: string, vars?: Record<string, string>) => bot.i18n.t(bot.guildLocale(core), key, vars);
  const ticketId = await nextSequence(`ticket:${guild.id}`);
  const staff = staffRolesFor(guild, core.staffRoles, settings);
  const parentId = [settings.modmail.categoryId, settings.categoryId].find(
    (id) => id && guild.channels.cache.get(id)?.type === ChannelType.GuildCategory,
  );
  const channel = await guild.channels.create({
    name: channelName('modmail-{user}', { number: ticketId, user: user.username, category: 'modmail' }),
    type: ChannelType.GuildText,
    parent: parentId ?? null,
    topic: `Modmail | ${user.tag} (${user.id})`,
    permissionOverwrites: overwritesFor(guild, null, staff),
    reason: `modmail with ${user.tag}`,
  });

  const thread = (
    await TicketModel.create({ guildId: guild.id, ticketId, kind: 'modmail', channelId: channel.id, ownerId: user.id, categoryLabel: 'Modmail' })
  ).toObject();
  trackChannel(channel.id, 'modmail');

  const member = await guild.members.fetch(user.id).catch(() => null);
  const info = bot
    .panel(core.color ?? bot.config.bot.color)
    .title(t('tickets.modmail.threadTitle', { user: user.tag }))
    .thumbnail(user.displayAvatarURL({ size: 128 }))
    .text(t('tickets.modmail.threadIntro', { prefix: NOTE_PREFIX }))
    .fields([
      { name: t('tickets.modmail.user'), value: `${userMention(user.id)}\n-# ${user.id}`, inline: true },
      { name: t('tickets.modmail.created'), value: time(user.createdAt, TimestampStyles.RelativeTime), inline: true },
      { name: t('tickets.modmail.joined'), value: member?.joinedAt ? time(member.joinedAt, TimestampStyles.RelativeTime) : '-', inline: true },
      ...(openedBy.id !== user.id ? [{ name: t('tickets.modmail.openedBy'), value: userMention(openedBy.id), inline: true }] : []),
    ])
    .row(new ButtonBuilder().setCustomId('ticket:close').setStyle(ButtonStyle.Danger).setLabel(t('tickets.control.close')));
  const message = await channel.send({ ...info.render(), allowedMentions: { parse: [] } });
  await TicketModel.updateOne({ channelId: channel.id }, { controlMessageId: message.id });
  return { thread, channel, created: true };
}

function attachmentsOf(message: Message): string[] {
  return [...message.attachments.values()].slice(0, 10).map((a) => a.url);
}

async function relayToStaff(bot: Bot, channel: TextChannel, message: Message): Promise<void> {
  const text = `**${message.author.tag}:** ${message.content}`.slice(0, 2000);
  await channel.send({ content: text, files: attachmentsOf(message), allowedMentions: { parse: [] } });
  await touch(bot, channel.id);
}

/** Handles a DM to the bot: relays it to an open thread, or asks which server to contact. */
export async function onDirectMessage(bot: Bot, message: Message): Promise<void> {
  const threads = await TicketModel.find({ kind: 'modmail', ownerId: message.author.id, status: 'open' }).sort({ lastActivityAt: -1 }).lean<TicketDoc[]>();
  for (const thread of threads) {
    const channel = bot.client.guilds.cache.get(thread.guildId)?.channels.cache.get(thread.channelId) as TextChannel | undefined;
    if (channel) {
      await relayToStaff(bot, channel, message);
      return;
    }
    // The channel was deleted by hand; the thread is over.
    await TicketModel.updateOne({ channelId: thread.channelId }, { status: 'closed', closedAt: new Date(), closeReason: 'channel deleted' });
    untrackChannel(thread.channelId);
  }

  const guilds = await modmailGuilds(bot, message.author);
  if (guilds.length === 0) {
    await message.reply(dmText(bot, 'tickets.modmail.noServers')).catch(() => undefined);
    return;
  }
  if (pending.size > 1000) for (const [id, p] of pending) if (Date.now() - p.at > PENDING_MS) pending.delete(id);
  pending.set(message.author.id, { message, at: Date.now() });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('modmail:pick')
    .setPlaceholder(dmText(bot, 'tickets.modmail.pickPlaceholder'))
    .addOptions(guilds.map((g) => new StringSelectMenuOptionBuilder().setValue(g.id).setLabel(g.name.slice(0, 100))));
  await message.reply(bot.panel().text(dmText(bot, 'tickets.modmail.pick')).row(menu).render()).catch(() => undefined);
}

/** Sends a staff message from a modmail channel to the user. Returns false when the DM failed. */
export async function relayToUser(bot: Bot, thread: TicketDoc, message: Message<true>): Promise<boolean> {
  const user = await bot.client.users.fetch(thread.ownerId).catch(() => null);
  if (!user) return false;
  const name = message.member?.displayName ?? message.author.displayName;
  try {
    await user.send({
      content: `**${name}** (${message.guild.name}): ${message.content}`.slice(0, 2000),
      files: attachmentsOf(message),
      allowedMentions: { parse: [] },
    });
    return true;
  } catch {
    return false;
  }
}

export const modmailPick = defineComponent({
  kind: 'select',
  id: 'modmail:pick',
  scope: 'anywhere',
  async run(ctx) {
    const guild = ctx.bot.client.guilds.cache.get(ctx.interaction.values[0] ?? '');
    const allowed = guild && (await modmailGuilds(ctx.bot, ctx.interaction.user)).some((g) => g.id === guild.id);
    if (!guild || !allowed) throw new UserError('tickets.modmail.unavailable');

    const { channel, created } = await openThread(ctx.bot, guild, ctx.interaction.user, ctx.interaction.user);
    const waiting = pending.get(ctx.interaction.user.id);
    pending.delete(ctx.interaction.user.id);
    if (waiting && Date.now() - waiting.at < PENDING_MS) await relayToStaff(ctx.bot, channel, waiting.message);

    const key = created ? 'tickets.modmail.connected' : 'tickets.modmail.alreadyOpen';
    await ctx.update(ctx.bot.panel().text(dmText(ctx.bot, key, { guild: guild.name })));
  },
});
