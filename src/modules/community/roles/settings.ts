import { z } from 'zod';
import type { SettingsSlice } from '../../../core/guild-settings.js';

const guildSettings = z.object({
  /** Given to every new human member, after they pass membership screening if the server uses it. */
  humanRoles: z.array(z.string()).default([]),
  botRoles: z.array(z.string()).default([]),
});

export const rolesSettings: SettingsSlice<typeof guildSettings> = { name: 'roles', guildSettings };
