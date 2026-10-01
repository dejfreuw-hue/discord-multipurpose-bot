import {
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  userMention,
  type AutocompleteInteraction,
} from 'discord.js';
import type { GuildContext } from '../../core/context.js';
import { UserError } from '../../core/errors.js';
import { defineCommand, defineComponent, defineModule } from '../../core/module.js';
import { BackupModel, type BackupDoc } from './model.js';
import { restoreBackup, type RestoreReport } from './restore.js';
import { backupConfig, backupSettings } from './settings.js';
import type { RestoreMode } from './snapshot.js';
import { accessibleBackups, createBackup, startAutoBackups } from './store.js';

const ADMIN = { user: PermissionFlagsBits.Administrator };
const restoring = new Set<string>();

async function backupAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guildId) return interaction.respond([]);
  const list = await BackupModel.find(accessibleBackups(interaction.guildId, interaction.user.id), { snapshot: 0 })
    .sort({ createdAt: -1 })
    .limit(25)
    .lean<BackupDoc[]>();
  const date = new Intl.DateTimeFormat(interaction.locale, { dateStyle: 'medium', timeStyle: 'short' });
  await interaction.respond(
    list.map((b) => ({ name: `${b.backupId} - ${b.name} (${b.guildName}, ${date.format(b.createdAt)})`.slice(0, 100), value: b.backupId })),
  );
}

async function findBackup(ctx: GuildContext, backupId: string): Promise<BackupDoc> {
  const doc = await BackupModel.findOne({ backupId, ...accessibleBackups(ctx.guild.id, ctx.member.id) }).lean<BackupDoc>();
  if (!doc) throw new UserError('backup.errors.notFound', { id: backupId.slice(0, 20) });
  return doc;
}

function backupLine(ctx: GuildContext, b: BackupDoc): string {
  return ctx.t('backup.line', {
    id: b.backupId,
    name: b.name,
    server: b.guildName,
    roles: b.roleCount,
    channels: b.channelCount,
    time: time(b.createdAt, TimestampStyles.RelativeTime),
  });
}

const backup = defineCommand({
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('backup.command.description')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('backup.command.create')
        .addStringOption((o) => o.setName('name').setDescription('backup.command.options.name').setMaxLength(50)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('backup.command.list'))
    .addSubcommand((s) =>
      s
        .setName('restore')
        .setDescription('backup.command.restore')
        .addStringOption((o) => o.setName('backup').setDescription('backup.command.options.backup').setRequired(true).setAutocomplete(true))
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('backup.command.options.mode')
            .addChoices({ name: 'backup.modes.merge', value: 'merge' }, { name: 'backup.modes.replace', value: 'replace' }),
        )
        .addBooleanOption((o) => o.setName('server_settings').setDescription('backup.command.options.settings')),
    )
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('backup.command.delete')
        .addStringOption((o) => o.setName('backup').setDescription('backup.command.options.backup').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('auto')
        .setDescription('backup.command.auto')
        .addBooleanOption((o) => o.setName('enabled').setDescription('backup.command.options.enabled').setRequired(true)),
    ),
  defer: 'ephemeral',
  cooldown: 10,
  permissions: ADMIN,
  autocomplete: backupAutocomplete,
  async run(ctx) {
    const { options } = ctx.interaction;
    const sub = options.getSubcommand();
    const config = ctx.bot.moduleConfig({ name: 'backup', config: backupConfig });

    if (sub === 'create') {
      if ((await BackupModel.countDocuments({ guildId: ctx.guild.id, automatic: false })) >= config.maxPerGuild) {
        throw new UserError('backup.errors.limit', { count: config.maxPerGuild });
      }
      const doc = await createBackup(ctx.guild, ctx.member.id, options.getString('name') ?? ctx.t('backup.defaultName'), false);
      await ctx.respond(ctx.successPanel(ctx.t('backup.created', { id: doc.backupId, roles: doc.roleCount, channels: doc.channelCount })));
      return;
    }

    if (sub === 'list') {
      const list = await BackupModel.find(accessibleBackups(ctx.guild.id, ctx.member.id), { snapshot: 0 }).sort({ createdAt: -1 }).limit(25).lean<BackupDoc[]>();
      const { auto } = await ctx.bot.settings.module(ctx.guild.id, backupSettings);
      await ctx.respond(
        ctx
          .panel()
          .title(ctx.t('backup.listTitle'))
          .text(list.map((b) => backupLine(ctx, b)).join('\n') || ctx.t('backup.empty'), `-# ${ctx.t(auto ? 'backup.autoOn' : 'backup.autoOff')}`),
      );
      return;
    }

    if (sub === 'auto') {
      const enabled = options.getBoolean('enabled', true);
      await ctx.bot.settings.updateModule(ctx.guild.id, backupSettings, { auto: enabled });
      await ctx.respond(ctx.successPanel(ctx.t(enabled ? 'backup.autoEnabled' : 'backup.autoDisabled', { hours: config.autoIntervalHours, keep: config.autoKeep })));
      return;
    }

    const doc = await findBackup(ctx, options.getString('backup', true));
    if (sub === 'delete') {
      await BackupModel.deleteOne({ backupId: doc.backupId });
      await ctx.respond(ctx.successPanel(ctx.t('backup.deleted', { id: doc.backupId })));
      return;
    }

    const mode = (options.getString('mode') ?? 'merge') as RestoreMode;
    const settings = options.getBoolean('server_settings') ?? false;
    if (mode === 'replace' && ctx.member.id !== ctx.guild.ownerId) throw new UserError('backup.errors.ownerOnly');
    await ctx.respond(
      ctx
        .panel()
        .title(ctx.t('backup.confirm.title'))
        .text(backupLine(ctx, doc), ctx.t(`backup.confirm.${mode}`), settings ? ctx.t('backup.confirm.settings') : null, ctx.t('backup.confirm.botRole'))
        .row(
          new ButtonBuilder()
            .setCustomId(`backup:restore:${doc.backupId}:${mode}:${settings ? 1 : 0}`)
            .setStyle(mode === 'replace' ? ButtonStyle.Danger : ButtonStyle.Primary)
            .setLabel(ctx.t('backup.confirm.button')),
        ),
    );
  },
});

function reportText(ctx: GuildContext, r: RestoreReport): string {
  return ctx.t('backup.done', { created: r.created, updated: r.updated, deleted: r.deleted, skipped: r.skipped });
}

const confirmRestore = defineComponent({
  kind: 'button',
  id: 'backup:restore',
  permissions: ADMIN,
  async run(ctx, [backupId, mode, settings]) {
    if (!backupId || (mode !== 'merge' && mode !== 'replace')) throw new UserError('errors.expired');
    if (mode === 'replace' && ctx.member.id !== ctx.guild.ownerId) throw new UserError('backup.errors.ownerOnly');
    const me = ctx.guild.members.me ?? (await ctx.guild.members.fetchMe());
    // Setting channel permissions the bot doesn't hold itself needs Administrator.
    if (!me.permissions.has(PermissionFlagsBits.Administrator)) throw new UserError('backup.errors.botAdmin');
    const doc = await findBackup(ctx, backupId);
    if (restoring.has(ctx.guild.id)) throw new UserError('backup.errors.running');

    restoring.add(ctx.guild.id);
    try {
      await ctx.update(ctx.panel().text(ctx.t('backup.restoring')));
      const report = await restoreBackup(ctx.guild, doc.snapshot, { mode, settings: settings === '1', keepChannelId: ctx.interaction.channelId });
      const result = ctx.successPanel(reportText(ctx, report));
      // Big restores can outlive the 15 minute interaction window; post the result directly then.
      await ctx.interaction.editReply(result.render()).catch(async () => {
        const sent = await ctx.interaction.channel?.send({ content: userMention(ctx.member.id), ...result.render() }).catch(() => null);
        if (!sent) await ctx.member.send(result.render()).catch(() => undefined);
      });
      ctx.bot.logger.info({ guild: ctx.guild.id, backup: doc.backupId, mode, ...report }, 'backup restored');
    } finally {
      restoring.delete(ctx.guild.id);
    }
  },
});

let stopAuto: (() => void) | undefined;

export default defineModule({
  name: 'backup',
  toggleable: true,
  config: backupConfig,
  guildSettings: backupSettings.guildSettings,
  commands: [backup],
  components: [confirmRestore],
  start(bot) {
    stopAuto = startAutoBackups(bot);
  },
  stop() {
    stopAuto?.();
  },
});
