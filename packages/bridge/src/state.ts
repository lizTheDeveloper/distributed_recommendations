// Local record of what this bridge has published, so a later sync can notice
// that a video disappeared and send a NIP-09 deletion request for it.
//
// The file holds no secrets: pubkeys, event ids, PeerTube uuids/URLs and relay
// URLs. It is only written by a publishing run; dry runs read it but never
// change it. File I/O lives in state-file.ts (Node only), so this module stays
// usable in the browser.

export interface DeletionRecord {
  /** id of the kind-5 deletion request. */
  id: string;
  createdAt: number;
  reason: string;
  /** Relays that accepted the deletion request. */
  relays: string[];
}

export interface BridgedEntry {
  uuid: string;
  /** PeerTube instance origin the video was read from, e.g. https://framatube.org */
  instance: string;
  /** Channel handle as given to sync (without leading @). */
  channel: string;
  pubkey: string;
  kind: number;
  /** NIP-01 address `kind:pubkey:d` for addressable kinds. */
  address?: string;
  /** Id of the latest version known to be on the relays. */
  eventId: string;
  createdAt: number;
  url: string;
  title: string;
  /** Relays that accepted (or already held) the event. */
  relays: string[];
  status: 'live' | 'deleted';
  deletion?: DeletionRecord;
  updatedAt: number;
}

export interface BridgeState {
  version: 1;
  entries: Record<string, BridgedEntry>;
}

export const emptyState = (): BridgeState => ({ version: 1, entries: {} });

export const stateKey = (pubkey: string, uuid: string) => `${pubkey}:${uuid}`;

export function normalizeChannel(handle: string): string {
  return handle.replace(/^@/, '');
}

function isEntry(e: unknown): e is BridgedEntry {
  if (!e || typeof e !== 'object') return false;
  const x = e as Record<string, unknown>;
  return (
    typeof x.uuid === 'string' &&
    typeof x.instance === 'string' &&
    typeof x.channel === 'string' &&
    typeof x.pubkey === 'string' &&
    /^[0-9a-f]{64}$/.test(x.pubkey) &&
    Number.isInteger(x.kind) &&
    typeof x.eventId === 'string' &&
    /^[0-9a-f]{64}$/.test(x.eventId) &&
    Array.isArray(x.relays) &&
    (x.status === 'live' || x.status === 'deleted')
  );
}

export function parseState(json: string): BridgeState {
  const raw = JSON.parse(json) as unknown;
  if (!raw || typeof raw !== 'object' || (raw as BridgeState).version !== 1 || typeof (raw as BridgeState).entries !== 'object') {
    throw new Error('state file: expected {"version":1,"entries":{…}}');
  }
  const entries = (raw as BridgeState).entries;
  for (const [k, e] of Object.entries(entries)) {
    if (!isEntry(e) || k !== stateKey(e.pubkey, e.uuid)) throw new Error(`state file: malformed entry ${JSON.stringify(k)}`);
  }
  return raw as BridgeState;
}

/** Entries for one instance + channel, optionally only those signed by `pubkey`. */
export function entriesFor(state: BridgeState, instance: string, channel: string, pubkey?: string): BridgedEntry[] {
  const ch = normalizeChannel(channel);
  return Object.values(state.entries).filter((e) => e.instance === instance && e.channel === ch && (pubkey === undefined || e.pubkey === pubkey));
}
