import {
  MessageFlags,
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  type ModalSubmitInteraction,
  type RepliableInteraction,
} from 'discord.js';
import type { Bot } from './bot.js';
import type { GuildSettingsData } from './guild-settings.js';
import type { Vars } from './i18n.js';
import type { DeferMode } from './module.js';
import { Panel, type PanelMessage } from './ui/panel.js';

export const ERROR_COLOR = 0xed4245;
export const SUCCESS_COLOR = 0x57f287;

// discord.js types reply/editReply differently on every interaction class, which makes calls
// on a generic interaction impossible to type. This is the shape they all share.
interface Respondable {
  deferred: boolean;
  replied: boolean;
  reply(options: InteractionReplyOptions): Promise<unknown>;
  editReply(options: InteractionEditReplyOptions): Promise<unknown>;
  followUp(options: InteractionReplyOptions): Promise<unknown>;
  deleteReply(): Promise<void>;
  update?(options: InteractionUpdateOptions): Promise<unknown>;
}

type Sendable = Panel | PanelMessage;

/** Everything a command or component handler needs: the interaction, the bot, settings and translations. */
export class InteractionContext<I extends RepliableInteraction = RepliableInteraction> {
  deferMode: DeferMode = false;

  constructor(
    readonly bot: Bot,
    readonly interaction: I,
    public settings: GuildSettingsData | null,
  ) {}

  get guild(): Guild | null {
    return this.interaction.inCachedGuild() ? this.interaction.guild : null;
  }

  get member(): GuildMember | null {
    return this.interaction.inCachedGuild() ? this.interaction.member : null;
  }

  get locale(): string {
    if (this.guild) return this.settings?.locale ?? this.bot.config.bot.locale;
    return this.bot.i18n.fromDiscord(this.interaction.locale) ?? this.bot.config.bot.locale;
  }

  get color(): number {
    return this.settings?.color ?? this.bot.config.bot.color;
  }

  t(key: string, vars?: Vars): string {
    return this.bot.i18n.t(this.locale, key, vars);
  }

  panel(): Panel {
    return this.bot.panel(this.color);
  }

  errorPanel(text: string): Panel {
    return this.bot.panel(ERROR_COLOR).text(text);
  }

  successPanel(text: string): Panel {
    return this.bot.panel(SUCCESS_COLOR).text(text);
  }

  /** Sends the main response, editing the deferred reply if there is one. */
  async respond(message: Sendable): Promise<void> {
    const msg = toMessage(message);
    const i = this.raw;
    if (i.deferred || i.replied) await i.editReply(msg);
    else await i.reply(msg);
  }

  /** Sends a message only the user can see, no matter how the interaction was deferred. */
  async whisper(message: Sendable): Promise<void> {
    const msg = toMessage(message);
    const options: InteractionReplyOptions = { ...msg, flags: withEphemeral(msg) };
    const i = this.raw;
    if (i.deferred || i.replied) await i.followUp(options);
    else await i.reply(options);
  }

  /** Shows an error to the user only. Used by the router; handlers usually throw a UserError instead. */
  async fail(message: Sendable): Promise<void> {
    const i = this.raw;
    if (this.deferMode === 'public' && i.deferred && !i.replied) {
      // A public "thinking..." placeholder would turn the error into a public message.
      // Swap it for an ephemeral follow-up instead.
      await i.deleteReply().catch(() => undefined);
      await i.followUp({ ...toMessage(message), flags: withEphemeral(toMessage(message)) });
      return;
    }
    if (this.deferMode === 'ephemeral' && i.deferred && !i.replied) {
      await i.editReply(toMessage(message));
      return;
    }
    await this.whisper(message);
  }

  protected get raw(): Respondable {
    return this.interaction as unknown as Respondable;
  }
}

export class ComponentInteractionContext<
  I extends ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction,
> extends InteractionContext<I> {
  /** Edits the message the component is attached to. */
  async update(message: Sendable): Promise<void> {
    const msg = toMessage(message);
    const i = this.raw;
    if (i.deferred || i.replied) await i.editReply(msg);
    else if (i.update) await i.update(msg);
    else await i.reply(msg);
  }
}

interface InGuild {
  readonly guild: Guild;
  readonly member: GuildMember;
  settings: GuildSettingsData;
}

export type GuildContext<I extends RepliableInteraction = RepliableInteraction<'cached'>> = InteractionContext<I> & InGuild;

export type CommandContext<G extends boolean = boolean> = G extends true
  ? InteractionContext<ChatInputCommandInteraction<'cached'>> & InGuild
  : InteractionContext<ChatInputCommandInteraction>;

export type ComponentContext<
  I extends ButtonInteraction<'cached'> | AnySelectMenuInteraction<'cached'> | ModalSubmitInteraction<'cached'> =
    | ButtonInteraction<'cached'>
    | AnySelectMenuInteraction<'cached'>
    | ModalSubmitInteraction<'cached'>,
> = ComponentInteractionContext<I> & InGuild;

function toMessage(message: Sendable): PanelMessage {
  return message instanceof Panel ? message.render() : message;
}

function withEphemeral(message: PanelMessage): InteractionReplyOptions['flags'] {
  return message.flags ? [MessageFlags.Ephemeral, message.flags] : [MessageFlags.Ephemeral];
}
