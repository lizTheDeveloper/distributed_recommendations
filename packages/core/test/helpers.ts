import type { Candidate, SourceKind, Video } from "../src/types.ts";

export const NOW = new Date("2026-10-19T12:00:00Z");
const DAY = 86_400_000;

export function video(n: number | string, opts: Partial<Video> & { ageDays?: number } = {}): Video {
  const { ageDays = 1, ...rest } = opts;
  return {
    id: `https://tube.example/videos/watch/${n}`,
    title: `Video ${n}`,
    creator: `creator${n}@tube.example`,
    durationSec: 600,
    publishedAt: new Date(NOW.getTime() - ageDays * DAY),
    tags: [],
    ...rest,
  };
}

export function cand(v: Video, kind: SourceKind, via?: string, strength?: number): Candidate {
  const source: Candidate["source"] = { kind };
  if (via !== undefined) source.via = via;
  if (strength !== undefined) source.strength = strength;
  return { video: v, source };
}
