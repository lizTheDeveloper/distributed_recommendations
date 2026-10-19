import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import type { IdentitySigner } from '../src/client.ts';
import type { HistoryEntry } from '../src/core.ts';
import type { NostrEventLike } from '../src/network.ts';
import type { GroupView, ReceivedRoundMessage, RoundMessage } from '../src/round.ts';
import { CircleRoundEngine } from '../src/round.ts';

export const T0 = new Date('2026-10-19T12:00:00Z');
export const HOUR = 3_600_000;

export function testClock(start: Date = T0) {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export function video(n: number): string {
  return `https://tube.example/videos/watch/${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

export function endorse(ids: number[], at: Date): HistoryEntry[] {
  return ids.map((n) => ({ videoId: video(n), at, kind: 'endorse' as const, tags: [] }));
}

export function localIdentity(): { signer: IdentitySigner; pubkey: string } {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  return {
    pubkey,
    signer: {
      getPublicKey: () => pubkey,
      signEvent: (t) => finalizeEvent(t, sk) as unknown as NostrEventLike,
      nip44: {
        encrypt: (p, m) => nip44.v2.encrypt(m, nip44.v2.utils.getConversationKey(sk, p)),
        decrypt: (p, c) => nip44.v2.decrypt(c, nip44.v2.utils.getConversationKey(sk, p)),
      },
    },
  };
}

export function hexId(i: number): string {
  return i.toString(16).padStart(64, '0');
}

/**
 * A transport-free circle for engine tests: every message goes to every member
 * (as MLS would), with a fixed per-epoch round context.
 */
export class FakeCircle {
  epoch = 5;
  readonly engines: CircleRoundEngine[];
  readonly members: string[];
  /** Messages each member received from others: what a member "sees". */
  readonly seen = new Map<string, ReceivedRoundMessage[]>();
  /** Members that stop sending (dropouts) from now on. */
  readonly silent = new Set<string>();
  /** Per receiver: senders whose messages are not delivered to it. */
  readonly blocked = new Map<string, Set<string>>();

  constructor(engines: CircleRoundEngine[]) {
    this.engines = engines;
    this.members = engines.map((e) => e.identity);
    for (const m of this.members) this.seen.set(m, []);
  }

  view(): GroupView {
    const epoch = this.epoch;
    return {
      epoch,
      members: this.members,
      roundContext: async (roundId: string) => new TextEncoder().encode(`ctx:${epoch}:${roundId}`.padEnd(32, '.')).slice(0, 32),
    };
  }

  /** Breadth-first delivery, so every member sees a message before any reply to it. */
  async broadcast(sender: string, msgs: RoundMessage[], now: Date): Promise<void> {
    const queue: { sender: string; msg: RoundMessage }[] = msgs.map((msg) => ({ sender, msg }));
    while (queue.length > 0) {
      const { sender: from, msg } = queue.shift()!;
      if (this.silent.has(from)) continue;
      const rec: ReceivedRoundMessage = { ...msg, sender: from, createdAt: Math.floor(now.getTime() / 1000) };
      for (const e of this.engines) {
        if (e.identity === from) continue;
        if (this.blocked.get(e.identity)?.has(from)) continue;
        this.seen.get(e.identity)!.push(rec);
        for (const reply of await e.receive(this.view(), rec, now)) queue.push({ sender: e.identity, msg: reply });
      }
    }
  }

  async tickAll(now: Date, histories: Map<string, HistoryEntry[]>): Promise<void> {
    for (const e of this.engines) {
      const out = await e.tick(this.view(), now, histories.get(e.identity) ?? []);
      await this.broadcast(e.identity, out, now);
    }
  }
}
