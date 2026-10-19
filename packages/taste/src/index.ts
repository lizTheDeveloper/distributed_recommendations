// @match-feed/taste: publish a creator's public picks for Match Feed's Follow taste.
// Browser-safe entry point; Node signers (env key, bunker) are in './node-signers.ts'.

export type { Pick, PicksSet, VideoRef } from './types.ts';
export type { ToTasteListOptions } from './picks.ts';
export { PICKS_LIMITS, ValidationError, serializeTasteList, toTasteList, validatePicksSet } from './picks.ts';
export type { TasteItem, TasteList } from './tastelist.ts';
export {
  MAX_TIMESTAMP,
  TASTE_LIST_LIMITS,
  newestFirst,
  oldestFirst,
  parseTasteList,
  parseTasteListJson,
  picksFromTasteList,
} from './tastelist.ts';
export type { BuildOptions, BuildResult, CurationRef, ParseCurationOptions, ParsedCurationSet, PickMeta, ResolveOptions } from './nip51.ts';
export {
  CURATION_LIMITS,
  KIND_VIDEO_CURATION_SET,
  PICK_FLAGS,
  PICK_TAG,
  buildCurationSet,
  buildSetDeletion,
  curationSetAddress,
  parseCurationSet,
  picksFromCurationSet,
  resolveCurationSet,
  signCurationSet,
  videoFilters,
} from './nip51.ts';
export type { FindBridgedOptions, FindBridgedResult, QueryFn, WatchUrl } from './peertube.ts';
export {
  ADDRESSABLE_VIDEO_KINDS,
  REGULAR_VIDEO_KINDS,
  VIDEO_KINDS,
  addressOf,
  bridgedAddresses,
  canonicalFromApi,
  findBridgedVideo,
  parseWatchUrl,
  predictBridgedRef,
  shortUuidToUuid,
  uuidToShortUuid,
  videoUrlFromEvent,
} from './peertube.ts';
export type { PickReport, PickStatus, PublishPicksOptions, PublishPicksResult } from './publish.ts';
export { publishPicks, resolvePicks } from './publish.ts';
export type { CreatorPicks, ReadPicksOptions } from './read.ts';
export { readCreatorPicks } from './read.ts';
export type { PublishFn, PublishResult, RelayOptions } from './relays.ts';
export { relayPublisher, relaysQuery } from './relays.ts';
export type { Filter } from './memory-relay.ts';
export { MemoryRelay, matchesFilter } from './memory-relay.ts';
export { npubDecode, npubEncode } from './npub.ts';
export type { Signer } from './signers.ts';
export { nip07Signer } from './signers.ts';
