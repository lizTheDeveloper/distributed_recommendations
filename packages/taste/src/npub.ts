// NIP-19 npub encoding (bech32, BIP-173), dependency-free so the browser bundle
// doesn't need nostr-tools' nip19. Same algorithm as apps/web/src/lib/bech32.ts.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
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

const hrpExpand = (hrp: string) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];

function convert(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & max);
  } else if (bits >= from || ((acc << (to - bits)) & max)) return null;
  return out;
}

/** 64-hex pubkey -> `npub1…`. */
export function npubEncode(hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new TypeError('pubkey must be 64 lowercase hex characters');
  const bytes = hex.match(/../g)!.map((h) => parseInt(h, 16));
  const data = convert(bytes, 8, 5, true)!;
  const chk = polymod([...hrpExpand('npub'), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const sum = Array.from({ length: 6 }, (_, i) => (chk >>> (5 * (5 - i))) & 31);
  return 'npub1' + [...data, ...sum].map((d) => CHARSET[d]).join('');
}

/** `npub1…` -> 64-hex pubkey, or null. */
export function npubDecode(npub: string): string | null {
  const s = npub.trim().toLowerCase();
  if (!s.startsWith('npub1') || s.length !== 63) return null;
  const data = [...s.slice(5)].map((c) => CHARSET.indexOf(c));
  if (data.some((d) => d < 0)) return null;
  if (polymod([...hrpExpand('npub'), ...data]) !== 1) return null;
  const bytes = convert(data.slice(0, -6), 5, 8, false);
  if (!bytes || bytes.length !== 32) return null;
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}
