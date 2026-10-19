#!/usr/bin/env -S node --experimental-strip-types
// match-feed-bridge: PeerTube channel -> NIP-71 events. Dry run by default.

import { parseArgs } from 'node:util';
import { ephemeralSigner, parseSecretKey, secretKeySigner, verifySignedEvent } from './nostr-signer.ts';
import type { Signer } from './event.ts';
import type { KindPolicy, NsfwPolicy } from './mapping.ts';
import { sync } from './sync.ts';
import type { SyncResult } from './sync.ts';

const USAGE = `Usage: match-feed-bridge sync --instance <host> --channel <name[@host]> [options]

Lists a PeerTube channel's videos (newest first) and builds NIP-71 video events.
Default is a DRY RUN: events are printed to stdout as JSON, nothing is sent.

Options:
  --limit <n>               videos to process (default 10)
  --regular                 use regular kinds 21/22 instead of addressable 34235/34236
  --kind auto|normal|short  normal/short selection (default auto: portrait and short duration)
  --short-max-duration <s>  auto mode: portrait videos longer than this stay normal (default 180)
  --nsfw warn|skip          NSFW videos: add content-warning (default) or skip them
  --mp4-first               list progressive MP4 imeta before the HLS playlist
  --mirrors                 add PeerTube redundancy mirrors as imeta fallbacks (best effort)
  --magnet                  include magnet URIs in imeta (P2P exposes viewer IPs)
  --no-extras               don't fetch captions/chapters
  --creator-pubkey <hex>    add a p tag for the creator (when an instance key signs)
  --ephemeral-key           dry run: sign with a throwaway key to show complete events
  --publish                 sign with NOSTR_SECRET_KEY (hex or nsec) and send to --relay
  --relay <wss://…>         relay URL (repeatable; required with --publish)
  --quiet                   no progress on stderr
  -h, --help

The secret key is read only from the NOSTR_SECRET_KEY environment variable,
never from argv, so it does not end up in shell history or process listings.`;

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n\n${USAGE}\n`);
  process.exit(2);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      instance: { type: 'string' },
      channel: { type: 'string' },
      limit: { type: 'string', default: '10' },
      regular: { type: 'boolean', default: false },
      kind: { type: 'string', default: 'auto' },
      'short-max-duration': { type: 'string' },
      nsfw: { type: 'string', default: 'warn' },
      'mp4-first': { type: 'boolean', default: false },
      mirrors: { type: 'boolean', default: false },
      magnet: { type: 'boolean', default: false },
      'no-extras': { type: 'boolean', default: false },
      'creator-pubkey': { type: 'string' },
      'ephemeral-key': { type: 'boolean', default: false },
      publish: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      relay: { type: 'string', multiple: true, default: [] },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(USAGE + '\n');
    return;
  }
  if (positionals[0] !== 'sync') fail('expected the "sync" command');
  if (!values.instance || !values.channel) fail('--instance and --channel are required');
  if (values.publish && values['dry-run']) fail('--publish and --dry-run are mutually exclusive');
  const kind = values.kind as KindPolicy;
  if (!['auto', 'normal', 'short'].includes(kind)) fail('--kind must be auto, normal or short');
  const nsfw = values.nsfw as NsfwPolicy;
  if (!['warn', 'skip'].includes(nsfw)) fail('--nsfw must be warn or skip');
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1) fail('--limit must be a positive integer');
  const smd = values['short-max-duration'];
  const shortMaxDuration = smd === undefined ? undefined : Number(smd);
  if (shortMaxDuration !== undefined && !(shortMaxDuration > 0)) fail('--short-max-duration must be a positive number');
  const relays = values.relay as string[];

  let signer: Signer | null = null;
  if (values.publish) {
    const sk = process.env.NOSTR_SECRET_KEY;
    if (!sk) fail('--publish requires NOSTR_SECRET_KEY in the environment');
    if (relays.length === 0) fail('--publish requires at least one --relay');
    signer = secretKeySigner(parseSecretKey(sk));
  } else if (process.env.NOSTR_SECRET_KEY) {
    signer = secretKeySigner(parseSecretKey(process.env.NOSTR_SECRET_KEY));
  } else if (values['ephemeral-key']) {
    signer = ephemeralSigner();
  }

  const log = (s: string) => {
    if (!values.quiet) process.stderr.write(s + '\n');
  };
  log(
    `${values.publish ? 'PUBLISH' : 'DRY RUN'}: ${values.channel} on ${values.instance}` +
      (signer ? ` as ${await signer.getPublicKey()}` : ' (unsigned templates)') +
      (values.publish ? ` -> ${relays.join(', ')}` : ''),
  );

  const counts: Record<SyncResult['status'], number> = { built: 0, refused: 0, published: 0, error: 0 };
  await sync(values.instance, values.channel, signer, relays, {
    publish: values.publish,
    limit,
    addressable: !values.regular,
    kind,
    shortMaxDuration,
    nsfw,
    order: values['mp4-first'] ? 'mp4-first' : 'hls-first',
    includeMirrors: values.mirrors,
    includeMagnet: values.magnet,
    fetchExtras: !values['no-extras'],
    creatorPubkey: values['creator-pubkey'],
    verify: verifySignedEvent,
    onResult: (r) => {
      counts[r.status]++;
      const imetas = r.template?.tags.filter((t) => t[0] === 'imeta').length ?? 0;
      const detail =
        r.status === 'refused' || r.status === 'error'
          ? r.reason
          : `kind ${r.template!.kind}, ${imetas} imeta` +
            (r.relays ? `; ${r.relays.map((x) => `${x.relay}: ${x.ok ? 'ok' : 'FAIL'} ${x.message}`).join('; ')}` : '');
      log(`  [${r.status}] ${r.uuid} ${JSON.stringify(r.title)} — ${detail}`);
      if (r.status === 'built' || r.status === 'published') {
        process.stdout.write(JSON.stringify(r.event ?? r.template) + '\n');
      }
    },
  });
  log(`done: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  if (counts.error > 0) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`error: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
