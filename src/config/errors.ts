import type { z } from 'zod';

/** Thrown for any problem the person running the bot has to fix by hand. The message is printed as-is. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function describeIssues(source: string, issues: readonly z.core.$ZodIssue[], prefix: PropertyKey[] = []): string {
  const lines = issues.map((issue) => {
    const path = [...prefix, ...issue.path].map(String).join('.');
    return `  - ${path || '(top level)'}: ${readableMessage(issue)}`;
  });
  const count = issues.length === 1 ? '1 problem' : `${issues.length} problems`;
  return `${source} has ${count}:\n${lines.join('\n')}`;
}

function readableMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_type' && issue.message.endsWith('received undefined')) {
    return `this setting is missing (expected ${issue.expected})`;
  }
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys.map((k) => `"${k}"`).join(', ');
    return `unknown setting ${keys}. Check the spelling against the comments in the file`;
  }
  return issue.message.replace(/^Invalid input: /, '');
}
