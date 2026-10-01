import { z } from 'zod';

export const coreConfig = z.object({
  help: z
    .strictObject({
      showDisabled: z.boolean().default(false),
    })
    .prefault({}),
});
