import {
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  userMention,
  type GuildMember,
  type VoiceChannel,
} from 'discord.js';
import type { Bot } from '../../core/bot.js';
import type { ComponentContext } from '../../core/context.js';
import { UserError } from '../../core/errors.js';
import { defineComponent } from '../../core/module.js';
import { isStaff } from '../../core/permissions.js';
import type { Panel } from '../../core/ui/panel.js';
import { kick, permit, rename, setHidden, setLocked, tempChannel, transfer } from './channels.js';
import type { TempChannelDoc } from './model.js';
import { canClaim, canManage } from './rules.js';

export async function renderPanel(bot: Bot, channel: VoiceChannel, doc: TempChannelDoc): Promise<Panel> {
  const core = await bot.settings.get(channel.guild.id);
  const t = (key: string, vars?: Record<string, string | number>) => bot.i18n.t(bot.guildLocale(core), key, vars);
  const button = (id: string, label: string, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(`voice:ctl:${id}`).setLabel(label).setStyle(style);
  const select = (id: string, placeholder: string) =>
    new UserSelectMenuBuilder().setCustomId(`voice:${id}`).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1);

  return bot
    .panel(core.color ?? bot.config.bot.color)
    .title(t('voice.panel.title'))
    .text(
      t('voice.panel.owner', { user: userMention(doc.ownerId) }),
      `${t(doc.locked ? 'voice.panel.locked' : 'voice.panel.unlocked')} · ${t(doc.hidden ? 'voice.panel.hidden' : 'voice.panel.visible')} · ${t(
        'voice.panel.limit',
        { limit: channel.userLimit || t('voice.panel.noLimit') },
      )}`,
    )
    .footer(t('voice.panel.footer'))
    .row(
      button('lock', t(doc.locked ? 'voice.panel.unlock' : 'voice.panel.lock'), doc.locked ? ButtonStyle.Success : ButtonStyle.Secondary),
      button('hide', t(doc.hidden ? 'voice.panel.show' : 'voice.panel.hide'), doc.hidden ? ButtonStyle.Success : ButtonStyle.Secondary),
      button('limit', t('voice.panel.setLimit')),
      button('rename', t('voice.panel.rename')),
      button('claim', t('voice.panel.claim'), ButtonStyle.Primary),
    )
    .row(select('kick', t('voice.panel.kick')))
    .row(select('permit', t('voice.panel.permit')))
    .row(select('transfer', t('voice.panel.transfer')));
}

type Ctx = ComponentContext;

/** The temp channel this panel controls, after checking the member may manage it. */
async function managed(ctx: Ctx): Promise<{ channel: VoiceChannel; doc: TempChannelDoc }> {
  const channel = ctx.interaction.channel;
  const doc = channel ? await tempChannel(channel.id) : null;
  if (!channel || channel.type !== ChannelType.GuildVoice || !doc) throw new UserError('voice.errors.notTemp');
  const staff = ctx.member.permissions.has(PermissionFlagsBits.ManageChannels) || isStaff(ctx.member, ctx.settings.staffRoles);
  if (!canManage({ isOwner: doc.ownerId === ctx.member.id, isStaff: staff })) throw new UserError('voice.errors.ownerOnly');
  return { channel, doc };
}

async function refresh(ctx: Ctx, channel: VoiceChannel): Promise<void> {
  const doc = await tempChannel(channel.id);
  if (doc) await ctx.update(await renderPanel(ctx.bot, channel, doc));
}

function memberIn(ctx: Ctx, id: string | undefined): GuildMember {
  const member = id ? ctx.guild.members.cache.get(id) : undefined;
  if (!member) throw new UserError('voice.errors.unknownMember');
  return member;
}

export const panelComponents = [
  defineComponent({
    kind: 'button',
    id: 'voice:ctl',
    defer: false,
    async run(ctx, [action]) {
      if (action === 'claim') {
        const channel = ctx.interaction.channel;
        const doc = channel ? await tempChannel(channel.id) : null;
        if (!channel || channel.type !== ChannelType.GuildVoice || !doc) throw new UserError('voice.errors.notTemp');
        if (doc.ownerId === ctx.member.id) throw new UserError('voice.errors.alreadyOwner');
        if (!canClaim(channel.members.has(doc.ownerId), channel.members.has(ctx.member.id))) throw new UserError('voice.errors.cantClaim');
        await ctx.interaction.deferUpdate();
        ctx.deferMode = 'update';
        await transfer(channel, doc, ctx.member);
        await refresh(ctx, channel);
        return;
      }

      const { channel, doc } = await managed(ctx);
      if (action === 'limit' || action === 'rename') {
        const input = new TextInputBuilder().setCustomId('value').setStyle(TextInputStyle.Short).setRequired(action === 'rename');
        if (action === 'limit') input.setMaxLength(2).setValue(String(channel.userLimit)).setPlaceholder('0-99');
        else input.setMaxLength(100).setValue(channel.name);
        await ctx.interaction.showModal(
          new ModalBuilder()
            .setCustomId(`voice:${action}`)
            .setTitle(ctx.t(`voice.panel.${action === 'limit' ? 'setLimit' : 'rename'}`))
            .addLabelComponents(new LabelBuilder().setLabel(ctx.t(`voice.modal.${action}`)).setTextInputComponent(input)),
        );
        return;
      }

      await ctx.interaction.deferUpdate();
      ctx.deferMode = 'update';
      if (action === 'lock') await setLocked(channel, doc, !doc.locked);
      else if (action === 'hide') await setHidden(channel, doc, !doc.hidden);
      else throw new UserError('errors.expired');
      await refresh(ctx, channel);
    },
  }),
  defineComponent({
    kind: 'modal',
    id: 'voice:limit',
    async run(ctx) {
      const { channel } = await managed(ctx);
      const raw = ctx.interaction.fields.getTextInputValue('value').trim() || '0';
      const limit = Number(raw);
      if (!Number.isInteger(limit) || limit < 0 || limit > 99) throw new UserError('voice.errors.badLimit');
      await channel.setUserLimit(limit, 'join-to-create limit');
      await refresh(ctx, channel);
    },
  }),
  defineComponent({
    kind: 'modal',
    id: 'voice:rename',
    async run(ctx) {
      const { channel, doc } = await managed(ctx);
      const name = ctx.interaction.fields.getTextInputValue('value').trim();
      if (!name) throw new UserError('voice.errors.emptyName');
      await rename(channel, doc, name);
      await refresh(ctx, channel);
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'voice:kick',
    async run(ctx) {
      const { channel, doc } = await managed(ctx);
      const target = memberIn(ctx, ctx.interaction.values[0]);
      await kick(channel, doc, target);
      await refresh(ctx, channel);
      await ctx.whisper(ctx.successPanel(ctx.t('voice.done.kicked', { user: target.toString() })));
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'voice:permit',
    async run(ctx) {
      const { channel } = await managed(ctx);
      const target = memberIn(ctx, ctx.interaction.values[0]);
      await permit(channel, target);
      await refresh(ctx, channel);
      await ctx.whisper(ctx.successPanel(ctx.t('voice.done.permitted', { user: target.toString() })));
    },
  }),
  defineComponent({
    kind: 'select',
    id: 'voice:transfer',
    async run(ctx) {
      const { channel, doc } = await managed(ctx);
      const target = memberIn(ctx, ctx.interaction.values[0]);
      await transfer(channel, doc, target);
      await refresh(ctx, channel);
      await ctx.whisper(ctx.successPanel(ctx.t('voice.done.transferred', { user: target.toString() })));
    },
  }),
];

