// NIP-19 `npub` / `nsec` encoding (bech32, BIP-173). Small enough to keep here
// rather than pull nostr-tools' nip19 into the app's own import graph.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (value < 0 || value >> from) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
    return null;
  }
  return out;
}

export function bech32Encode(hrp: string, bytes: Uint8Array): string {
  const data = convertBits(bytes, 8, 5, true)!;
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ 1;
  const checksum: number[] = [];
  for (let p = 0; p < 6; p++) checksum.push((mod >> (5 * (5 - p))) & 31);
  return hrp + "1" + [...data, ...checksum].map((d) => CHARSET[d]).join("");
}

export function bech32Decode(text: string): { hrp: string; bytes: Uint8Array } | null {
  if (text.length > 200 || text !== text.toLowerCase()) return null;
  const pos = text.lastIndexOf("1");
  if (pos < 1 || pos + 7 > text.length) return null;
  const hrp = text.slice(0, pos);
  const data: number[] = [];
  for (const c of text.slice(pos + 1)) {
    const d = CHARSET.indexOf(c);
    if (d < 0) return null;
    data.push(d);
  }
  if (polymod([...hrpExpand(hrp), ...data]) !== 1) return null;
  const bytes = convertBits(data.slice(0, -6), 5, 8, false);
  return bytes ? { hrp, bytes: new Uint8Array(bytes) } : null;
}

export const HEX64 = /^[0-9a-f]{64}$/;

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function npubEncode(pubkeyHex: string): string {
  return bech32Encode("npub", hexToBytes(pubkeyHex));
}

export function nsecEncode(secretHex: string): string {
  return bech32Encode("nsec", hexToBytes(secretHex));
}

function decodeKey(text: string, hrp: "npub" | "nsec"): string | null {
  const t = text.trim().toLowerCase().replace(/^nostr:/, "");
  if (HEX64.test(t)) return t;
  const d = bech32Decode(t);
  if (!d || d.hrp !== hrp || d.bytes.length !== 32) return null;
  return bytesToHex(d.bytes);
}

/** An `npub1…` (or `nostr:npub1…`, or 64-hex) to a hex public key, or null. */
export function parseNpub(text: string): string | null {
  return decodeKey(text, "npub");
}

/** An `nsec1…` (or 64-hex) to a hex secret key, or null. */
export function parseNsec(text: string): string | null {
  return decodeKey(text, "nsec");
}

/** First valid npub mentioned in free text (a channel description, a taste-list author). */
export function findNpub(text: string | undefined | null): string | null {
  if (!text) return null;
  for (const m of text.matchAll(/(?:nostr:)?(npub1[02-9ac-hj-np-z]{58})/g)) {
    const hex = parseNpub(m[1]);
    if (hex) return hex;
  }
  return null;
}

/** "npub1abcd…wxyz" for compact display. */
export function shortNpub(pubkeyHex: string): string {
  const n = npubEncode(pubkeyHex);
  return `${n.slice(0, 10)}…${n.slice(-4)}`;
}
