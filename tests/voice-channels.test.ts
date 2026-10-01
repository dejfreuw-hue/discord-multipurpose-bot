import { Collection, OverwriteType, PermissionFlagsBits, PermissionsBitField, type VoiceChannel } from 'discord.js';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setHidden, setLocked, tempChannel } from '../src/modules/voice/channels.js';
import { TempChannelModel } from '../src/modules/voice/model.js';

// Needs a real MongoDB. Run with MONGODB_TEST_URI=mongodb://127.0.0.1:27017/bot-test npm test
const uri = process.env.MONGODB_TEST_URI;

/** A voice channel whose category gives the "verified" role access, the case @everyone alone can't lock. */
function fakeChannel(id: string) {
  const state = new Map<string, Record<string, boolean | null>>();
  const overwrites = new Collection([
    ['guild', { id: 'guild', type: OverwriteType.Role, allow: new PermissionsBitField(), deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel) }],
    ['verified', { id: 'verified', type: OverwriteType.Role, allow: new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]), deny: new PermissionsBitField() }],
  ]);
  const channel = {
    id,
    guild: { id: 'guild', roles: { everyone: { id: 'guild' } } },
    client: { user: { id: 'bot' } },
    members: new Collection([
      ['owner', {}],
      ['friend', {}],
    ]),
    permissionOverwrites: {
      cache: overwrites,
      async edit(target: string, options: Record<string, boolean | null>) {
        state.set(target, { ...(state.get(target) ?? {}), ...options });
      },
    },
  };
  return { channel: channel as unknown as VoiceChannel, state };
}

describe.skipIf(!uri)('join-to-create locking', () => {
  beforeAll(async () => {
    await mongoose.connect(uri!);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('locks out @everyone and roles granted by the category, but not the people inside', async () => {
    const id = `c${Date.now()}`;
    await TempChannelModel.create({ guildId: 'guild', channelId: id, ownerId: 'owner', hubId: 'hub' });
    const { channel, state } = fakeChannel(id);

    await setLocked(channel, (await tempChannel(id))!, true);
    expect(state.get('guild')).toEqual({ Connect: false });
    expect(state.get('verified')).toEqual({ Connect: false });
    expect(state.get('owner')).toEqual({ Connect: true });
    expect(state.get('friend')).toEqual({ Connect: true });
    expect(await tempChannel(id)).toMatchObject({ locked: true, lockedRoles: ['verified'] });

    await setLocked(channel, (await tempChannel(id))!, false);
    expect(state.get('guild')).toEqual({ Connect: null });
    expect(state.get('verified')).toEqual({ Connect: true });
    expect(await tempChannel(id)).toMatchObject({ locked: false, lockedRoles: [] });
  });

  it('hides the same way, independently of locking', async () => {
    const id = `h${Date.now()}`;
    await TempChannelModel.create({ guildId: 'guild', channelId: id, ownerId: 'owner', hubId: 'hub' });
    const { channel, state } = fakeChannel(id);

    await setHidden(channel, (await tempChannel(id))!, true);
    expect(state.get('verified')).toEqual({ ViewChannel: false });
    expect(state.get('owner')).toEqual({ ViewChannel: true });
    expect(await tempChannel(id)).toMatchObject({ hidden: true, hiddenRoles: ['verified'], locked: false });
  });
});
