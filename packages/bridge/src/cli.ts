#!/usr/bin/env -S node --experimental-strip-types
// match-feed-bridge: PeerTube channel -> NIP-71 events. Dry run by default.

import { parseArgs } from 'node:util';
import { bunkerSigner, ephemeralSigner, parseSecretKey, secretKeySigner, verifySignedEvent } from './nostr-signer.ts';
import type { ClosableSigner } from './nostr-signer.ts';
import type { Signer } from './event.ts';
import type { KindPolicy, NsfwPolicy } from './mapping.ts';
import { loadState, saveState } from './state-file.ts';
import type { BridgeState } from './state.ts';
import { sync } from './sync.ts';
import type { SyncResult } from './sync.ts';

const USAGE = `Usage: match-feed-bridge sync --instance <host> --channel <name[@host]> [options]

Lists a PeerTube channel's videos (newest first) and builds NIP-71 video events.
Default is a DRY RUN: events are printed to stdout as JSON, nothing is sent and
the state file is not changed.

Mapping:
  --limit <n>               videos to process (default 10)
  --regular                 use regular kinds 21/22 instead of addressable 34235/34236
  --kind auto|normal|short  normal/short selection (default auto: portrait and short duration)
  --short-max-duration <s>  auto mode: portrait videos longer than this stay normal (default 180)
  --nsfw warn|skip          NSFW videos: add content-warning (default) or skip them
  --mp4-first               list progressive MP4 imeta before the HLS playlist
  --mirrors                 add PeerTube redundancy mirrors as imeta fallbacks (best effort)
  --magnet                  include magnet URIs in imeta (P2P exposes viewer IPs)
  --no-extras               don't fetch captions/chapters

Signing (keys come from the environment only, never from argv):
  --signer bunker           creator's own key via a NIP-46 remote signer (preferred);
                            NOSTR_BUNKER_URL=bunker://…, optional NOSTR_BUNKER_CLIENT_KEY
  --signer key              NOSTR_SECRET_KEY is the creator's own key
  --signer instance         NOSTR_SECRET_KEY is the bridge operator's key; events say so
                            (alt text, NIP-48 proxy tag, NIP-32 label) and name the
                            creator with a p tag when --creator-pubkey is given
  --operator <name>         who runs the bridge (required with --signer instance)
  --creator-pubkey <hex>    instance mode: p tag for the creator; key/bunker mode: the
                            signer must be this pubkey
  --ephemeral-key           dry run: sign with a throwaway key to show complete events

Publishing and deletions:
  --publish                 sign and send to --relay
  --relay <wss://…>         relay URL (repeatable; required with --publish)
  --state <file.json>       record what was bridged; later runs send NIP-09 deletion
                            requests for videos that became private/unlisted/blocked
                            or were removed. Only --publish runs write it.
  --no-deletions            don't check recorded videos for deletion
  --relay-retries <n>       extra attempts for transient relay failures (default 2)
  --no-relay-auth           don't answer NIP-42 AUTH challenges
  --quiet                   no progress on stderr
  -h, --help

Proxy: run with NODE_USE_ENV_PROXY=1 (the npm script does) so that fetch and
WebSocket both use HTTPS_PROXY.`;

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n\n${USAGE}\n`);
  process.exit(2);
}

const HEX64 = /^[0-9a-f]{64}$/;

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
      signer: { type: 'string' },
      operator: { type: 'string' },
      'creator-pubkey': { type: 'string' },
      'ephemeral-key': { type: 'boolean', default: false },
      publish: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      relay: { type: 'string', multiple: true, default: [] },
      state: { type: 'string' },
      'no-deletions': { type: 'boolean', default: false },
      'relay-retries': { type: 'string', default: '2' },
      'no-relay-auth': { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      // Refuse key material on argv outright, with a helpful message.
      nsec: { type: 'string' },
      'secret-key': { type: 'string' },
      bunker: { type: 'string' },
    },
  });
  if (values.help) {
    process.stdout.write(USAGE + '\n');
    return;
  }
  if (values.nsec !== undefined || values['secret-key'] !== undefined || values.bunker !== undefined) {
    fail('secrets are never accepted on the command line; use NOSTR_SECRET_KEY or NOSTR_BUNKER_URL in the environment');
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
  const retries = Number(values['relay-retries']);
  if (!Number.isInteger(retries) || retries < 0 || retries > 10) fail('--relay-retries must be an integer 0..10');
  const relays = values.relay as string[];
  const creatorPubkey = values['creator-pubkey'];
  if (creatorPubkey !== undefined && !HEX64.test(creatorPubkey)) fail('--creator-pubkey must be 64 lowercase hex characters');

  const mode = values.signer ?? (values['ephemeral-key'] ? 'key' : undefined);
  if (mode !== undefined && !['bunker', 'key', 'instance'].includes(mode)) fail('--signer must be bunker, key or instance');
  if (values.publish && !values.signer) fail('--publish requires --signer bunker|key|instance');
  if (values.publish && values['ephemeral-key']) fail('--ephemeral-key is for dry runs only');
  if (values.publish && relays.length === 0) fail('--publish requires at least one --relay');
  if (mode === 'instance' && !values.operator?.trim()) fail('--signer instance requires --operator <name> (who runs this bridge)');
  if (mode !== 'instance' && values.operator !== undefined) fail('--operator only applies to --signer instance');

  const log = (s: string) => {
    if (!values.quiet) process.stderr.write(s + '\n');
  };
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
    log('warning: HTTPS_PROXY is set but NODE_USE_ENV_PROXY is not; fetch and WebSocket will not use the proxy');
  }

  let signer: Signer | null = null;
  let closable: ClosableSigner | undefined;
  if (mode === 'bunker') {
    const url = process.env.NOSTR_BUNKER_URL;
    if (!url) fail('--signer bunker requires NOSTR_BUNKER_URL in the environment');
    const ck = process.env.NOSTR_BUNKER_CLIENT_KEY;
    log('connecting to remote signer (approve the request in your signer app if asked)…');
    closable = await bunkerSigner(url, {
      clientSecretKey: ck ? parseSecretKey(ck) : undefined,
      onauth: (authUrl) => log(`remote signer asks you to authorize this bridge: ${authUrl}`),
    });
    signer = closable;
  } else if (mode === 'key' || mode === 'instance') {
    if (values['ephemeral-key']) signer = ephemeralSigner();
    else {
      const sk = process.env.NOSTR_SECRET_KEY;
      if (!sk) fail(`--signer ${mode} requires NOSTR_SECRET_KEY in the environment (or --ephemeral-key for a dry run)`);
      signer = secretKeySigner(parseSecretKey(sk));
    }
  }

  try {
    const pubkey = signer ? await signer.getPublicKey() : undefined;
    if (pubkey && creatorPubkey) {
      if (mode === 'instance' && pubkey === creatorPubkey) fail('--signer instance: the key is the creator\'s own key; use --signer key');
      if (mode !== 'instance' && pubkey !== creatorPubkey) {
        fail(`signer pubkey ${pubkey} is not --creator-pubkey; to sign on someone else's behalf use --signer instance`);
      }
    }

    let state: BridgeState | undefined;
    if (values.state) state = await loadState(values.state);
    else if (values.publish) log('note: no --state file; deletions of these videos cannot be propagated later');

    log(
      `${values.publish ? 'PUBLISH' : 'DRY RUN'}: ${values.channel} on ${values.instance}` +
        (signer ? ` as ${pubkey} (${mode}${values['ephemeral-key'] ? ', ephemeral' : ''})` : ' (unsigned templates)') +
        (values.publish ? ` -> ${relays.join(', ')}` : ''),
    );

    const counts: Record<SyncResult['status'], number> = { built: 0, refused: 0, published: 0, error: 0, 'delete-planned': 0, deleted: 0 };
    const statePath = values.state;
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
      creatorPubkey: mode === 'instance' || mode === undefined ? creatorPubkey : undefined,
      instanceSigned: mode === 'instance' ? { operator: values.operator!.trim() } : undefined,
      verify: verifySignedEvent,
      relay: { retries },
      relayAuth: !values['no-relay-auth'],
      state,
      deletions: !values['no-deletions'],
      onStateChange: statePath ? (s) => saveState(statePath, s) : undefined,
      onResult: (r) => {
        counts[r.status]++;
        const imetas = r.template?.tags.filter((t) => t[0] === 'imeta').length ?? 0;
        const relayText = r.relays ? `; ${r.relays.map((x) => `${x.relay}: ${x.ok ? 'ok' : 'FAIL'} ${x.message}`).join('; ')}` : '';
        const detail =
          r.status === 'refused' || r.status === 'error'
            ? `${r.reason}${relayText}`
            : r.status === 'delete-planned' || r.status === 'deleted'
              ? `kind 5 deletion (${r.reason})${relayText}`
              : `kind ${r.template!.kind}, ${imetas} imeta${relayText}`;
        log(`  [${r.status}] ${r.uuid} ${JSON.stringify(r.title)} — ${detail}`);
        if (r.template && r.status !== 'refused') {
          process.stdout.write(JSON.stringify(r.event ?? r.template) + '\n');
        }
      },
    });
    log(`done: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    if (counts.error > 0) process.exitCode = 1;
  } finally {
    await closable?.close();
  }
}

main().catch((err) => {
  process.stderr.write(`error: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
