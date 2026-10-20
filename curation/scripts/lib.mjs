// Shared helpers for the curation scripts. Everything fetched from a remote instance is
// untrusted input (docs/CURATION_STRATEGY.md §9.2): strings are cleaned and capped, hosts are
// checked before every request, and redirects are refused rather than followed.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RECORDS = join(ROOT, "records");
export const SEPIA = "https://search.joinpeertube.org";
const UA = "MultiverseVideoCuration/0.1 (+https://video.multiversegames.ai)";

/** Strip control and bidi-override characters, collapse whitespace, cap length. */
export function clean(s, max = 500) {
  if (typeof s !== "string") return null;
  const t = s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
  return t ? (t.length > max ? t.slice(0, max - 1) + "…" : t) : null;
}

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^22[4-9]\./, /^2[3-5]\d\./];
function privateAddress(addr) {
  if (isIP(addr) === 4) return PRIVATE_V4.some((r) => r.test(addr));
  const a = addr.toLowerCase();
  return a === "::1" || a === "::" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80") || a.startsWith("::ffff:");
}

/** A public DNS host name (not an IP literal, not a local-only name) that resolves only to public addresses. */
export async function assertPublicHost(host) {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) || isIP(host)) throw new Error(`not a public host name: ${host}`);
  if (/(^|\.)(localhost|local|internal|lan|home\.arpa)$/i.test(host)) throw new Error(`local host name: ${host}`);
  const addrs = await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw new Error(`resolves to a private address: ${host}`);
}

/** GET JSON over https from a checked public host. Redirects are errors (they would skip the host check). */
export async function getJson(url, { timeoutMs = 15000 } = {}) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error(`not https: ${url}`);
  await assertPublicHost(u.hostname);
  const res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json", "user-agent": UA } });
  if (res.status >= 300 && res.status < 400) throw new Error(`redirect refused (${res.status}) for ${url}`);
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { status: res.status });
  const text = await res.text();
  if (text.length > 2_000_000) throw new Error(`response too large: ${url}`);
  return JSON.parse(text);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Canonical watch URL and record id for a video on its origin instance. */
export function canonical(host, uuid) {
  if (!/^[0-9a-f-]{36}$/.test(uuid)) throw new Error(`bad uuid: ${uuid}`);
  return { url: `https://${host}/videos/watch/${uuid}`, id: `${host}__${uuid}` };
}

export function readRecords() {
  return readdirSync(RECORDS)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: join(RECORDS, f), rec: JSON.parse(readFileSync(join(RECORDS, f), "utf8")) }));
}

export function writeRecord(file, rec) {
  writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
}

export const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

/** Append a status transition to the record's audit log (§8: keep an audit log of transitions). */
export function transition(rec, to, by, note = null) {
  const from = rec.editorial.status;
  rec.editorial.status = to;
  rec.audit.push({ at: now(), from, to, by, note });
}
