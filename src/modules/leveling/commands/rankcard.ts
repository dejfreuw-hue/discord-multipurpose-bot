import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand } from '../../../core/module.js';
import { prepareBackground } from '../card.js';
import { fetchImage } from '../../../core/images.js';
import { BackgroundModel, ProfileModel } from '../models.js';
import { rankCard } from '../render.js';
import { levelingConfig, levelingSettings, PRESET_NAMES } from '../settings.js';

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('rankcard')
    .setDescription('leveling.rankcard.description')
    .addSubcommand((s) =>
      s
        .setName('preset')
        .setDescription('leveling.rankcard.preset')
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('leveling.rankcard.options.preset')
            .setRequired(true)
            .addChoices(...PRESET_NAMES.map((p) => ({ name: `common.presets.${p}`, value: p }))),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('image')
        .setDescription('leveling.rankcard.image')
        .addAttachmentOption((o) => o.setName('file').setDescription('leveling.rankcard.options.file').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('color')
        .setDescription('leveling.rankcard.color')
        .addStringOption((o) => o.setName('hex').setDescription('leveling.rankcard.options.hex').setRequired(true).setMaxLength(7)),
    )
    .addSubcommand((s) => s.setName('reset').setDescription('leveling.rankcard.reset')),
  defer: 'ephemeral',
  cooldown: 10,
  async run(ctx) {
    const settings = await ctx.bot.settings.module(ctx.guild.id, levelingSettings);
    if (!settings.customCards && !ctx.member.permissions.has(PermissionFlagsBits.ManageGuild)) throw new UserError('leveling.rankcard.disabled');
    const filter = { guildId: ctx.guild.id, userId: ctx.member.id };
    const { options } = ctx.interaction;

    switch (options.getSubcommand()) {
      case 'preset':
        await ProfileModel.updateOne(filter, { 'card.preset': options.getString('name', true) }, { upsert: true });
        await BackgroundModel.deleteOne(filter);
        break;
      case 'image': {
        const file = options.getAttachment('file', true);
        const maxBytes = ctx.bot.moduleConfig({ name: 'leveling', config: levelingConfig }).maxBackgroundMB * 1024 * 1024;
        if (!file.contentType?.startsWith('image/') || file.size > maxBytes) {
          throw new UserError('leveling.rankcard.badImage', { mb: maxBytes / 1024 / 1024 });
        }
        const bytes = await fetchImage(file.url, maxBytes);
        const prepared = bytes && (await prepareBackground(bytes).catch(() => null));
        if (!prepared) throw new UserError('leveling.rankcard.badImage', { mb: maxBytes / 1024 / 1024 });
        await BackgroundModel.updateOne(filter, { data: prepared }, { upsert: true });
        break;
      }
      case 'color': {
        const raw = options.getString('hex', true).trim();
        if (!/^#?[0-9a-f]{6}$/i.test(raw)) throw new UserError('core.setup.appearance.invalid', { value: raw });
        await ProfileModel.updateOne(filter, { 'card.color': Number.parseInt(raw.replace('#', ''), 16) }, { upsert: true });
        break;
      }
      case 'reset':
        await ProfileModel.updateOne(filter, { 'card.preset': null, 'card.color': null });
        await BackgroundModel.deleteOne(filter);
        break;
    }

    const { file } = await rankCard(ctx.bot, ctx.interaction.user, ctx.guild, ctx.locale);
    await ctx.interaction.editReply({ content: ctx.t('leveling.rankcard.saved'), files: [file] });
  },
});
