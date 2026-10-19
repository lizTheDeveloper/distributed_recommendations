// CLI demo: rank a live PeerTube catalog with fabricated relationships.
//
//   node --experimental-strip-types --no-warnings src/demo.ts [--instance URL] [--seed N] [--limit N]
//
// Only the catalog is real. Follows, matches, the taste list, the circle and the
// second-degree network are invented so the ranker has something to mix.

import type { Candidate, RankedItem, Video } from "./types.ts";
import {
  CHIP_LABELS,
  DEFAULT_CIRCLE_POLICY,
  DEFAULT_RECIPE,
  FOLLOWING_CHRONOLOGICAL_RECIPE,
  buildSketch,
  circleCandidates,
  createPeerTubeClient,
  decodeSketch,
  emptyCircleLedger,
  encodeSketch,
  randomHex,
  rank,
  releaseCircleEpoch,
  secondDegreeScores,
  seededRng,
  shuffle,
  sketchItems,
  tagProfile,
  tagRelevance,
  trustWalk,
} from "./index.ts";

const argv: string[] = (globalThis as { process?: { argv: string[] } }).process?.argv.slice(2) ?? [];
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const instance = arg("instance", "https://framatube.org");
const seed = Number(arg("seed", "7"));
const limit = Number(arg("limit", "16"));
const rng = seededRng(seed);
const now = new Date();
const DAY = 86_400_000;

function duration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function age(d: Date): string {
  const days = Math.floor((now.getTime() - d.getTime()) / DAY);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

function print(items: RankedItem[]): void {
  items.forEach((item, i) => {
    const v = item.video;
    const chip = `[${CHIP_LABELS[item.primary]}]`.padEnd(13);
    const title = v.title.length > 64 ? v.title.slice(0, 63) + "…" : v.title;
    console.log(`${String(i + 1).padStart(2)}. ${chip} ${title} (${duration(v.durationSec)})`);
    console.log(`    ${v.creatorName ?? v.creator} · ${v.creator.split("@")[1]} · ${age(v.publishedAt)} · score ${item.score.toFixed(2)}`);
    for (const line of item.why) console.log(`      - ${line}`);
  });
}

async function main(): Promise<void> {
  const client = createPeerTubeClient({ baseUrl: instance });
  const pages = await Promise.all([0, 100].map((start) => client.listVideos({ count: 100, start })));
  const catalog = new Map<string, Video>();
  for (const p of pages) for (const v of p.videos) catalog.set(v.id, v);
  const videos = [...catalog.values()];
  console.log(`Fetched ${videos.length} recent videos from ${instance} (${pages[0].total} known to the instance).\n`);
  if (videos.length < 20) throw new Error("not enough videos to build a demo feed");

  // Follows: the three creators with the most recent uploads.
  const byCreator = new Map<string, Video[]>();
  for (const v of videos) byCreator.set(v.creator, [...(byCreator.get(v.creator) ?? []), v]);
  const follows = [...byCreator.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 3);
  const candidates: Candidate[] = [];
  for (const [, vs] of follows) for (const v of vs) candidates.push({ video: v, source: { kind: "follow" } });

  // Everything else is the pool the fabricated peers endorse from.
  const followed = new Set(follows.map(([c]) => c));
  const pool = shuffle(videos.filter((v) => !followed.has(v.creator)), rng);
  const pick = (from: number, n: number) => pool.slice(from, from + n);

  // Matches: each sends a taste sketch; we validate it and read the real items.
  const matches: Array<[string, number, Video[]]> = [
    ["Ines Okafor", 0.64, pick(0, 8)],
    ["Theo Brandt", 0.51, [...pick(6, 2), ...pick(12, 4)]],
    ["Hand & Hearth", 0.43, pick(16, 5)],
  ];
  for (const [name, overlap, endorsed] of matches) {
    const { sketch } = buildSketch(
      endorsed.map((v) => ({ videoId: v.id, at: new Date(now.getTime() - DAY), kind: "endorse" as const })),
      { windowDays: 60, includeFinished: false, excludedTags: [], excludedHours: [], paused: false },
      { epoch: 0 },
      { now, rng },
    );
    const wire = encodeSketch(sketch);
    const received = sketchItems(decodeSketch(wire, { now }));
    console.log(`Sketch from ${name}: ${sketch.items.length} entries, ${new TextEncoder().encode(wire).length} bytes before encryption, ${received.size} real.`);
    for (const id of received) candidates.push({ video: catalog.get(id)!, source: { kind: "match", via: name, strength: overlap } });
  }

  // A public taste list.
  for (const v of pick(21, 4)) candidates.push({ video: v, source: { kind: "taste", via: "Slow Craft by @hearth", strength: 0.8 } });

  // A 12-member circle: popular picks pass the noisy threshold (3 at k = 12), one-off
  // picks mostly don't. One release per epoch, sticky noise, picks only (no counts).
  const circlePool = pick(25, 6);
  const memberIds = Array.from({ length: 12 }, (_, m) => `member-${m}`);
  const contributions = new Map(
    memberIds.map((id, m) => [
      id,
      [circlePool[0], circlePool[1], ...(m < 6 ? [circlePool[2]] : []), circlePool[3 + (m % 3)]].map((v) => v.id),
    ]),
  );
  const release = releaseCircleEpoch(
    emptyCircleLedger(),
    { epoch: 1, members: memberIds, noiseSeed: randomHex(rng, 32), contributions },
    DEFAULT_CIRCLE_POLICY,
  );
  const circle = release.ok ? release.result : { ok: false as const, members: 0, reason: "too-few-members" as const };
  candidates.push(...circleCandidates(circle, "Riso people", catalog));
  console.log(`Circle "Riso people": ${circle.ok ? circle.picks.length : 0} picks above the threshold (epoch 1, picks only).`);

  // Second degree: matches of matches, only through peers who opted in to relay.
  const graph = new Map([
    ["me", new Map([["ines", 0.64], ["theo", 0.51], ["hearth", 0.43]])],
    ["ines", new Map([["p1", 0.7], ["p2", 0.4]])],
    ["theo", new Map([["p3", 0.6]])],
    ["hearth", new Map([["p4", 0.9]])],
  ]);
  const walk = trustWalk(graph, "me", { relays: new Set(["ines", "theo"]) });
  const second = secondDegreeScores(
    walk,
    new Map([
      ["p1", pick(31, 2).map((v) => v.id)],
      ["p2", pick(32, 2).map((v) => v.id)],
      ["p3", pick(34, 2).map((v) => v.id)],
      ["p4", pick(36, 2).map((v) => v.id)],
    ]),
  );
  for (const [id, strength] of second) candidates.push({ video: catalog.get(id)!, source: { kind: "second", strength } });

  // Explore: everything else uploaded in the last two weeks, ranked on device by how
  // well its tags fit the tags of what "I" follow and my matches endorsed.
  const tied = new Set(candidates.map((c) => c.video.id));
  for (const v of videos) if (!tied.has(v.id)) candidates.push({ video: v, source: { kind: "explore" } });
  const myTaste = candidates.filter((c) => c.source.kind === "follow" || c.source.kind === "match").map((c) => c.video);
  const exploreRelevance = tagRelevance(tagProfile(myTaste));

  console.log(`\n${candidates.length} candidates. Recipe: "${DEFAULT_RECIPE.name}" (explore share ${DEFAULT_RECIPE.exploreShare}).\n`);
  const feed = rank(candidates, DEFAULT_RECIPE, { now, limit, rng, exploreRelevance });
  print(feed);
  const mix = new Map<string, number>();
  for (const item of feed) mix.set(CHIP_LABELS[item.primary], (mix.get(CHIP_LABELS[item.primary]) ?? 0) + 1);
  console.log(`\nMix: ${[...mix].map(([k, n]) => `${k} ${n}`).join(", ")}`);

  // Kinds that didn't make the first page: show where their best item landed.
  const full = rank(candidates, DEFAULT_RECIPE, { now, limit: candidates.length, rng: seededRng(seed), exploreRelevance });
  const shown = new Set(feed.map((i) => i.primary));
  for (const kind of ["taste", "second"] as const) {
    if (shown.has(kind)) continue;
    const at = full.findIndex((i) => i.primary === kind);
    if (at < 0) continue;
    console.log(`\nFurther down, #${at + 1} [${CHIP_LABELS[kind]}] ${full[at].video.title} (score ${full[at].score.toFixed(2)})`);
    for (const line of full[at].why) console.log(`      - ${line}`);
  }

  console.log(`\nRecipe: "${FOLLOWING_CHRONOLOGICAL_RECIPE.name}" (top 5)\n`);
  print(rank(candidates, FOLLOWING_CHRONOLOGICAL_RECIPE, { now, limit: 5, rng }));
}

main().catch((e: unknown) => {
  console.error(`demo failed: ${e instanceof Error ? e.message : String(e)}`);
  const proc = (globalThis as { process?: { exitCode?: number } }).process;
  if (proc) proc.exitCode = 1;
});
