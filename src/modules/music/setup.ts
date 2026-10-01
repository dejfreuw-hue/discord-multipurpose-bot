import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { UserError } from '../../core/errors.js';
import { defineComponent, type SetupStep } from '../../core/module.js';
import { renderWizard } from '../core/setup/wizard.js';
import { musicSettings } from './settings.js';

const MANAGE = { user: PermissionFlagsBits.ManageGuild };
const STEP = 'music.player';

const row = (...components: MessageActionRowComponentBuilder[]) =>
  new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(components);

export const musicStep: SetupStep = {
  id: 'player',
  async render(ctx) {
    const s = await ctx.bot.settings.module(ctx.guild.id, musicSettings);
    const roles = new RoleSelectMenuBuilder()
      .setCustomId('music:setup:dj')
      .setPlaceholder(ctx.t('music.setup.djPlaceholder'))
      .setMinValues(0)
      .setMaxValues(10)
      .setDefaultRoles(s.djRoles.slice(0, 10));
    const toggle = (key: 'announce' | 'alwaysOn', on: boolean) =>
      new ButtonBuilder()
        .setCustomId(`music:setup:toggle:${key}`)
        .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setLabel(`${ctx.t(`music.setup.${key}`)}: ${ctx.t(on ? 'common.on' : 'common.off')}`);
    return {
      text: ctx.t('music.setup.body'),
      rows: [row(roles), row(toggle('announce', s.announce), toggle('alwaysOn', s.alwaysOn))],
    };
  },
};

export const musicSetupComponents = [
  defineComponent({
    kind: 'select',
    id: 'music:setup:dj',
    permissions: MANAGE,
    async run(ctx) {
      await ctx.bot.settings.updateModule(ctx.guild.id, musicSettings, { djRoles: [...ctx.interaction.values] });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
  defineComponent({
    kind: 'button',
    id: 'music:setup:toggle',
    permissions: MANAGE,
    async run(ctx, [key]) {
      if (key !== 'announce' && key !== 'alwaysOn') throw new UserError('errors.expired');
      const s = await ctx.bot.settings.module(ctx.guild.id, musicSettings);
      await ctx.bot.settings.updateModule(ctx.guild.id, musicSettings, { [key]: !s[key] });
      await ctx.update(await renderWizard(ctx, STEP));
    },
  }),
];
