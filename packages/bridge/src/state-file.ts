// Node-only persistence for state.ts. Writes go to a temp file that is then
// renamed, so a crash leaves either the old or the new state.

import { readFile, rename, writeFile } from 'node:fs/promises';
import { emptyState, parseState } from './state.ts';
import type { BridgeState } from './state.ts';

/** Missing file -> empty state. A malformed file is an error (never silently reset). */
export async function loadState(path: string): Promise<BridgeState> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    throw err;
  }
  return parseState(text);
}

export async function saveState(path: string, state: BridgeState): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o644 });
  await rename(tmp, path);
}

