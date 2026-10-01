import {
  Events,
  GatewayIntentBits,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type GuildTextBasedChannel,
} from 'discord.js';
import { z } from 'zod';
import { UserError } from '../../../core/errors.js';
import { defineCommand, defineComponent, defineEvent, defineModule } from '../../../core/module.js';
import { StickyModel, type StickyDoc } from './model.js';
import { loadStickyChannels, scheduleRepost, stickyChannels } from './repost.js';

const stickyConfig = z.object({
  maxPerGuild: z.number().int().min(1).max(50).default(10),
});

const MANAGE = { user: PermissionFlagsBits.ManageMessages, allowStaff: true };

function stickyTarget(channel: GuildTextBasedChannel | null): GuildTextBasedChannel {
  if (!channel || !channel.isSendable()) throw new UserError('sticky.errors.channel');
  return channel;
}

const sticky = defineCommand({
  data: new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('sticky.command.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((s) => s.setName('set').setDescription('sticky.command.set'))
    .addSubcommand((s) => s.setName('remove').setDescription('sticky.command.remove'))
    .addSubcommand((s) => s.setName('list').setDescription('sticky.command.list')),
  // `set` answers with a modal, which can't follow a deferred reply.
  defer: false,
  permissions: MANAGE,
  async run(ctx) {
    const sub = ctx.interaction.options.getSubcommand();
    const channel = stickyTarget(ctx.interaction.channel);

    if (sub === 'set') {
      const existing = await StickyModel.findOne({ channelId: channel.id }).lean<StickyDoc>();
      const input = new TextInputBuilder().setCustomId('content').setStyle(TextInputStyle.Paragraph).setMaxLength(2000).setRequired(true);
      if (existing) input.setValue(existing.content);
      await ctx.interaction.showModal(
        new ModalBuilder()
          .setCustomId(`sticky:save:${channel.id}`)
          .setTitle(ctx.t('sticky.modal.title'))
          .addLabelComponents(new LabelBuilder().setLabel(ctx.t('sticky.modal.label')).setTextInputComponent(input)),
      );
      return;
    }

    await ctx.interaction.deferReply({ flags: MessageFlags.Ephemeral });
    ctx.deferMode = 'ephemeral';

    if (sub === 'remove') {
      const removed = await StickyModel.findOneAndDelete({ channelId: channel.id }).lean<StickyDoc>();
      if (!removed) throw new UserError('sticky.errors.none');
      stickyChannels.delete(channel.id);
      if (removed.messageId) await channel.messages.delete(removed.messageId).catch(() => undefined);
      await ctx.respond(ctx.successPanel(ctx.t('sticky.removed')));
      return;
    }

    const list = await StickyModel.find({ guildId: ctx.guild.id }).lean<StickyDoc[]>();
    const lines = list.map((s) => `<#${s.channelId}>: ${s.content.replace(/\s+/g, ' ').slice(0, 80)}`);
    await ctx.respond(ctx.panel().title(ctx.t('sticky.listTitle')).text(lines.join('\n') || ctx.t('sticky.empty')));
  },
});

const save = defineComponent({
  kind: 'modal',
  id: 'sticky:save',
  defer: 'ephemeral',
  permissions: MANAGE,
  async run(ctx, [channelId]) {
    const channel = ctx.guild.channels.cache.get(channelId ?? '');
    if (!channel?.isTextBased() || !channel.isSendable()) throw new UserError('sticky.errors.channel');
    const content = ctx.interaction.fields.getTextInputValue('content').trim();
    if (!content) throw new UserError('sticky.errors.empty');

    const isNew = !(await StickyModel.exists({ channelId: channel.id }));
    const { maxPerGuild } = ctx.bot.moduleConfig(stickyModule);
    if (isNew && (await StickyModel.countDocuments({ guildId: ctx.guild.id })) >= maxPerGuild) {
      throw new UserError('sticky.errors.limit', { count: maxPerGuild });
    }
    await StickyModel.updateOne({ channelId: channel.id }, { $set: { guildId: ctx.guild.id, content } }, { upsert: true });
    stickyChannels.add(channel.id);
    // Through the throttle so it can't race a repost triggered by chat in the same channel.
    scheduleRepost(ctx.bot, channel);
    await ctx.respond(ctx.successPanel(ctx.t('sticky.saved')));
  },
});

const messageCreate = defineEvent({
  name: Events.MessageCreate,
  async run(bot, message) {
    if (!message.inGuild() || !stickyChannels.has(message.channelId)) return;
    // Our own repost would otherwise trigger the next one.
    if (message.author.id === bot.client.user?.id) return;
    if (!bot.isEnabled('sticky', await bot.settings.get(message.guildId))) return;
    if (message.channel.isSendable()) scheduleRepost(bot, message.channel);
  },
});

const stickyModule = defineModule({
  name: 'sticky',
  toggleable: true,
  intents: [GatewayIntentBits.GuildMessages],
  config: stickyConfig,
  commands: [sticky],
  components: [save],
  events: [messageCreate],
  start: () => loadStickyChannels(),
});

export default stickyModule;
