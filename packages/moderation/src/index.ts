// Public API of @match-feed/moderation. nostr.ts (nostr-tools) and relay.ts
// (WebSocket) are exported too but only needed for the defaults; apps can inject
// their own verify and query functions.
export * from './types.ts';
export { cleanDisplay, fold, normHandle, normHost, normTag } from './text.ts';
export { parsePubkey, toNpub, verifyNostrEvent } from './nostr.ts';
export { queryRelays, relayQuery } from './relay.ts';
export type { QueryOptions, WebSocketCtor } from './relay.ts';
export { KIND_REPORT, REPORT_CONTENT_MAX, REPORT_TYPES, REPORT_TYPE_LABELS, buildReport, labelsFromReports, parseReport } from './reports.ts';
export type { BuildReportOptions, ParsedReport, ReportTarget, ReportType } from './reports.ts';
export {
  KIND_DELETION,
  KIND_LABEL,
  LABEL_LIMITS,
  LabelIndex,
  UGC_NAMESPACE,
  buildLabelEvent,
  buildLabelIndex,
  fetchLabelEvents,
  fetchLabels,
  normUrlTarget,
  parseLabelEvent,
  selfLabels,
} from './labels.ts';
export type { BuildLabelIndexOptions, BuildLabelOptions, FetchLabelsOptions, Label, TargetKey } from './labels.ts';
export {
  BLOCK_LIMITS,
  BlockMatcher,
  addBlock,
  emptyBlockState,
  importMuteList,
  normalizeBlockValue,
  parseBlockState,
  parseBlockStateJson,
  removeBlock,
  removeMuteImport,
  serializeBlockState,
} from './blocks.ts';
export type { BlockHit, BlockKind, BlockState, MuteImport } from './blocks.ts';
export { KIND_MUTE_LIST, fetchMuteList, parseMuteList } from './mutelist.ts';
export type { FetchMuteListOptions, ParseMuteListOptions } from './mutelist.ts';
export {
  PEERTUBE_ABUSE_LIMITS,
  PEERTUBE_ABUSE_REASONS,
  PeerTubeModerationClient,
  PeerTubeModerationError,
  REPORT_TYPE_TO_PEERTUBE,
  foldBlocklistActions,
  normalizeInstance,
  parseMuteFeed,
  prepareAbuseReport,
  videoRefFromUrl,
} from './peertube.ts';
export type {
  AbuseReportInput,
  InstanceDefaults,
  PeerTubeAbuseBody,
  PeerTubeAbuseReason,
  PeerTubeModerationClientOptions,
  PreparedAbuseReport,
  PublicBlocklistAction,
} from './peertube.ts';
export {
  ACTION_RANK,
  APP_STORE_SETTINGS,
  CONTENT_WARNING_NAMESPACE,
  DEFAULT_LABEL_RULES,
  DEFAULT_SETTINGS,
  MATCH_FEED_NAMESPACE,
  PEERTUBE_INSTANCE_NAMESPACE,
  PEERTUBE_NSFW_NAMESPACE,
  REPORTS_NAMESPACE,
  actionForLabel,
  defaultPolicy,
  findRule,
  modeToAction,
  parseModerationSettings,
  parsePolicyJson,
  serializePolicy,
  setSensitiveMode,
} from './policy.ts';
export type {
  LabelRule,
  LabelerSubscription,
  ModerationAction,
  ModerationPolicy,
  ModerationSettings,
  RuleAction,
  SensitiveCategory,
  SensitiveMode,
} from './policy.ts';
export { applyModeration, attachVerdicts, moderateVideo, peertubeVideoMeta, publicSubjects, videoTargetKeys } from './moderate.ts';
export type {
  DroppedSource,
  HiddenVideo,
  HideReason,
  ModeratedItem,
  ModerationCandidate,
  ModerationContext,
  ModerationResult,
  SourceMeta,
  Verdict,
  VideoMeta,
} from './moderate.ts';
export { planReport } from './plan.ts';
export type { ReportPlan, ReportPlanInput } from './plan.ts';
