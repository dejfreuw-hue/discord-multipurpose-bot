import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Both src/core (tsx) and dist/core (compiled) sit two levels below the project root.
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function fromRoot(...segments: string[]): string {
  return resolve(ROOT, ...segments);
}
