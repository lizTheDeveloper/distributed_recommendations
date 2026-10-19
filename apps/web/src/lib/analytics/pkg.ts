// packages/analytics (Tier 2 discovery stats), imported from source like core. Only
// the pure modules: the DAP client (`upload.ts`, which pulls in @divviup/dap) is
// built into a separate dist/dap.js and loaded only when a report is due
// (src/lib/analytics/dap-entry.ts).
export { CHANNELS, channelOf, windowIndex, windowEnd } from "../../../../../packages/analytics/src/channels.ts";
export type { Channel } from "../../../../../packages/analytics/src/channels.ts";
export { fromWebSettings, channelAllowed } from "../../../../../packages/analytics/src/settings.ts";
export type { ContributionSettings } from "../../../../../packages/analytics/src/settings.ts";
export { emptyLedger, loadLedger, recordView, clearLedger } from "../../../../../packages/analytics/src/ledger.ts";
export type { Ledger, ChannelCounts } from "../../../../../packages/analytics/src/ledger.ts";
export { checkTaskConfig, configFilter, configPointerFromDescription, parseTaskConfig, taskConfigFromNostrEvent, CONFIG_MAX_BYTES, CONFIG_KIND, CONFIG_D_TAG } from "../../../../../packages/analytics/src/config.ts";
export type { TaskConfig } from "../../../../../packages/analytics/src/config.ts";
export { planReports, dueJobs } from "../../../../../packages/analytics/src/report.ts";
export type { UploadJob } from "../../../../../packages/analytics/src/report.ts";
export { nextRunDelayMs } from "../../../../../packages/analytics/src/hooks.ts";
