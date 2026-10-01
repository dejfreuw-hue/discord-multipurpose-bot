import {
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  channelMention,
  PermissionFlagsBits,
  roleMention,
  SlashCommandBuilder,
} from 'discord.js';
import type { CommandContext, InteractionContext } from '../../../core/context.js';
import { UserError } from '../../../core/errors.js';
import { defineCommand, defineComponent } from '../../../core/module.js';
import { fetchMember } from '../../moderation/actions.js';
import { prepareBackground } from '../card.js';
import { progressFor } from '../curve.js';
import { fetchImage } from '../../../core/images.js';
import { BackgroundModel, ProfileModel } from '../models.js';
import { levelingConfig, levelingSettings, PRESET_NAMES, type LevelingSettings } from '../settings.js';
import { curveOf, setXp } from '../xp.js';

const MAX_REWARDS = 50;
const MAX_LIST = 25;

function statusPanel(ctx: InteractionContext, s: LevelingSettings) {
  const onOff = (on: boolean) => ctx.t(on ? 'common.on' : 'common.off');
  const none = ctx.t('common.none');
  const announce =
    s.announce.mode === 'fixed' && s.announce.channelId ? channelMention(s.announce.channelId) : ctx.t(`leveling.announce.modes.${s.announce.mode}`);
  return ctx
    .panel()
    .title(ctx.t('leveling.status.title'))
    .fields([
      { name: ctx.t('leveling.status.text'), value: `${onOff(s.text.enabled)} · ${s.text.min}-${s.text.max} XP · ${s.text.cooldownSeconds}s`, inline: true },
      {
        name: ctx.t('leveling.status.voice'),
        value: `${onOff(s.voice.enabled)} · ${ctx.t('leveling.status.perMinute', { xp: s.voice.perMinute })}${s.voice.requireOthers ? ` · ${ctx.t('leveling.status.notAlone')}` : ''}`,
        inline: true,
      },
      { name: ctx.t('leveling.status.announce'), value: announce, inline: true },
      {
        name: ctx.t('leveling.status.rewards', { mode: ctx.t(s.stackRewards ? 'leveling.status.stack' : 'leveling.status.replace') }),
        value: [...s.rewards].sort((a, b) => a.level - b.level).map((r) => `${r.level}: ${roleMention(r.roleId)}`).join('\n') || none,
      },
      { name: ctx.t('leveling.status.multipliers'), value: s.multipliers.map((m) => `${roleMention(m.roleId)} x${m.value}`).join(', ') || none },
      {
        name: ctx.t('leveling.status.ignored'),
        value: [...s.ignoredChannels.map(channelMention), ...s.ignoredRoles.map(roleMention)].join(', ') || none,
      },
      { name: ctx.t('leveling.status.cards'), value: `${ctx.t(`common.presets.${s.background}`)} · ${ctx.t('leveling.status.custom', { state: onOff(s.customCards) })}` },
    ]);
}

async function save(ctx: CommandContext<true>, patch: Partial<LevelingSettings>): Promise<LevelingSettings> {
  return ctx.bot.settings.updateModule(ctx.guild.id, levelingSettings, patch);
}

export const resetAllConfirm = defineComponent({
  kind: 'button',
  id: 'leveling:reset-all',
  permissions: { user: PermissionFlagsBits.ManageGuild },
  async run(ctx, [owner]) {
    if (owner !== ctx.interaction.user.id) throw new UserError('moderation.case.notYours');
    const { deletedCount } = await ProfileModel.deleteMany({ guildId: ctx.guild.id });
    await ctx.update(ctx.successPanel(ctx.t('leveling.reset.allDone', { count: deletedCount })));
  },
});

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('levels')
    .setDescription('leveling.admin.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('leveling.admin.status'))
    .addSubcommand((s) =>
      s
        .setName('text')
        .setDescription('leveling.admin.text')
        .addBooleanOption((o) => o.setName('enabled').setDescription('leveling.admin.options.enabled'))
        .addIntegerOption((o) => o.setName('min').setDescription('leveling.admin.options.min').setMinValue(0).setMaxValue(1000))
        .addIntegerOption((o) => o.setName('max').setDescription('leveling.admin.options.max').setMinValue(0).setMaxValue(1000))
        .addIntegerOption((o) => o.setName('cooldown').setDescription('leveling.admin.options.cooldown').setMinValue(0).setMaxValue(3600)),
    )
    .addSubcommand((s) =>
      s
        .setName('voice')
        .setDescription('leveling.admin.voice')
        .addBooleanOption((o) => o.setName('enabled').setDescription('leveling.admin.options.enabled'))
        .addIntegerOption((o) => o.setName('per_minute').setDescription('leveling.admin.options.perMinute').setMinValue(0).setMaxValue(1000))
        .addBooleanOption((o) => o.setName('require_others').setDescription('leveling.admin.options.requireOthers')),
    )
    .addSubcommand((s) =>
      s
        .setName('announce')
        .setDescription('leveling.admin.announce')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('leveling.admin.options.mode')
            .setRequired(true)
            .addChoices(...['channel', 'dm', 'fixed', 'off'].map((m) => ({ name: `leveling.announce.modes.${m}`, value: m }))),
        )
        .addChannelOption((o) =>
          o.setName('channel').setDescription('leveling.admin.options.channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addStringOption((o) => o.setName('message').setDescription('leveling.admin.options.message').setMaxLength(500)),
    )
    .addSubcommand((s) =>
      s
        .setName('cards')
        .setDescription('leveling.admin.cards')
        .addStringOption((o) =>
          o
            .setName('preset')
            .setDescription('leveling.admin.options.preset')
            .addChoices(...PRESET_NAMES.map((p) => ({ name: `common.presets.${p}`, value: p }))),
        )
        .addAttachmentOption((o) => o.setName('image').setDescription('leveling.admin.options.image'))
        .addBooleanOption((o) => o.setName('allow_custom').setDescription('leveling.admin.options.allowCustom'))
        .addBooleanOption((o) => o.setName('remove_image').setDescription('leveling.admin.options.removeImage')),
    )
    .addSubcommand((s) => s.setName('reset-all').setDescription('leveling.admin.resetAll'))
    .addSubcommandGroup((g) =>
      g
        .setName('reward')
        .setDescription('leveling.admin.reward.description')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('leveling.admin.reward.add')
            .addIntegerOption((o) => o.setName('level').setDescription('leveling.admin.options.level').setRequired(true).setMinValue(1).setMaxValue(1000))
            .addRoleOption((o) => o.setName('role').setDescription('leveling.admin.options.role').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('leveling.admin.reward.remove')
            .addRoleOption((o) => o.setName('role').setDescription('leveling.admin.options.role').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('mode')
            .setDescription('leveling.admin.reward.mode')
            .addBooleanOption((o) => o.setName('stack').setDescription('leveling.admin.options.stack').setRequired(true)),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('multiplier')
        .setDescription('leveling.admin.multiplier.description')
        .addSubcommand((s) =>
          s
            .setName('set')
            .setDescription('leveling.admin.multiplier.set')
            .addRoleOption((o) => o.setName('role').setDescription('leveling.admin.options.role').setRequired(true))
            .addNumberOption((o) => o.setName('value').setDescription('leveling.admin.options.value').setRequired(true).setMinValue(0).setMaxValue(10)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('leveling.admin.multiplier.remove')
            .addRoleOption((o) => o.setName('role').setDescription('leveling.admin.options.role').setRequired(true)),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('ignore')
        .setDescription('leveling.admin.ignore.description')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('leveling.admin.ignore.add')
            .addChannelOption((o) => o.setName('channel').setDescription('leveling.admin.options.ignoreChannel'))
            .addRoleOption((o) => o.setName('role').setDescription('leveling.admin.options.ignoreRole')),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('leveling.admin.ignore.remove')
            .addChannelOption((o) => o.setName('channel').setDescription('leveling.admin.options.ignoreChannel'))
            .addRoleOption((o) => o.setName('role').setDescription('leveling.admin.options.ignoreRole')),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('xp')
        .setDescription('leveling.admin.xp.description')
        .addSubcommand((s) =>
          s
            .setName('give')
            .setDescription('leveling.admin.xp.give')
            .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true))
            .addIntegerOption((o) => o.setName('amount').setDescription('leveling.admin.options.amount').setRequired(true).setMinValue(1)),
        )
        .addSubcommand((s) =>
          s
            .setName('take')
            .setDescription('leveling.admin.xp.take')
            .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true))
            .addIntegerOption((o) => o.setName('amount').setDescription('leveling.admin.options.amount').setRequired(true).setMinValue(1)),
        )
        .addSubcommand((s) =>
          s
            .setName('set')
            .setDescription('leveling.admin.xp.set')
            .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true))
            .addIntegerOption((o) => o.setName('amount').setDescription('leveling.admin.options.amount').setRequired(true).setMinValue(0)),
        )
        .addSubcommand((s) =>
          s
            .setName('reset')
            .setDescription('leveling.admin.xp.reset')
            .addUserOption((o) => o.setName('user').setDescription('moderation.options.member').setRequired(true)),
        ),
    ),
  defer: 'ephemeral',
  permissions: { user: PermissionFlagsBits.ManageGuild },
  async run(ctx) {
    const { options } = ctx.interaction;
    const group = options.getSubcommandGroup();
    const sub = options.getSubcommand();
    const s = await ctx.bot.settings.module(ctx.guild.id, levelingSettings);

    if (!group) {
      switch (sub) {
        case 'status':
          return ctx.respond(statusPanel(ctx, s));
        case 'text': {
          const text = { ...s.text };
          text.enabled = options.getBoolean('enabled') ?? text.enabled;
          text.min = options.getInteger('min') ?? text.min;
          text.max = options.getInteger('max') ?? text.max;
          text.cooldownSeconds = options.getInteger('cooldown') ?? text.cooldownSeconds;
          if (text.min > text.max) throw new UserError('leveling.errors.minMax');
          return ctx.respond(statusPanel(ctx, await save(ctx, { text })));
        }
        case 'voice': {
          const voice = { ...s.voice };
          voice.enabled = options.getBoolean('enabled') ?? voice.enabled;
          voice.perMinute = options.getInteger('per_minute') ?? voice.perMinute;
          voice.requireOthers = options.getBoolean('require_others') ?? voice.requireOthers;
          return ctx.respond(statusPanel(ctx, await save(ctx, { voice })));
        }
        case 'announce': {
          const mode = options.getString('mode', true) as LevelingSettings['announce']['mode'];
          const channel = options.getChannel('channel');
          if (mode === 'fixed' && !channel && !s.announce.channelId) throw new UserError('leveling.errors.needChannel');
          const message = options.getString('message');
          const custom = message === null ? s.announce.message : message.trim().toLowerCase() === 'default' ? null : message.trim();
          const announce = { mode, channelId: channel?.id ?? s.announce.channelId, message: custom };
          return ctx.respond(statusPanel(ctx, await save(ctx, { announce })));
        }
        case 'cards': {
          const patch: Partial<LevelingSettings> = {};
          const preset = options.getString('preset');
          const allow = options.getBoolean('allow_custom');
          if (preset) patch.background = preset;
          if (allow !== null) patch.customCards = allow;
          const image = options.getAttachment('image');
          if (image) {
            const maxBytes = ctx.bot.moduleConfig({ name: 'leveling', config: levelingConfig }).maxBackgroundMB * 1024 * 1024;
            const bytes = image.contentType?.startsWith('image/') ? await fetchImage(image.url, maxBytes) : null;
            const prepared = bytes && (await prepareBackground(bytes).catch(() => null));
            if (!prepared) throw new UserError('leveling.rankcard.badImage', { mb: maxBytes / 1024 / 1024 });
            await BackgroundModel.updateOne({ guildId: ctx.guild.id, userId: '' }, { data: prepared }, { upsert: true });
          } else if (options.getBoolean('remove_image')) {
            await BackgroundModel.deleteOne({ guildId: ctx.guild.id, userId: '' });
          }
          return ctx.respond(statusPanel(ctx, await save(ctx, patch)));
        }
        case 'reset-all': {
          const count = await ProfileModel.countDocuments({ guildId: ctx.guild.id });
          return ctx.respond(
            ctx
              .errorPanel(ctx.t('leveling.reset.confirm', { count }))
              .row(
                new ButtonBuilder()
                  .setCustomId(`leveling:reset-all:${ctx.interaction.user.id}`)
                  .setStyle(ButtonStyle.Danger)
                  .setLabel(ctx.t('leveling.reset.button')),
              ),
          );
        }
      }
    }

    if (group === 'reward') {
      if (sub === 'mode') return ctx.respond(statusPanel(ctx, await save(ctx, { stackRewards: options.getBoolean('stack', true) })));
      const role = options.getRole('role', true);
      const others = s.rewards.filter((r) => r.roleId !== role.id);
      if (sub === 'remove') return ctx.respond(statusPanel(ctx, await save(ctx, { rewards: others })));
      if (role.managed || role.id === ctx.guild.id) throw new UserError('moderation.errors.managedRole', { role: role.toString() });
      const me = ctx.guild.members.me;
      if (me && me.roles.highest.comparePositionTo(role.id) <= 0) throw new UserError('moderation.errors.botRoleHierarchy', { role: role.toString() });
      if (others.length >= MAX_REWARDS) throw new UserError('ai.errors.listFull', { max: MAX_REWARDS });
      const rewards = [...others, { level: options.getInteger('level', true), roleId: role.id }];
      return ctx.respond(statusPanel(ctx, await save(ctx, { rewards })));
    }

    if (group === 'multiplier') {
      const role = options.getRole('role', true);
      const others = s.multipliers.filter((m) => m.roleId !== role.id);
      if (sub === 'set' && others.length >= MAX_LIST) throw new UserError('ai.errors.listFull', { max: MAX_LIST });
      const multipliers = sub === 'set' ? [...others, { roleId: role.id, value: options.getNumber('value', true) }] : others;
      return ctx.respond(statusPanel(ctx, await save(ctx, { multipliers })));
    }

    if (group === 'ignore') {
      const channel = options.getChannel('channel');
      const role = options.getRole('role');
      if (!channel && !role) throw new UserError('leveling.errors.ignoreTarget');
      const toggle = (list: string[], id: string | undefined) => {
        if (!id) return list;
        const rest = list.filter((x) => x !== id);
        if (sub !== 'add') return rest;
        if (rest.length >= MAX_LIST) throw new UserError('ai.errors.listFull', { max: MAX_LIST });
        return [...rest, id];
      };
      const patch = { ignoredChannels: toggle(s.ignoredChannels, channel?.id), ignoredRoles: toggle(s.ignoredRoles, role?.id) };
      return ctx.respond(statusPanel(ctx, await save(ctx, patch)));
    }

    if (group === 'xp') {
      const user = options.getUser('user', true);
      const member = await fetchMember(ctx.guild, user.id);
      if (!member) throw new UserError('moderation.errors.notMember', { user: user.toString() });
      const current = (await ProfileModel.findOne({ guildId: ctx.guild.id, userId: user.id }).lean())?.xp ?? 0;
      const amount = options.getInteger('amount') ?? 0;
      const target = sub === 'give' ? current + amount : sub === 'take' ? current - amount : sub === 'set' ? amount : 0;
      const profile = await setXp(ctx.bot, member, target);
      if (sub === 'reset') await ProfileModel.updateOne({ guildId: ctx.guild.id, userId: user.id }, { messages: 0, voiceMinutes: 0 });
      const level = progressFor(profile.xp, curveOf(ctx.bot)).level;
      return ctx.respond(ctx.successPanel(ctx.t('leveling.xp.updated', { user: user.toString(), xp: profile.xp.toLocaleString(), level })));
    }
  },
});
