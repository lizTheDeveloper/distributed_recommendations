// String helpers shared by every module. PROTOCOL.md "Conventions": strings shown
// to users must not contain control characters or bidi overrides.

// U+0000–U+001F, U+007F–U+009F, U+202A–U+202E, U+2066–U+2069.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** Strip control and bidi-override characters, collapse whitespace, cap the length. */
export function cleanDisplay(s: unknown, max = 200): string {
  if (typeof s !== 'string') return '';
  const out = s.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
  return out.length > max ? out.slice(0, max) : out;
}

/** True when the string holds no control or bidi-override characters. */
export function isSafeDisplay(s: string): boolean {
  UNSAFE.lastIndex = 0;
  return !UNSAFE.test(s);
}

/** Case- and width-insensitive form for matching tags and keywords. */
export function fold(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim();
}

/** A hashtag as stored in block lists: folded, without a leading `#`. */
export function normTag(s: string): string {
  return fold(s).replace(/^#+/, '');
}

export const HEX64 = /^[0-9a-f]{64}$/;

/** `host` from `https://host/...`, lowercased; undefined if not a URL. */
export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    return u.host.toLowerCase();
  } catch {
    return undefined;
  }
}

/** A bare host (`tube.example`, optionally with a port), lowercased; throws otherwise. */
export function normHost(input: string): string {
  const s = input.trim().toLowerCase();
  const h = /^[a-z][a-z0-9+.-]*:\/\//.test(s) ? hostOf(s) : s.replace(/\/+$/, '');
  if (!h || !/^[a-z0-9.-]+(:\d{1,5})?$/.test(h) || !h.includes('.') && !h.startsWith('localhost')) {
    throw new TypeError(`not a host: ${input}`);
  }
  return h;
}

/** A PeerTube handle `name@host`, lowercased, without a leading `@`; throws otherwise. */
export function normHandle(input: string): string {
  const s = input.trim().replace(/^@/, '').toLowerCase();
  const m = /^([a-z0-9_.\-]+)@([a-z0-9.\-]+(?::\d{1,5})?)$/.exec(s);
  if (!m) throw new TypeError(`not a name@host handle: ${input}`);
  return `${m[1]}@${m[2]}`;
}

/** True when `host` is `blocked` or a subdomain of it. */
export function hostMatches(host: string, blocked: string): boolean {
  return host === blocked || host.endsWith('.' + blocked);
}
