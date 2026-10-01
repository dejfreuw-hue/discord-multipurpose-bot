import {
  ActionRowBuilder,
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';

export interface PanelField {
  name: string;
  value: string;
  inline?: boolean;
}

type Block = { kind: 'text'; text: string } | { kind: 'fields'; fields: PanelField[] } | { kind: 'divider' };

export type PanelRow = ActionRowBuilder<MessageActionRowComponentBuilder>;

export type PanelMessage =
  | { components: ContainerBuilder[]; flags: MessageFlags.IsComponentsV2; embeds?: never }
  | { embeds: EmbedBuilder[]; components: PanelRow[]; flags?: never };

/**
 * A message layout that renders as a Components V2 container, or as a classic embed with
 * action rows when V2 is turned off in config.yml. Build it once and send it anywhere.
 */
export class Panel {
  private heading?: string;
  private thumbnailUrl?: string;
  private imageUrl?: string;
  private footerText?: string;
  private readonly blocks: Block[] = [];
  private readonly rows: PanelRow[] = [];

  constructor(
    private color: number,
    private readonly v2: boolean,
  ) {}

  title(text: string): this {
    this.heading = text;
    return this;
  }

  text(...lines: (string | false | null | undefined)[]): this {
    const text = lines.filter((l): l is string => typeof l === 'string').join('\n');
    if (text) this.blocks.push({ kind: 'text', text });
    return this;
  }

  fields(fields: PanelField[]): this {
    if (fields.length > 0) this.blocks.push({ kind: 'fields', fields });
    return this;
  }

  divider(): this {
    this.blocks.push({ kind: 'divider' });
    return this;
  }

  thumbnail(url: string | null | undefined): this {
    if (url) this.thumbnailUrl = url;
    return this;
  }

  image(url: string | null | undefined): this {
    if (url) this.imageUrl = url;
    return this;
  }

  footer(text: string): this {
    this.footerText = text;
    return this;
  }

  accent(color: number): this {
    this.color = color;
    return this;
  }

  row(...components: MessageActionRowComponentBuilder[]): this {
    if (components.length > 0) this.rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(components));
    return this;
  }

  render(): PanelMessage {
    return this.v2 ? this.renderContainer() : this.renderEmbed();
  }

  private renderContainer(): PanelMessage {
    const container = new ContainerBuilder().setAccentColor(this.color);
    const blocks = [...this.blocks];

    if (this.thumbnailUrl) {
      // A section needs at least one text display next to its accessory, so the heading
      // and the first text block share it.
      const first = blocks[0]?.kind === 'text' ? (blocks.shift() as { text: string }).text : undefined;
      const texts = [this.heading && `## ${this.heading}`, first].filter((t): t is string => Boolean(t));
      if (texts.length === 0) texts.push('​');
      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(texts.map((t) => new TextDisplayBuilder().setContent(t)))
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(this.thumbnailUrl)),
      );
    } else if (this.heading) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${this.heading}`));
    }

    for (const block of blocks) {
      if (block.kind === 'divider') {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
      } else if (block.kind === 'text') {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block.text));
      } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fieldsToMarkdown(block.fields)));
      }
    }

    if (this.imageUrl) {
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(this.imageUrl)));
    }
    if (this.footerText) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${this.footerText}`));
    }
    if (this.rows.length > 0) {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
      container.addActionRowComponents(this.rows);
    }

    return { components: [container], flags: MessageFlags.IsComponentsV2 };
  }

  private renderEmbed(): PanelMessage {
    const embed = new EmbedBuilder().setColor(this.color);
    if (this.heading) embed.setTitle(this.heading);
    if (this.thumbnailUrl) embed.setThumbnail(this.thumbnailUrl);
    if (this.imageUrl) embed.setImage(this.imageUrl);
    if (this.footerText) embed.setFooter({ text: this.footerText });

    // Embeds always show fields below the description, so only field blocks that come after
    // the last text block can be real fields. Earlier ones are folded into the description.
    const lastText = this.blocks.findLastIndex((b) => b.kind === 'text');
    const description: string[] = [];
    const native: PanelField[] = [];
    this.blocks.forEach((block, index) => {
      if (block.kind === 'text') description.push(block.text);
      else if (block.kind === 'fields') {
        if (index > lastText) native.push(...block.fields);
        else description.push(fieldsToMarkdown(block.fields));
      }
    });
    embed.addFields(native.slice(0, 25).map((f) => ({ name: f.name, value: f.value || '\u200b', inline: f.inline ?? false })));
    if (description.length > 0) embed.setDescription(description.join('\n\n').slice(0, 4096));

    return { embeds: [embed], components: this.rows };
  }
}

function fieldsToMarkdown(fields: PanelField[]): string {
  return fields.map((f) => `**${f.name}**\n${f.value}`).join('\n\n');
}
