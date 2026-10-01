import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, type MessageActionRowComponentBuilder } from 'discord.js';
import { UserError } from '../../core/errors.js';
import { defineComponent, type SetupStep } from '../../core/module.js';
import { renderWizard } from '../core/setup/wizard.js';
import { economySettings, formatMoney } from './settings.js';

const STEP = 'economy.games';

export const economyStep: SetupStep = {
  id: 'games',
  async render(ctx) {
    const s = await ctx.bot.settings.module(ctx.guild.id, economySettings);
    const toggle = (key: 'gambling' | 'rob', on: boolean) =>
      new ButtonBuilder()
        .setCustomId(`economy:setup:${key}`)
        .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setLabel(`${ctx.t(`economy.setup.${key}`)}: ${ctx.t(on ? 'common.on' : 'common.off')}`);
    return {
      text: ctx.t('economy.setup.body', { example: formatMoney(1500, s.currency), command: ctx.bot.commandMention('economy status') }),
      rows: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(toggle('gambling', s.gambling.enabled), toggle('rob', s.rob.enabled))],
    };
  },
};

export const economySetupComponents = [
  defineComponent({
    kind: 'button',
    id: 'economy:setup',
    permissions: { user: PermissionFlagsBits.ManageGuild },
    async run(ctx, [key]) {
      if (key !== 'gambling' && key !== 'rob') throw new UserError('errors.expired');
      const s = await ctx.bot.settings.module(ctx.guild.id, economySettings);
      await ctx.bot.settings.updateModule(ctx.guild.id, economySettings, { [key]: { ...s[key], enabled: !s[key].enabled } });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
];
