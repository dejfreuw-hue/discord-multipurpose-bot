import { roleMention, time, TimestampStyles, userMention } from 'discord.js';
import type { Bot } from '../../core/bot.js';
import { UserError } from '../../core/errors.js';
import { fetchMember, unban } from './actions.js';
import { CaseModel, type CaseDoc } from './models/case.js';
import { TempRoleModel } from './models/temp-role.js';
import { postModLog } from './modlog.js';

const BATCH = 50;

/**
 * Lifts expired temporary bans and removes expired temporary roles. Expiries live in Mongo and
 * are polled, so they survive restarts and don't depend on long-running timers.
 * Returns a function that stops the loop.
 */
export function startExpiryLoop(bot: Bot, intervalSeconds: number): () => void {
  let running = false;
  const tick = async () => {
    if (running || bot.stopping) return;
    running = true;
    try {
      await liftBans(bot);
      await removeRoles(bot);
    } catch (err) {
      bot.logger.error({ err }, 'expiry check failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalSeconds * 1000);
  void tick();
  return () => clearInterval(timer);
}

async function liftBans(bot: Bot): Promise<void> {
  const due = await CaseModel.find({ active: true, type: 'ban', expiresAt: { $lte: new Date() } })
    .limit(BATCH)
    .lean<CaseDoc[]>();

  for (const entry of due) {
    // Mark first so a slow unban can't be picked up twice by the next tick.
    await CaseModel.updateOne({ guildId: entry.guildId, caseId: entry.caseId }, { active: false });
    const guild = bot.client.guilds.cache.get(entry.guildId);
    if (!guild) continue;

    const locale = bot.guildLocale(await bot.settings.get(guild.id));
    try {
      const user = await bot.client.users.fetch(entry.userId);
      await unban(bot, {
        guild,
        user,
        moderator: null,
        reason: bot.i18n.t(locale, 'moderation.expiry.banReason', { id: entry.caseId }),
        source: 'expiry',
      });
    } catch (err) {
      // Someone already unbanned them by hand; nothing left to do.
      if (err instanceof UserError) continue;
      bot.logger.warn({ err, guild: guild.id, case: entry.caseId }, 'could not lift temporary ban');
    }
  }
}

async function removeRoles(bot: Bot): Promise<void> {
  const due = await TempRoleModel.find({ expiresAt: { $lte: new Date() } })
    .limit(BATCH)
    .lean();

  for (const entry of due) {
    await TempRoleModel.deleteOne({ _id: entry._id });
    const guild = bot.client.guilds.cache.get(entry.guildId);
    if (!guild) continue;

    try {
      const member = await fetchMember(guild, entry.userId);
      if (!member?.roles.cache.has(entry.roleId)) continue;
      await member.roles.remove(entry.roleId, 'temporary role expired');

      const settings = await bot.settings.get(guild.id);
      const locale = bot.guildLocale(settings);
      await postModLog(
        bot,
        guild,
        bot
          .panel(settings.color ?? bot.config.bot.color)
          .title(bot.i18n.t(locale, 'moderation.expiry.roleTitle'))
          .text(
            bot.i18n.t(locale, 'moderation.expiry.role', {
              user: userMention(entry.userId),
              role: roleMention(entry.roleId),
              time: time(new Date(), TimestampStyles.ShortDateTime),
            }),
          ),
      );
    } catch (err) {
      bot.logger.warn({ err, guild: guild.id, role: entry.roleId }, 'could not remove temporary role');
    }
  }
}
