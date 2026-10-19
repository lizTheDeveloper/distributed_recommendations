import { generateSecretKey } from 'nostr-tools/pure';
import type { HistoryEntry, Video } from '../src/core.ts';
import { seededRng } from '../src/core.ts';
import type { NostrSigner } from '../src/keys.ts';
import { localSigner } from '../src/keys.ts';

export const T0 = new Date('2026-10-19T12:00:00Z');
export const DAY = 86_400_000;

/** A mutable test clock. */
export function testClock(start: Date = T0): { now: () => Date; advance: (days: number) => void; set: (d: Date) => void } {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    advance: (days: number) => {
      t += days * DAY;
    },
    set: (d: Date) => {
      t = d.getTime();
    },
  };
}

export function video(n: number): string {
  return `https://tube.example/videos/watch/${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

/** Endorsements of videos `ids`, one per hour going back from `now`. */
export function history(ids: number[], now: Date, kind: 'endorse' | 'finish' = 'endorse'): HistoryEntry[] {
  return ids.map((n, i) => ({ videoId: video(n), at: new Date(now.getTime() - (i + 1) * 3_600_000), kind, tags: [] }));
}

export function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i);
}

export function videoMeta(id: string, now: Date): Video {
  const n = Number(/watch\/(\d+)/.exec(id)?.[1] ?? 0);
  return {
    id,
    title: `Video ${n}`,
    creator: `creator${n % 7}@tube.example`,
    durationSec: 600,
    publishedAt: new Date(now.getTime() - (n % 10) * DAY),
    tags: [],
  };
}

export function identity(): { signer: NostrSigner; secret: Uint8Array } {
  const secret = generateSecretKey();
  return { signer: localSigner(secret), secret };
}

/** Deterministic hex ids for tests. */
export function idGen(seed: number): () => string {
  const rng = seededRng(seed);
  return () => Array.from({ length: 32 }, () => Math.floor(rng() * 256).toString(16).padStart(2, '0')).join('');
}
