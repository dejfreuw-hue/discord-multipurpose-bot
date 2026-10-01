import { ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { Panel } from '../src/core/ui/panel.js';

function build(v2: boolean) {
  return new Panel(0x123456, v2)
    .title('Title')
    .fields([{ name: 'A', value: '1' }])
    .text('Body')
    .fields([{ name: 'B', value: '2', inline: true }])
    .footer('Footer')
    .row(new ButtonBuilder().setCustomId('x:y').setLabel('Go').setStyle(ButtonStyle.Primary))
    .render();
}

describe('Panel', () => {
  it('renders a Components V2 container', () => {
    const msg = build(true);
    expect(msg.flags).toBe(MessageFlags.IsComponentsV2);
    const json = msg.components[0]!.toJSON() as { type: number; accent_color: number; components: { type: number }[] };
    expect(json.type).toBe(ComponentType.Container);
    expect(json.accent_color).toBe(0x123456);
    expect(json.components.at(-1)!.type).toBe(ComponentType.ActionRow);
  });

  it('falls back to an embed with fields kept in reading order', () => {
    const msg = build(false);
    expect(msg.flags).toBeUndefined();
    const embed = msg.embeds![0]!.toJSON();
    expect(embed.description).toBe('**A**\n1\n\nBody');
    expect(embed.fields).toEqual([{ name: 'B', value: '2', inline: true }]);
    expect(msg.components).toHaveLength(1);
  });
});
