// One "Report" button, two channels. For a video:
// 1. PeerTube abuse report to the hosting instance: the PRIMARY path, and the
//    only one that can get content removed. Instance operators must act on
//    illegal content; a Nostr report reaches nobody with that duty.
// 2. A NIP-56 event, if the video has a Nostr event, for labelers and clients
//    that read reports.
// The plan is shown to the user; nothing is sent until they confirm each part.

import type { Video } from './core.ts';
import type { VideoMeta } from './moderate.ts';
import type { PeerTubeAbuseReason, PreparedAbuseReport } from './peertube.ts';
import { REPORT_TYPE_TO_PEERTUBE, prepareAbuseReport, videoRefFromUrl } from './peertube.ts';
import type { ReportType } from './reports.ts';
import { REPORT_TYPE_LABELS, buildReport } from './reports.ts';
import type { EventTemplate } from './types.ts';
import { HEX64 } from './text.ts';

export interface ReportPlanInput {
  video: Video;
  meta?: VideoMeta;
  type: ReportType;
  /** What the user wrote. */
  details?: string;
  /**
   * File the PeerTube report on the viewer's own instance instead of the origin
   * (PeerTube forwards it to the origin as an ActivityPub Flag). Use this when
   * the viewer has an account there but not on the origin.
   */
  viaInstance?: string;
  /** Extra PeerTube categories (e.g. `rights` for copyright). */
  peertubeReasons?: readonly PeerTubeAbuseReason[];
  startAt?: number;
  endAt?: number;
  now?: number;
  /** Labelers (hex) to address the NIP-56 report to; see `BuildReportOptions.labelers`. */
  labelers?: readonly string[];
}

export interface ReportPlan {
  /** Send this first. Absent when the video id isn't a PeerTube watch URL. */
  peertube?: PreparedAbuseReport;
  /** Unsigned NIP-56 event; absent when the video has no Nostr event. */
  nostr?: EventTemplate;
  /** Notes for the confirmation screen. */
  notes: string[];
}

export function planReport(input: ReportPlanInput): ReportPlan {
  const plan: ReportPlan = { notes: [] };
  const ref = videoRefFromUrl(input.video.id) ?? (input.video.url ? videoRefFromUrl(input.video.url) : null);
  const typeLabel = REPORT_TYPE_LABELS[input.type];
  if (ref) {
    const details = (input.details ?? '').trim();
    plan.peertube = prepareAbuseReport({
      instance: input.viaInstance ?? ref.instance,
      videoId: ref.videoId,
      reason: details ? `${typeLabel}: ${details}` : typeLabel,
      predefinedReasons: [...new Set([...REPORT_TYPE_TO_PEERTUBE[input.type], ...(input.peertubeReasons ?? [])])],
      ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
      ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
    });
    plan.notes.push(
      input.viaInstance
        ? `Filed on ${new URL(plan.peertube.instance).host}, which forwards it to ${new URL(ref.instance).host}, where the video is hosted.`
        : `Sent to ${new URL(ref.instance).host}, where the video is hosted. You need an account there.`,
    );
  } else {
    plan.notes.push('This video has no PeerTube instance we can report to.');
  }
  const m = input.meta;
  if (m?.eventId && m.pubkey && HEX64.test(m.eventId) && HEX64.test(m.pubkey) && input.type !== 'impersonation') {
    plan.nostr = buildReport({ type: 'video', eventId: m.eventId, pubkey: m.pubkey, ...(m.address ? { address: m.address } : {}) }, input.type, {
      content: input.details,
      createdAt: input.now,
      ...(input.labelers?.length ? { labelers: input.labelers } : {}),
    });
    plan.notes.push('A public Nostr report (NIP-56) is also prepared. It is signed by you and visible to anyone.');
    if (input.labelers?.length) plan.notes.push(`It is addressed to ${input.labelers.length === 1 ? 'the labeler' : `${input.labelers.length} labelers`} you chose, who can review it.`);
  }
  if (input.type === 'illegal') {
    plan.notes.push(
      'For child sexual abuse material, do not download, screenshot or share it. Report it to the hosting instance and to a hotline (NCMEC CyberTipline in the US, IWF in the UK, or an INHOPE member hotline elsewhere).',
    );
  }
  return plan;
}
