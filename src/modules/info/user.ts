import {
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  roleMention,
  time,
  TimestampStyles,
  UserFlags,
  type GuildMember,
  type User,
} from 'discord.js';
import type { InteractionContext } from '../../core/context.js';
import type { Panel } from '../../core/ui/panel.js';

/** Profile badges worth showing; the rest are internal or retired. */
const BADGES = [
  'Staff',
  'Partner',
  'CertifiedModerator',
  'Hypesquad',
  'HypeSquadOnlineHouse1',
  'HypeSquadOnlineHouse2',
  'HypeSquadOnlineHouse3',
  'BugHunterLevel1',
  'BugHunterLevel2',
  'ActiveDeveloper',
  'VerifiedDeveloper',
  'PremiumEarlySupporter',
  'VerifiedBot',
] as const satisfies readonly (keyof typeof UserFlags)[];

/** Permissions that tell you what someone can do as staff, in order of importance. */
const KEY_PERMISSIONS = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'BanMembers',
  'KickMembers',
  'ModerateMembers',
  'ManageMessages',
  'MentionEveryone',
] as const satisfies readonly (keyof typeof PermissionFlagsBits)[];

const MAX_ROLES = 20;

function stamp(date: Date): string {
  return `${time(date, TimestampStyles.LongDate)} (${time(date, TimestampStyles.RelativeTime)})`;
}

function memberFields(ctx: InteractionContext, member: GuildMember) {
  const roles = member.roles.cache
    .filter((r) => r.id !== member.guild.id)
    .sort((a, b) => b.position - a.position)
    .map((r) => roleMention(r.id));
  const shown = roles.slice(0, MAX_ROLES).join(' ') + (roles.length > MAX_ROLES ? ` ${ctx.t('info.user.more', { count: roles.length - MAX_ROLES })}` : '');
  const permissions = member.permissions.has(PermissionFlagsBits.Administrator)
    ? [ctx.t('info.permissions.Administrator')]
    : KEY_PERMISSIONS.filter((p) => member.permissions.has(PermissionFlagsBits[p])).map((p) => ctx.t(`info.permissions.${p}`));

  const fields = [
    { name: ctx.t('info.user.joined'), value: member.joinedAt ? stamp(member.joinedAt) : ctx.t('common.unavailable'), inline: true },
    { name: ctx.t('info.user.roles', { count: roles.length }), value: shown || ctx.t('common.none') },
  ];
  if (member.premiumSince) fields.push({ name: ctx.t('info.user.boosting'), value: stamp(member.premiumSince), inline: true });
  if (member.communicationDisabledUntil && member.communicationDisabledUntil > new Date()) {
    fields.push({ name: ctx.t('info.user.timedOut'), value: time(member.communicationDisabledUntil, TimestampStyles.RelativeTime), inline: true });
  }
  if (permissions.length) fields.push({ name: ctx.t('info.user.permissions'), value: permissions.join(', ') });
  return fields;
}

/**
 * Profile panel for a user. Server details (roles, join date) only show when the bot is in that
 * server; in DMs or servers where the app is only user-installed, Discord doesn't give us them.
 */
export async function userPanel(ctx: InteractionContext, target: User, member: GuildMember | null): Promise<Panel> {
  // Banners and accent colours only come with a forced fetch.
  const user = await target.fetch(true).catch(() => target);
  const badges = BADGES.filter((b) => user.flags?.has(UserFlags[b])).map((b) => ctx.t(`info.badges.${b}`));

  const lines = [
    `**${member?.displayName ?? user.displayName}** (${user.username}${user.bot ? `, ${ctx.t('info.user.bot')}` : ''})`,
    `-# ${user.id}`,
  ];
  const fields = [
    { name: ctx.t('info.user.created'), value: stamp(user.createdAt), inline: true },
    ...(badges.length ? [{ name: ctx.t('info.user.badges'), value: badges.join(', '), inline: true }] : []),
    ...(member ? memberFields(ctx, member) : []),
  ];

  const links = [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(ctx.t('info.user.avatar')).setURL(user.displayAvatarURL({ size: 4096 }))];
  const banner = user.bannerURL({ size: 4096 });
  if (banner) links.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(ctx.t('info.user.banner')).setURL(banner));

  const panel = ctx.panel();
  const color = member?.displayColor || user.accentColor;
  if (color) panel.accent(color);
  return panel
    .thumbnail(member?.displayAvatarURL({ size: 256 }) ?? user.displayAvatarURL({ size: 256 }))
    .text(...lines)
    .fields(fields)
    .image(banner)
    .row(...links);
}
