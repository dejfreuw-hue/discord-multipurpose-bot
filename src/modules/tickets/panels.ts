import {
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  channelMention,
  type ButtonInteraction,
  type Guild,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { Bot } from '../../core/bot.js';
import type { InteractionContext } from '../../core/context.js';
import { UserError } from '../../core/errors.js';
import { defineComponent } from '../../core/module.js';
import type { Panel } from '../../core/ui/panel.js';
import { openTicket } from './lifecycle.js';
import { PanelModel, type ButtonStyleName, type PanelDoc, type TicketCategory } from './models.js';

const STYLES: Record<ButtonStyleName, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

export async function findPanel(guildId: string, panelId: number): Promise<PanelDoc> {
  const panel = await PanelModel.findOne({ guildId, panelId }).lean<PanelDoc>();
  if (!panel) throw new UserError('tickets.errors.noPanel', { id: panelId });
  return panel;
}

export function findCategory(panel: PanelDoc, categoryId: string): TicketCategory {
  const category = panel.categories.find((c) => c.id === categoryId);
  if (!category) throw new UserError('tickets.errors.noCategory');
  return category;
}

export function renderPanel(bot: Bot, panel: PanelDoc, color: number, emptyText: string): Panel {
  const view = bot.panel(color).title(panel.title).text(panel.description || null);
  if (panel.categories.length === 0) return view.text(`-# ${emptyText}`);

  if (panel.kind === 'select') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`ticket:open-select:${panel.panelId}`)
      .addOptions(
        panel.categories.slice(0, 25).map((c) => {
          const option = new StringSelectMenuOptionBuilder().setValue(c.id).setLabel(c.label.slice(0, 100));
          if (c.description) option.setDescription(c.description.slice(0, 100));
          if (c.emoji) option.setEmoji(c.emoji);
          return option;
        }),
      );
    return view.row(menu);
  }

  const buttons = panel.categories.slice(0, 25).map((c) => {
    const button = new ButtonBuilder().setCustomId(`ticket:open:${panel.panelId}:${c.id}`).setStyle(STYLES[c.style]).setLabel(c.label.slice(0, 80));
    if (c.emoji) button.setEmoji(c.emoji);
    return button;
  });
  for (let i = 0; i < buttons.length; i += 5) view.row(...buttons.slice(i, i + 5));
  return view;
}

/** Posts the panel, or edits the existing message when it's still there. */
export async function publishPanel(bot: Bot, guild: Guild, panel: PanelDoc, channelId?: string): Promise<string> {
  const core = await bot.settings.get(guild.id);
  const t = (key: string) => bot.i18n.t(bot.guildLocale(core), key);
  const targetId = channelId ?? panel.channelId;
  const channel = targetId ? guild.channels.cache.get(targetId) : null;
  if (!channel?.isSendable()) throw new UserError('tickets.errors.panelChannel');

  const message = renderPanel(bot, panel, core.color ?? bot.config.bot.color, t('tickets.panel.empty')).render();
  if (panel.messageId && panel.channelId === channel.id) {
    const existing = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (existing) {
      await existing.edit(message);
      return existing.url;
    }
  }
  try {
    const sent = await channel.send(message);
    await PanelModel.updateOne({ guildId: guild.id, panelId: panel.panelId }, { channelId: channel.id, messageId: sent.id });
    return sent.url;
  } catch (err) {
    // An invalid emoji on a category is the usual cause; Discord rejects the whole message.
    bot.logger.warn({ err, guild: guild.id, panel: panel.panelId }, 'could not post ticket panel');
    throw new UserError('tickets.errors.panelInvalid');
  }
}

/** Refreshes an already posted panel after its categories change. Never fails the command. */
export async function refreshPanel(bot: Bot, guild: Guild, panelId: number): Promise<void> {
  const panel = await PanelModel.findOne({ guildId: guild.id, panelId }).lean<PanelDoc>();
  if (panel?.messageId) await publishPanel(bot, guild, panel).catch(() => undefined);
}

function formModal(ctx: InteractionContext, panel: PanelDoc, category: TicketCategory): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`ticket:form:${panel.panelId}:${category.id}`)
    .setTitle(ctx.t('tickets.form.title', { category: category.label }).slice(0, 45));
  category.questions.slice(0, 5).forEach((q, i) => {
    const input = new TextInputBuilder()
      .setCustomId(`q${i}`)
      .setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(q.required)
      .setMaxLength(q.long ? 1000 : 200);
    if (q.placeholder) input.setPlaceholder(q.placeholder.slice(0, 100));
    modal.addLabelComponents(new LabelBuilder().setLabel(q.label.slice(0, 45)).setTextInputComponent(input));
  });
  return modal;
}

async function startOpening(
  ctx: InteractionContext,
  interaction: ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>,
  panelId: number,
  categoryId: string,
): Promise<void> {
  const resetSelect = interaction.isStringSelectMenu();
  const panel = await findPanel(interaction.guildId, panelId);
  const category = findCategory(panel, categoryId);
  if (category.questions.length > 0) {
    await interaction.showModal(formModal(ctx, panel, category));
    return;
  }

  // Re-rendering the panel resets the select menu, so picking the same option again works.
  if (resetSelect) {
    const color = ctx.settings?.color ?? ctx.bot.config.bot.color;
    await interaction.update(renderPanel(ctx.bot, panel, color, ctx.t('tickets.panel.empty')).render());
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    ctx.deferMode = 'ephemeral';
  }
  const channel = await openTicket(ctx.bot, interaction.member, { panelId, category }, []);
  const done = ctx.successPanel(ctx.t('tickets.opened', { channel: channelMention(channel.id) }));
  if (resetSelect) await ctx.whisper(done);
  else await ctx.respond(done);
}

export const panelComponents = [
  defineComponent({
    kind: 'button',
    id: 'ticket:open',
    defer: false,
    async run(ctx, [panelId, categoryId]) {
      await startOpening(ctx, ctx.interaction, Number(panelId), categoryId ?? '');
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'ticket:open-select',
    defer: false,
    async run(ctx, [panelId]) {
      if (!ctx.interaction.isStringSelectMenu()) return;
      await startOpening(ctx, ctx.interaction, Number(panelId), ctx.interaction.values[0] ?? '');
    },
  }),
  defineComponent({
    kind: 'modal',
    id: 'ticket:form',
    defer: 'ephemeral',
    async run(ctx, [panelId, categoryId]) {
      const panel = await findPanel(ctx.guild.id, Number(panelId));
      const category = findCategory(panel, categoryId ?? '');
      const answers = category.questions.slice(0, 5).map((q, i) => {
        let answer = '';
        try {
          answer = ctx.interaction.fields.getTextInputValue(`q${i}`).trim();
        } catch {
          // The question list changed while the form was open; that field doesn't exist.
        }
        return { question: q.label, answer };
      });
      const channel = await openTicket(ctx.bot, ctx.member, { panelId: panel.panelId, category }, answers);
      await ctx.respond(ctx.successPanel(ctx.t('tickets.opened', { channel: channelMention(channel.id) })));
    },
  }),
];
