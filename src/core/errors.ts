import type { Vars } from './i18n.js';

/**
 * An error meant for the person who used the command. The router shows it as a friendly
 * message using the locale key and does not log it as a failure.
 */
export class UserError extends Error {
  override name = 'UserError';

  constructor(
    readonly key: string,
    readonly vars?: Vars,
  ) {
    super(key);
  }
}
