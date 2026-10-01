import { channelMention, roleMention } from 'discord.js';
import type { InteractionContext } from '../../core/context.js';
import { formatDuration } from '../../core/duration.js';
import type { Panel } from '../../core/ui/panel.js';
import { describeStep } from './enforce.js';
import { FILTERS, type AutomodSettings, type FilterName } from './settings.js';

export function filterSummary(ctx: InteractionContext, name: FilterName, settings: AutomodSettings): string {
  const f = settings.filters[name];
  const parts = [ctx.t(f.enabled ? 'common.on' : 'common.off'), ctx.t('automod.status.strikes', { count: f.strikes })];
  switch (name) {
    case 'invites':
      if (settings.filters.invites.allowOwnServer) parts.push(ctx.t('automod.status.ownInvites'));
      break;
    case 'links':
      parts.push(ctx.t('automod.status.domains', { count: settings.filters.links.allowedDomains.length }));
      break;
    case 'badWords':
      parts.push(ctx.t('automod.status.words', { count: settings.filters.badWords.words.length }));
      break;
    case 'spam': {
      const s = settings.filters.spam;
      parts.push(ctx.t('automod.status.spam', { messages: s.messages, seconds: s.seconds, duplicates: s.duplicates }));
      break;
    }
    case 'mentions':
      parts.push(ctx.t('automod.status.mentions', { limit: settings.filters.mentions.limit }));
      break;
    case 'caps':
      parts.push(ctx.t('automod.status.caps', { percent: settings.filters.caps.percent, min: settings.filters.caps.minLength }));
      break;
    case 'ghostPing':
      parts.push(ctx.t('automod.status.ghostPing', { seconds: settings.filters.ghostPing.seconds }));
      break;
  }
  return `**${ctx.t(`automod.filters.${name}`)}**: ${parts.join(' · ')}`;
}

export function statusPanel(ctx: InteractionContext, settings: AutomodSettings): Panel {
  const ladder = [...settings.ladder]
    .sort((a, b) => a.strikes - b.strikes)
    .map((step) => ctx.t('automod.status.step', { strikes: step.strikes, action: describeStep((k, v) => ctx.t(k, v), step) }));
  const none = ctx.t('common.none');

  return ctx
    .panel()
    .title(ctx.t('automod.status.title'))
    .text(FILTERS.map((name) => filterSummary(ctx, name, settings)).join('\n'))
    .divider()
    .fields([
      { name: ctx.t('automod.status.ladder'), value: ladder.join('\n') || none },
      { name: ctx.t('automod.status.decay'), value: formatDuration(settings.strikeDecay), inline: true },
      { name: ctx.t('automod.status.exemptStaff'), value: ctx.t(settings.exemptStaff ? 'common.on' : 'common.off'), inline: true },
      { name: ctx.t('automod.status.notify'), value: ctx.t(settings.notify ? 'common.on' : 'common.off'), inline: true },
      { name: ctx.t('automod.status.whitelistRoles'), value: settings.whitelistRoles.map(roleMention).join(', ') || none },
      { name: ctx.t('automod.status.whitelistChannels'), value: settings.whitelistChannels.map(channelMention).join(', ') || none },
    ]);
}
