// The only file that reaches into other packages, by relative path, so the
// labeler can never drift from what clients read:
//
// - packages/moderation: the label vocabulary (`DEFAULT_LABEL_RULES`), the label
//   builder and reader (`buildLabelEvent`, `buildLabelIndex`), NIP-56 report
//   parsing and signature checks. Labels the labeler emits are, by
//   construction, labels the moderation package understands.
// - packages/bridge: the signer (local key or NIP-46 bunker), `signWith` (checks
//   the signer returned exactly the event we asked for) and the relay client
//   (NIP-42 AUTH, retries). Same approach, same code.
//
// Both packages resolve nostr-tools 2.25.2 from their own lockfiles.

export {
  DEFAULT_LABEL_RULES,
  DEFAULT_SETTINGS,
  KIND_DELETION,
  KIND_LABEL,
  KIND_REPORT,
  LABEL_LIMITS,
  MATCH_FEED_NAMESPACE,
  REPORT_TYPES,
  actionForLabel,
  buildLabelEvent,
  buildLabelIndex,
  cleanDisplay,
  fetchLabelEvents,
  normHandle,
  normHost,
  normUrlTarget,
  parseLabelEvent,
  parsePubkey,
  parseReport,
  toNpub,
  verifyNostrEvent,
} from '../../../packages/moderation/src/index.ts';
export type {
  EventTemplate,
  Label,
  LabelRule,
  ModerationAction,
  NostrEvent,
  ParsedReport,
  ReportType,
  TargetKey,
} from '../../../packages/moderation/src/index.ts';

export { bunkerSigner, parseBunkerUrl, parseSecretKey, secretKeySigner, verifySignedEvent } from '../../../packages/bridge/src/nostr-signer.ts';
export type { BunkerOptions, ClosableSigner } from '../../../packages/bridge/src/nostr-signer.ts';
export { signWith } from '../../../packages/bridge/src/event.ts';
export type { Signer } from '../../../packages/bridge/src/event.ts';
export { publish, query } from '../../../packages/bridge/src/relay.ts';
export type { PublishResult, RelayOptions, WebSocketCtor } from '../../../packages/bridge/src/relay.ts';
