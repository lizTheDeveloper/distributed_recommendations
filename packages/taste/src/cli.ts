#!/usr/bin/env -S node --experimental-strip-types
// match-feed-taste: publish a creator's picks. Dry run by default.

import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { verifySignedEvent, signerFromEnv } from './node-signers.ts';
import type { ClosableSigner } from './node-signers.ts';
import { validatePicksSet } from './picks.ts';
import { publishPicks, resolvePicks } from './publish.ts';
import { relayPublisher, relaysQuery } from './relays.ts';
import { parseTasteListJson, picksFromTasteList } from './tastelist.ts';
import type { PicksSet } from './types.ts';

const USAGE = `Usage: match-feed-taste publish --picks <file.json> [options]

Builds a NIP-51 video curation set (kind 30005) and a taste-list v1 JSON from the
same picks. Default is a DRY RUN: the event and the JSON are printed, nothing is sent.

Input (--picks): a taste-list v1 JSON ({"v":1,"name":…,"items":[{"id":<watch URL>,…}]})
or a picks set ({"d":…,"title":…,"items":[{"url":…,"video"?:…}]}).

  --d <id>                  NIP-51 d identifier when the input is a taste list (default "picks")
  --relay <wss://…>         relay to look up bridged videos on, and to publish to (repeatable)
  --bridge-pubkey <hex>     bridge key(s) you trust for video lookups, preferred first (repeatable)
  --json-out <file>         write the taste-list v1 JSON here (host it; link it in your channel description)
  --created-at <unix>       event created_at / JSON updatedAt (default now)

Signing (keys from the environment only, never argv):
  --signer bunker           NOSTR_BUNKER_URL=bunker://… (NIP-46, preferred), optional NOSTR_BUNKER_CLIENT_KEY
  --signer key              NOSTR_SECRET_KEY=<hex|nsec>
  --sign                    dry run: also sign, to show the complete event
  --publish                 sign and send to every --relay
  -h, --help`;

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n\n${USAGE}\n`);
  process.exit(2);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      picks: { type: 'string' },
      d: { type: 'string', default: 'picks' },
      relay: { type: 'string', multiple: true, default: [] },
      'bridge-pubkey': { type: 'string', multiple: true, default: [] },
      'json-out': { type: 'string' },
      'created-at': { type: 'string' },
      signer: { type: 'string' },
      sign: { type: 'boolean', default: false },
      publish: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      nsec: { type: 'string' },
      'secret-key': { type: 'string' },
      bunker: { type: 'string' },
    },
  });
  if (values.help) return void process.stdout.write(USAGE + '\n');
  if (values.nsec !== undefined || values['secret-key'] !== undefined || values.bunker !== undefined) {
    fail('secrets are never accepted on the command line; use NOSTR_SECRET_KEY or NOSTR_BUNKER_URL in the environment');
  }
  if (positionals[0] !== 'publish') fail('expected the "publish" command');
  if (!values.picks) fail('--picks is required');
  const relays = values.relay as string[];
  const mode = values.signer;
  if (mode !== undefined && mode !== 'bunker' && mode !== 'key') fail('--signer must be bunker or key');
  if (values.publish && !mode) fail('--publish requires --signer bunker|key');
  if (values.publish && !relays.length) fail('--publish requires at least one --relay');
  if (values.sign && !mode) fail('--sign requires --signer');
  const createdAt = values['created-at'] === undefined ? undefined : Number(values['created-at']);
  if (createdAt !== undefined && !Number.isInteger(createdAt)) fail('--created-at must be Unix seconds');

  const text = await readFile(values.picks, 'utf8');
  let set: PicksSet;
  const raw = JSON.parse(text);
  set = raw && raw.v === 1 ? picksFromTasteList(parseTasteListJson(text), values.d) : validatePicksSet(raw);

  const log = (s: string) => process.stderr.write(s + '\n');
  if (relays.length) {
    const r = await resolvePicks(set, {
      query: relaysQuery(relays, { onError: (u, e) => log(`  ${u}: ${(e as Error).message}`) }),
      verify: verifySignedEvent,
      bridgePubkeys: values['bridge-pubkey'] as string[],
    });
    set = r.set;
    for (const p of r.report) log(`  [${p.status}] ${p.url}${p.error ? ` (${p.error})` : ''}`);
  } else log('note: no --relay, so picks without a video ref stay out of the Nostr set');

  let signer: ClosableSigner | null = null;
  try {
    if (mode) signer = await signerFromEnv(process.env, { mode: mode as 'bunker' | 'key', onauth: (u) => log(`authorize in your signer: ${u}`) });
    const res = await publishPicks(set, {
      signer: signer ?? undefined,
      relays,
      dryRun: !values.publish,
      signInDryRun: values.sign,
      createdAt,
      verify: verifySignedEvent,
      publish: values.publish ? relayPublisher() : undefined,
    });
    log(`${res.dryRun ? 'DRY RUN' : 'PUBLISH'}: ${res.template.tags.filter((t) => t[0] === 'pick').length} picks in the set${res.address ? ` ${res.address}` : ''}`);
    for (const w of res.warnings) log(`warning: ${w}`);
    for (const r of res.results ?? []) log(`  ${r.relay}: ${r.ok ? 'ok' : 'FAIL'} ${r.message}`);
    process.stdout.write(JSON.stringify(res.event ?? res.template) + '\n');
    if (values['json-out']) {
      await writeFile(values['json-out'], res.json + '\n');
      log(`wrote ${values['json-out']}`);
    } else process.stdout.write(res.json + '\n');
    if (res.results?.some((r) => !r.ok)) process.exitCode = 1;
  } finally {
    await signer?.close();
  }
}

main().catch((err) => {
  process.stderr.write(`error: ${(err as Error).message ?? err}\n`);
  process.exit(1);
});
