import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type SlashCommandSubcommandBuilder } from 'discord.js';
import type { CommandContext } from '../../../core/context.js';
import { UserError } from '../../../core/errors.js';
import { fetchImage } from '../../../core/images.js';
import { defineCommand } from '../../../core/module.js';
import { PRESET_NAMES } from '../../../core/ui/canvas.js';
import { prepareWelcomeBackground } from './card.js';
import { buildWelcome, WelcomeBackgroundModel, type WelcomeKind } from './message.js';
import { welcomeSettings, type WelcomeSettings } from './settings.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

function eventOptions(name: WelcomeKind) {
  return (s: SlashCommandSubcommandBuilder) =>
    s
      .setName(name)
      .setDescription(`welcome.command.${name}`)
      .addBooleanOption((o) => o.setName('enabled').setDescription('welcome.command.options.enabled'))
      .addChannelOption((o) => o.setName('channel').setDescription('welcome.command.options.channel').addChannelTypes(...TEXT))
      .addStringOption((o) => o.setName('message').setDescription('welcome.command.options.message').setMaxLength(1500))
      .addBooleanOption((o) => o.setName('card').setDescription('welcome.command.options.card'));
}

function summary(ctx: CommandContext<true>, s: WelcomeSettings) {
  const line = (kind: WelcomeKind) => {
    const e = s[kind];
    const state = ctx.t(e.enabled ? 'common.on' : 'common.off');
    const where = e.channelId ? `<#${e.channelId}>` : ctx.t('welcome.command.noChannel');
    return `**${ctx.t(`welcome.command.${kind}Title`)}**: ${state} · ${where} · ${ctx.t(e.card ? 'welcome.command.withCard' : 'welcome.command.textOnly')}`;
  };
  return ctx.panel().title(ctx.t('welcome.command.title')).text(line('join'), line('leave'), `**DM**: ${ctx.t(s.dm ? 'common.on' : 'common.off')}`);
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('welcome.command.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(eventOptions('join'))
    .addSubcommand(eventOptions('leave'))
    .addSubcommand((s) =>
      s
        .setName('dm')
        .setDescription('welcome.command.dm')
        .addBooleanOption((o) => o.setName('enabled').setDescription('welcome.command.options.enabled').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('card')
        .setDescription('welcome.command.card')
        .addStringOption((o) =>
          o
            .setName('preset')
            .setDescription('welcome.command.options.preset')
            .addChoices(...PRESET_NAMES.map((p) => ({ name: `common.presets.${p}`, value: p }))),
        )
        .addAttachmentOption((o) => o.setName('image').setDescription('welcome.command.options.image'))
        .addStringOption((o) => o.setName('color').setDescription('welcome.command.options.color').setMaxLength(7))
        .addBooleanOption((o) => o.setName('remove_image').setDescription('welcome.command.options.removeImage')),
    )
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('welcome.command.test')
        .addStringOption((o) =>
          o
            .setName('kind')
            .setDescription('welcome.command.options.kind')
            .addChoices({ name: 'welcome.command.joinTitle', value: 'join' }, { name: 'welcome.command.leaveTitle', value: 'leave' }),
        ),
    ),
  defer: 'ephemeral',
  permissions: { user: PermissionFlagsBits.ManageGuild },
  async run(ctx) {
    const { options } = ctx.interaction;
    const sub = options.getSubcommand();
    const s = await ctx.bot.settings.module(ctx.guild.id, welcomeSettings);
    const save = (patch: Partial<WelcomeSettings>) => ctx.bot.settings.updateModule(ctx.guild.id, welcomeSettings, patch);

    if (sub === 'join' || sub === 'leave') {
      const current = s[sub];
      const message = options.getString('message');
      const next = {
        enabled: options.getBoolean('enabled') ?? current.enabled,
        channelId: options.getChannel('channel')?.id ?? current.channelId,
        // "default" goes back to the translated message.
        message: message === null ? current.message : message.trim().toLowerCase() === 'default' ? null : message,
        card: options.getBoolean('card') ?? current.card,
      };
      if (next.enabled && !next.channelId) throw new UserError('welcome.errors.needChannel');
      await ctx.respond(summary(ctx, await save({ [sub]: next })));
      return;
    }
    if (sub === 'dm') {
      await ctx.respond(summary(ctx, await save({ dm: options.getBoolean('enabled', true) })));
      return;
    }
    if (sub === 'card') {
      const patch: Partial<WelcomeSettings> = {};
      const preset = options.getString('preset');
      const color = options.getString('color');
      if (preset) patch.background = preset;
      if (color) {
        if (!/^#?[0-9a-f]{6}$/i.test(color)) throw new UserError('core.setup.appearance.invalid', { value: color });
        patch.color = Number.parseInt(color.replace('#', ''), 16);
      }
      const image = options.getAttachment('image');
      if (image) {
        const bytes = image.contentType?.startsWith('image/') ? await fetchImage(image.url, MAX_IMAGE_BYTES) : null;
        const prepared = bytes && (await prepareWelcomeBackground(bytes).catch(() => null));
        if (!prepared) throw new UserError('leveling.rankcard.badImage', { mb: 8 });
        await WelcomeBackgroundModel.updateOne({ guildId: ctx.guild.id }, { data: prepared }, { upsert: true });
      } else if (options.getBoolean('remove_image')) {
        await WelcomeBackgroundModel.deleteOne({ guildId: ctx.guild.id });
      }
      await save(patch);
    }

    // "card" falls through to a preview, the same as "test".
    const kind = (options.getString('kind') ?? 'join') as WelcomeKind;
    const preview = await ctx.bot.settings.module(ctx.guild.id, welcomeSettings);
    const { text, file, color } = await buildWelcome(ctx.bot, ctx.guild, ctx.interaction.user, kind, { ...preview, [kind]: { ...preview[kind], card: true } });
    const panel = ctx.bot.panel(color).text(text);
    if (file) panel.image(`attachment://${file.name}`);
    await ctx.interaction.editReply({ ...panel.render(), files: file ? [file] : [], allowedMentions: { parse: [] } });
  },
});
