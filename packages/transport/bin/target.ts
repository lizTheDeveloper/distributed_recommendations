// Entry point for the Nostr gateway target (infra/ohttp/gateway runs this).
//
// Environment:
//   NOSTR_RELAYS         comma-separated ws:// or wss:// URLs (required)
//   PORT                 default 8080
//   HOST                 default 0.0.0.0
//   ALLOWED_KINDS        comma-separated kinds; default "1059"; "*" allows any kind
//   UPSTREAM_TIMEOUT_MS  per relay operation, default 5000
//   RATE_GLOBAL          "rate/burst" requests per second for the whole target, default 50/200
//   RATE_RECIPIENT       "rate/burst" publishes per second per recipient key, default 0.5/60
//   RATE_QUERY           "rate/burst" queries per second per #p set, default 1/30
//
// Logs: one startup line and fatal errors. Never request data.

import { createTarget, serveTarget } from '../src/target.ts';
import { WsUpstream } from '../src/upstream.ts';
import type { BucketSpec } from '../src/ratelimit.ts';

function spec(name: string): BucketSpec | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const m = /^(\d+(?:\.\d+)?)\/(\d+)$/.exec(v);
  if (!m) throw new Error(`${name} must look like "rate/burst", e.g. 50/200`);
  return { rate: Number(m[1]), burst: Number(m[2]) };
}

const relays = (process.env.NOSTR_RELAYS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (relays.length === 0) {
  console.error('target: set NOSTR_RELAYS');
  process.exit(2);
}
const kindsEnv = (process.env.ALLOWED_KINDS ?? '1059').trim();
const allowedKinds = kindsEnv === '*' ? [] : kindsEnv.split(',').map((k) => Number(k.trim()));
if (allowedKinds.some((k) => !Number.isInteger(k) || k < 0 || k > 65535)) {
  console.error('target: ALLOWED_KINDS must be integers or "*"');
  process.exit(2);
}

const upstream = new WsUpstream({ relays, timeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS ?? 5000) });
const target = createTarget({
  upstream,
  allowedKinds,
  limits: { global: spec('RATE_GLOBAL'), perRecipient: spec('RATE_RECIPIENT'), perQuery: spec('RATE_QUERY') },
});
const port = Number(process.env.PORT ?? 8080);
const server = await serveTarget(target, { port, host: process.env.HOST ?? '0.0.0.0' });
console.error(`target: listening on :${port}, ${upstream.relays.length} upstream relay(s), kinds ${allowedKinds.length ? allowedKinds.join(',') : 'any'}`);

const stop = () => {
  server.close();
  target.close();
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
