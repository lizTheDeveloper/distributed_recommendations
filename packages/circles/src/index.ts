// @match-feed/circles: PROTOTYPE. Not audited; not for production. See README.md
// and docs/CIRCLES.md for what is and is not secure.
export { CIRCLE_KINDS, circleKindName } from './kinds.ts';
export type { CircleKindName } from './kinds.ts';
export { KDF_PREFIX, KeyedStream, deriveKey, keystream, keystreamU32 } from './prg.ts';
export {
  RING_BITS,
  decodeVector,
  encodeVector,
  fromSigned,
  generateRoundKey,
  maskVector,
  pairMask,
  sumVectors,
  toSigned,
} from './masking.ts';
export type { MaskPeer, RoundKeyPair } from './masking.ts';
export {
  defaultNoiseTolerance,
  memberNoiseKey,
  noiseShare,
  noiseShareVector,
  sampleGamma,
  samplePoisson,
  samplePolya,
  shareShape,
} from './noise.ts';
export {
  MAX_CANDIDATES,
  MAX_OPEN_BYTES,
  MAX_ROUND_SECONDS,
  MAX_SMALL_BYTES,
  MessageError,
  decodeRoundKey,
  decodeRoundMasked,
  decodeRoundOpen,
  encodeRoundKey,
  encodeRoundMasked,
  encodeRoundOpen,
  isVideoId,
} from './messages.ts';
export type { RoundKeyMsg, RoundMaskedMsg, RoundOpenMsg } from './messages.ts';
export {
  circleFeedCandidates,
  emptyCirclesLedger,
  newestEpoch,
  releaseAggregatedEpoch,
  releasedItems,
  voidEpoch,
} from './policy.ts';
export type { AggregateInput, AggregateOutcome, CirclesLedger, VoidReason, VoidRecord } from './policy.ts';
export { CircleRoundEngine, participantsDigest } from './round.ts';
export type {
  ContributionInspector,
  EngineOptions,
  GroupView,
  ReceivedRoundMessage,
  RoundMessage,
  RoundSnapshot,
  RoundStatus,
} from './round.ts';
export { InMemoryNostrNetwork, MAX_EVENT_BYTES } from './network.ts';
export type { NostrEventLike, PublishResponse } from './network.ts';
export { CircleMember } from './client.ts';
export type { CircleMemberOptions, IdentitySigner, SeenMessage } from './client.ts';
