// Channel handles (`name@host`) and how people paste them.

export interface ChannelRef {
  name: string;
  host: string;
}

// Same shape core's recipe parser accepts for excludeCreators.
const NAME = /^[A-Za-z0-9_.\-]{1,100}$/;
const HOST = /^[A-Za-z0-9.\-]{1,150}(:[0-9]{1,5})?$/;

export function handleOf(c: ChannelRef): string {
  return `${c.name}@${c.host}`.toLowerCase();
}

/**
 * Accepts `name@host`, `@name@host`, or a channel URL such as
 * `https://host/video-channels/name`, `https://host/c/name/videos`.
 */
export function parseChannelInput(input: string): ChannelRef | null {
  const s = input.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    const m = /^\/(?:video-channels|c)\/([^/]+)/.exec(u.pathname);
    if (!m) return null;
    const raw = decodeURIComponent(m[1]);
    const [name, host] = raw.includes("@") ? raw.split("@", 2) : [raw, u.host];
    return valid(name, host);
  }
  const parts = s.replace(/^@/, "").split("@");
  if (parts.length !== 2) return null;
  return valid(parts[0], parts[1]);
}

function valid(name: string, host: string): ChannelRef | null {
  if (!NAME.test(name) || !HOST.test(host) || !host.includes(".")) return null;
  return { name, host: host.toLowerCase() };
}

/** Normalize an instance origin typed by the user. */
export function parseInstance(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return null;
    if (!HOST.test(u.host) || !u.host.includes(".")) return null;
    return u.origin;
  } catch {
    return null;
  }
}
