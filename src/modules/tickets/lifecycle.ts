import {
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  channelMention,
  OverwriteType,
  PermissionFlagsBits,
  roleMention,
  time,
  TimestampStyles,
  userMention,
  type Guild,
  type GuildMember,
  type OverwriteResolvable,
  type TextChannel,
  type User,
} from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { UserError } from '../../core/errors.js';
import { nextSequence } from '../../core/models/counter.js';
import { isStaff } from '../../core/permissions.js';
import type { Panel } from '../../core/ui/panel.js';
import { trackChannel, untrackChannel } from './activity.js';
import { collectMessages } from './collect.js';
import { PanelModel, TicketModel, type TicketCategory, type TicketDoc } from './models.js';
import { channelName } from './naming.js';
import { ticketsConfig, ticketSettings, type TicketSettings } from './settings.js';
import { renderTranscript } from './transcript.js';

const MEMBER_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];
const STAFF_ALLOW = [...MEMBER_ALLOW, PermissionFlagsBits.ManageMessages];
const BOT_ALLOW = [...STAFF_ALLOW, PermissionFlagsBits.ManageChannels];
const DELETE_DELAY_MS = 5000;

const opening = new Set<string>();
const closing = new Set<string>();

type T = (key: string, vars?: Record<string, string | number>) => string;

async function translator(bot: Bot, guildId: string): Promise<{ t: T; color: number }> {
  const core = await bot.settings.get(guildId);
  const locale = bot.guildLocale(core);
  return { t: (key, vars) => bot.i18n.t(locale, key, vars), color: core.color ?? bot.config.bot.color };
}

/** Roles that get access to a ticket channel: server staff, ticket support roles and the category's roles. */
export function staffRolesFor(guild: Guild, coreStaff: readonly string[], settings: TicketSettings, category?: TicketCategory | null): string[] {
  const ids = new Set([...coreStaff, ...settings.supportRoles, ...(category?.staffRoles ?? [])]);
  return [...ids].filter((id) => guild.roles.cache.has(id));
}

/** Staff for a ticket: admins, the server's staff roles, ticket support roles and the category's roles. */
export async function isTicketStaff(bot: Bot, member: GuildMember, ticket?: TicketDoc | null): Promise<boolean> {
  if (member.permissions.has(PermissionFlagsBits.Administrator) || bot.isOwner(member.id)) return true;
  const core = await bot.settings.get(member.guild.id);
  if (isStaff(member, core.staffRoles)) return true;
  const settings = await bot.settings.module(member.guild.id, ticketSettings);
  const category = ticket?.categoryId ? await categoryOf(ticket) : null;
  return staffRolesFor(member.guild, core.staffRoles, settings, category).some((id) => member.roles.cache.has(id));
}

async function categoryOf(ticket: TicketDoc): Promise<TicketCategory | null> {
  if (ticket.panelId === null) return null;
  const panel = await PanelModel.findOne({ guildId: ticket.guildId, panelId: ticket.panelId }).lean();
  return panel?.categories.find((c) => c.id === ticket.categoryId) ?? null;
}

function resolveParent(guild: Guild, ...ids: (string | null)[]): string | null {
  for (const id of ids) {
    if (id && guild.channels.cache.get(id)?.type === ChannelType.GuildCategory) return id;
  }
  return null;
}

export function overwritesFor(guild: Guild, ownerId: string | null, staffRoles: string[]): OverwriteResolvable[] {
  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel], type: OverwriteType.Role },
    { id: guild.client.user.id, allow: BOT_ALLOW, type: OverwriteType.Member },
    ...staffRoles.map((id) => ({ id, allow: STAFF_ALLOW, type: OverwriteType.Role })),
  ];
  if (ownerId) overwrites.push({ id: ownerId, allow: MEMBER_ALLOW, type: OverwriteType.Member });
  return overwrites;
}

export async function controlPanel(bot: Bot, ticket: TicketDoc, welcome: string | null): Promise<Panel> {
  const { t, color } = await translator(bot, ticket.guildId);
  const number = String(ticket.ticketId).padStart(4, '0');
  const panel = bot
    .panel(color)
    .title(t('tickets.control.title', { number, category: ticket.categoryLabel ?? t('tickets.control.general') }))
    .text(`${userMention(ticket.ownerId)} ${welcome ?? t('tickets.control.welcome')}`)
    .fields(ticket.answers.map((a) => ({ name: a.question, value: a.answer.slice(0, 1000) || '-' })));
  if (ticket.claimedBy) panel.text(`-# ${t('tickets.control.claimedBy', { user: userMention(ticket.claimedBy) })}`);
  return panel.row(
    new ButtonBuilder()
      .setCustomId('ticket:claim')
      .setStyle(ticket.claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setLabel(t(ticket.claimedBy ? 'tickets.control.unclaim' : 'tickets.control.claim')),
    new ButtonBuilder()
      .setCustomId('ticket:lock')
      .setStyle(ButtonStyle.Secondary)
      .setLabel(t(ticket.locked ? 'tickets.control.unlock' : 'tickets.control.lock')),
    new ButtonBuilder().setCustomId('ticket:close').setStyle(ButtonStyle.Danger).setLabel(t('tickets.control.close')),
  );
}

async function refreshControl(bot: Bot, channel: TextChannel, ticket: TicketDoc): Promise<void> {
  if (!ticket.controlMessageId) return;
  const message = await channel.messages.fetch(ticket.controlMessageId).catch(() => null);
  const category = await categoryOf(ticket);
  await message?.edit((await controlPanel(bot, ticket, category?.welcome ?? null)).render()).catch(() => undefined);
}

async function assertBotCanManage(guild: Guild): Promise<void> {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  if (!me.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) {
    throw new UserError('errors.botPermissions', { permissions: 'Manage Channels, Manage Roles' });
  }
}

export async function openTicket(
  bot: Bot,
  member: GuildMember,
  source: { panelId: number; category: TicketCategory },
  answers: { question: string; answer: string }[],
): Promise<TextChannel> {
  const { guild } = member;
  const key = `${guild.id}:${member.id}`;
  // A double click would otherwise open two tickets before the first one is saved.
  if (opening.has(key)) throw new UserError('tickets.errors.busy');
  opening.add(key);
  try {
    await assertBotCanManage(guild);
    const settings = await bot.settings.module(guild.id, ticketSettings);
    const open = await TicketModel.find({ guildId: guild.id, ownerId: member.id, status: 'open', kind: 'ticket' }).lean();
    if (open.length >= settings.maxOpenPerUser) {
      throw new UserError('tickets.errors.tooMany', { channels: open.map((t) => channelMention(t.channelId)).join(', ') });
    }

    const { category } = source;
    const ticketId = await nextSequence(`ticket:${guild.id}`);
    const staff = staffRolesFor(guild, (await bot.settings.get(guild.id)).staffRoles, settings, category);
    const channel = await guild.channels.create({
      name: channelName(settings.namePattern, { number: ticketId, user: member.user.username, category: category.label }),
      type: ChannelType.GuildText,
      parent: resolveParent(guild, category.parentId, settings.categoryId),
      topic: `Ticket #${ticketId} | ${member.user.tag} (${member.id})`,
      permissionOverwrites: overwritesFor(guild, member.id, staff),
      reason: `ticket opened by ${member.user.tag}`,
    });

    const ticket = (
      await TicketModel.create({
        guildId: guild.id,
        ticketId,
        kind: 'ticket',
        channelId: channel.id,
        ownerId: member.id,
        panelId: source.panelId,
        categoryId: category.id,
        categoryLabel: category.label,
        answers,
      })
    ).toObject();
    trackChannel(channel.id, 'ticket');

    const panel = await controlPanel(bot, ticket, category.welcome);
    if (staff.length > 0) panel.text(`-# ${staff.map(roleMention).join(' ')}`);
    const message = await channel.send({ ...panel.render(), allowedMentions: { users: [member.id], roles: staff } });
    await TicketModel.updateOne({ channelId: channel.id }, { controlMessageId: message.id });
    return channel;
  } finally {
    opening.delete(key);
  }
}

export async function findTicket(channelId: string): Promise<TicketDoc | null> {
  return TicketModel.findOne({ channelId, status: 'open' }).lean<TicketDoc>();
}

export async function claimTicket(bot: Bot, channel: TextChannel, ticket: TicketDoc, staff: GuildMember): Promise<'claimed' | 'unclaimed'> {
  const { t } = await translator(bot, channel.guildId);
  if (ticket.claimedBy && ticket.claimedBy !== staff.id) {
    throw new UserError('tickets.errors.claimedByOther', { user: userMention(ticket.claimedBy) });
  }
  const claimedBy = ticket.claimedBy ? null : staff.id;
  await TicketModel.updateOne({ channelId: channel.id }, { claimedBy });
  await refreshControl(bot, channel, { ...ticket, claimedBy });
  const text = claimedBy ? t('tickets.claim.claimed', { user: userMention(staff.id) }) : t('tickets.claim.unclaimed', { user: userMention(staff.id) });
  await channel.send({ ...bot.panel().text(text).render(), allowedMentions: { parse: [] } });
  return claimedBy ? 'claimed' : 'unclaimed';
}

export async function setLocked(bot: Bot, channel: TextChannel, ticket: TicketDoc, locked: boolean): Promise<void> {
  const { t } = await translator(bot, channel.guildId);
  if (ticket.locked === locked) throw new UserError(locked ? 'tickets.errors.alreadyLocked' : 'tickets.errors.notLocked');
  await channel.permissionOverwrites.edit(ticket.ownerId, { SendMessages: !locked }, { reason: locked ? 'ticket locked' : 'ticket unlocked' });
  await TicketModel.updateOne({ channelId: channel.id }, { locked });
  await refreshControl(bot, channel, { ...ticket, locked });
  await channel.send(bot.panel().text(t(locked ? 'tickets.lock.locked' : 'tickets.lock.unlocked')).render());
}

export async function setParticipant(channel: TextChannel, ticket: TicketDoc, user: User, add: boolean): Promise<void> {
  if (user.id === ticket.ownerId) throw new UserError('tickets.errors.owner');
  if (add) {
    await channel.permissionOverwrites.edit(
      user.id,
      { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true },
      { reason: 'added to ticket' },
    );
  } else {
    await channel.permissionOverwrites.delete(user.id, 'removed from ticket');
  }
}

/**
 * Closes a ticket or modmail thread: saves an HTML transcript to the transcript channel, DMs
 * it to the owner if enabled, marks the ticket closed and deletes the channel shortly after.
 */
export async function closeTicket(bot: Bot, channel: TextChannel, ticket: TicketDoc, closer: User, reason: string | null): Promise<void> {
  if (closing.has(channel.id)) throw new UserError('tickets.errors.closing');
  closing.add(channel.id);
  try {
    const { guild } = channel;
    const { t, color } = await translator(bot, guild.id);
    const settings = await bot.settings.module(guild.id, ticketSettings);
    const config = bot.moduleConfig({ name: 'tickets', config: ticketsConfig });
    const number = String(ticket.ticketId).padStart(4, '0');
    const label = ticket.kind === 'modmail' ? t('tickets.transcript.modmail', { number }) : t('tickets.transcript.ticket', { number });
    const owner = await bot.client.users.fetch(ticket.ownerId).catch(() => null);

    await channel.send(bot.panel(color).text(t('tickets.close.closing', { user: userMention(closer.id) })).render()).catch(() => undefined);

    const html = renderTranscript(
      {
        title: label,
        guildName: guild.name,
        guildIcon: guild.iconURL({ size: 128 }),
        channelName: channel.name,
        details: [
          [t('tickets.transcript.owner'), owner ? `${owner.tag} (${owner.id})` : ticket.ownerId],
          [t('tickets.transcript.category'), ticket.categoryLabel ?? '-'],
          [t('tickets.transcript.opened'), ticket.createdAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'],
          [t('tickets.transcript.closedBy'), closer.tag],
          [t('tickets.transcript.reason'), reason ?? '-'],
        ],
        generatedAt: new Date(),
      },
      await collectMessages(channel, config.transcriptLimit),
    );
    const fileName = `${ticket.kind}-${number}.html`;
    const file = () => new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: fileName });

    const summary = bot
      .panel(color)
      .title(label)
      .fields([
        { name: t('tickets.transcript.owner'), value: userMention(ticket.ownerId), inline: true },
        { name: t('tickets.transcript.closedBy'), value: userMention(closer.id), inline: true },
        { name: t('tickets.transcript.opened'), value: time(ticket.createdAt, TimestampStyles.RelativeTime), inline: true },
        ...(ticket.claimedBy ? [{ name: t('tickets.transcript.claimedBy'), value: userMention(ticket.claimedBy), inline: true }] : []),
        { name: t('tickets.transcript.reason'), value: reason ?? '-' },
      ]);

    let transcriptUrl: string | null = null;
    const logChannel = settings.transcriptChannelId ? guild.channels.cache.get(settings.transcriptChannelId) : null;
    if (logChannel?.isSendable()) {
      const sent = await logChannel.send({ ...summary.render(), files: [file()], allowedMentions: { parse: [] } }).catch((err) => {
        bot.logger.warn({ err, guild: guild.id }, 'could not post transcript');
        return null;
      });
      transcriptUrl = sent?.attachments.first()?.url ?? null;
    }

    if (owner && (settings.dmTranscript || ticket.kind === 'modmail')) {
      const notice = bot.panel(color).title(label).text(t('tickets.close.dm', { guild: guild.name }), reason ? t('tickets.close.dmReason', { reason }) : null);
      await owner.send({ ...notice.render(), ...(settings.dmTranscript ? { files: [file()] } : {}) }).catch(() => undefined);
    }

    await TicketModel.updateOne(
      { channelId: channel.id },
      { status: 'closed', closedAt: new Date(), closedBy: closer.id, closeReason: reason, transcriptUrl },
    );
    untrackChannel(channel.id);
    setTimeout(() => void channel.delete(`ticket closed by ${closer.tag}`).catch(() => undefined), DELETE_DELAY_MS).unref();
  } finally {
    // Keep the guard for a moment so a second close click during the delete delay is refused.
    setTimeout(() => closing.delete(channel.id), DELETE_DELAY_MS * 2).unref();
  }
}
