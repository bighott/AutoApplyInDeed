/**
 * Zero-dependency `.env` loader.
 *
 * Reads KEY=VALUE pairs from a `.env` file (in the current working directory by
 * default) into `process.env`, without overwriting variables that are already
 * set in the real environment. This keeps secrets like SERPAPI_KEY out of the
 * source tree and out of git — the `.env` file is gitignored.
 *
 * Supported syntax: `KEY=value`, `# comments`, blank lines, optional `export `
 * prefix, and single/double quoted values. Intentionally minimal.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv(file = '.env'): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;

  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice(7) : line;
    const eq = withoutExport.indexOf('=');
    if (eq === -1) continue;

    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

/** Read a required env var or throw a clear, actionable error. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing ${name}. Add it to flight-planner/.env (copy .env.example) ` +
        `or export it in your shell: export ${name}=your_key`,
    );
  }
  return v;
}
