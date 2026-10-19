import type { SourceKind, Video } from "./types.ts";

/** Chip labels shown on feed cards, per source kind. */
export const CHIP_LABELS: Readonly<Record<SourceKind, string>> = {
  follow: "Following",
  taste: "Taste list",
  match: "Match",
  circle: "Circle",
  second: "2nd degree",
  explore: "Explore",
};

/** One source's contribution to a video's score. */
export interface Contribution {
  kind: SourceKind;
  via?: string;
  strength: number;
  value: number;
  /** Explore only: true when the pick was relevance-ranked on this device. */
  personalized?: boolean;
}

const DAY_MS = 86_400_000;

function fmt(x: number): string {
  return x.toFixed(2);
}

function ago(publishedAt: Date, now: Date): string {
  const days = Math.floor((now.getTime() - publishedAt.getTime()) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function linesFor(kind: SourceKind, items: Contribution[], video: Video, now: Date): string[] {
  switch (kind) {
    case "follow":
      return [`You follow ${video.creatorName ?? items[0].via ?? video.creator}`, `Posted ${ago(video.publishedAt, now)}`];
    case "taste":
      return items.map((c) => (c.via ? `In the taste list "${c.via}"` : "In a taste list you subscribe to"));
    case "match": {
      const sorted = items.slice().sort((a, b) => b.strength - a.strength);
      const lines = sorted.map((c, i) =>
        i === 0
          ? `${c.via ?? "A match"} endorsed it (overlap ${fmt(c.strength)})`
          : `${c.via ?? "Another match"} also endorsed it (${fmt(c.strength)})`,
      );
      if (sorted.length > 1) {
        const total = sorted.reduce((s, c) => s + c.strength, 0);
        lines.push(`Score: ${sorted.map((c) => fmt(c.strength)).join(" + ")} = ${fmt(total)}`);
      }
      return lines;
    }
    case "circle":
      return [
        ...items.map((c) => (c.via ? `Picked by several people in ${c.via}` : "Picked by several people in a circle")),
        "Shown only above a noised threshold, and counts are never shown, so no one pick can be traced",
      ];
    case "second": {
      // Never name anyone: not the endorser, not the match in the middle.
      const w = Math.max(...items.map((c) => c.strength));
      return ["Endorsed two or more steps out in your trust network", `Weight ×${fmt(w)}, decaying with each step; source not named`];
    }
    case "explore": {
      const days = (now.getTime() - video.publishedAt.getTime()) / DAY_MS;
      const when = days <= 7 ? "this week" : ago(video.publishedAt, now);
      return [
        `New-creator slot: uploaded ${when} by a creator you have no tie to`,
        items.some((c) => c.personalized)
          ? "Picked on this device for how well it fits what you watch; nothing was sent"
          : "Not personalized",
      ];
    }
  }
}

/**
 * Build "Why am I seeing this?" lines: the primary kind first, then the others in
 * `SOURCE_KINDS` order. Second-degree and circle lines never name a person.
 */
export function explain(
  video: Video,
  contributions: readonly Contribution[],
  primary: SourceKind,
  now: Date,
  order: readonly SourceKind[],
): string[] {
  const byKind = new Map<SourceKind, Contribution[]>();
  for (const c of contributions) {
    const list = byKind.get(c.kind) ?? [];
    list.push(c);
    byKind.set(c.kind, list);
  }
  const kinds = [primary, ...order.filter((k) => k !== primary && byKind.has(k))];
  const why: string[] = [];
  for (const kind of kinds) {
    const items = byKind.get(kind);
    if (items && items.length) why.push(...linesFor(kind, items, video, now));
  }
  return why;
}
