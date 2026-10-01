import { AttachmentBuilder, type Guild, type User } from 'discord.js';
import { Schema, model } from 'mongoose';
import type { Bot } from '../../../core/bot.js';
import { fetchImage } from '../../../core/images.js';
import { renderWelcomeCard } from './card.js';
import { welcomeSettings, type WelcomeSettings } from './settings.js';

/** A server's uploaded card background, already resized. Stored because attachment links expire. */
export const WelcomeBackgroundModel = model<{ guildId: string; data: Buffer }>(
  'WelcomeBackground',
  new Schema({ guildId: { type: String, required: true, unique: true }, data: Buffer }, { timestamps: true }),
);

export interface TemplateVars {
  user: string;
  username: string;
  server: string;
  count: number;
}

export function fillTemplate(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{user\}/g, vars.user)
    .replace(/\{username\}/g, vars.username)
    .replace(/\{server\}/g, vars.server)
    .replace(/\{count\}/g, vars.count.toLocaleString('en-US'));
}

export type WelcomeKind = 'join' | 'leave';

/** Builds the text and optional card for a join or leave. */
export async function buildWelcome(bot: Bot, guild: Guild, user: User, kind: WelcomeKind, settings: WelcomeSettings) {
  const core = await bot.settings.get(guild.id);
  const t = (key: string, vars?: Record<string, string | number>) => bot.i18n.t(bot.guildLocale(core), key, vars);
  const vars: TemplateVars = { user: user.toString(), username: user.displayName, server: guild.name, count: guild.memberCount };
  const custom = settings[kind].message;
  const text = custom ? fillTemplate(custom, vars) : t(`welcome.defaults.${kind}`, { ...vars, count: vars.count.toLocaleString('en-US') });

  let file: AttachmentBuilder | null = null;
  if (settings[kind].card) {
    const [avatar, background] = await Promise.all([
      fetchImage(user.displayAvatarURL({ extension: 'png', size: 256 }), 4 * 1024 * 1024),
      WelcomeBackgroundModel.findOne({ guildId: guild.id }),
    ]);
    const png = await renderWelcomeCard({
      title: t(`welcome.card.${kind}`),
      name: user.displayName,
      subtitle: kind === 'join' ? t('welcome.card.member', { count: vars.count.toLocaleString('en-US') }) : guild.name,
      avatar,
      background: background ? Buffer.from(background.data) : null,
      preset: settings.background,
      accent: settings.color ?? core.color ?? bot.config.bot.color,
    });
    file = new AttachmentBuilder(png, { name: `${kind}.png` });
  }
  return { text, file, color: settings.color ?? core.color ?? bot.config.bot.color };
}

/** Sends a join or leave message to the configured channel. Missing channels are skipped quietly. */
export async function sendWelcome(bot: Bot, guild: Guild, user: User, kind: WelcomeKind): Promise<void> {
  const settings = await bot.settings.module(guild.id, welcomeSettings);
  const config = settings[kind];
  if (!config.enabled) return;
  const { text, file, color } = await buildWelcome(bot, guild, user, kind, settings);

  const channel = config.channelId ? guild.channels.cache.get(config.channelId) : null;
  if (channel?.isSendable()) {
    const panel = bot.panel(color).text(text);
    if (file) panel.image(`attachment://${file.name}`);
    await channel
      .send({ ...panel.render(), files: file ? [file] : [], allowedMentions: { users: [user.id] } })
      .catch((err) => bot.logger.warn({ err, guild: guild.id }, `${kind} message failed`));
  }
  if (kind === 'join' && settings.dm) {
    await user.send({ ...bot.panel(color).text(text).render(), allowedMentions: { parse: [] } }).catch(() => undefined);
  }
}
