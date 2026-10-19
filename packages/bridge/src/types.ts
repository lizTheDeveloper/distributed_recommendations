// Hand-written subset of the PeerTube REST API shapes this bridge reads.
//
// These are written from observed responses (see test/fixtures) rather than
// generated from PeerTube's OpenAPI spec or imported from @peertube/* packages,
// both of which are AGPL-3.0 labelled. Only the fields we use are declared, and
// every field is treated as possibly missing, because instances run different
// PeerTube versions.

export interface PtIdLabel<T = number> {
  id: T;
  label: string;
}

export interface PtActor {
  url?: string;
  name: string;
  host: string;
  displayName?: string;
}

export interface PtThumbnail {
  width: number;
  height: number;
  aspectRatio?: string;
  fileUrl: string;
}

export interface PtVideoFile {
  resolution: PtIdLabel;
  width?: number;
  height?: number;
  size?: number;
  fps?: number;
  fileUrl: string;
  magnetUri?: string;
  hasAudio?: boolean;
  hasVideo?: boolean;
  playlistUrl?: string;
}

export interface PtStreamingPlaylist {
  /** 1 = HLS */
  type: number;
  playlistUrl: string;
  redundancies?: { baseUrl: string }[];
  files?: PtVideoFile[];
}

export interface PtVideo {
  uuid: string;
  shortUUID?: string;
  /** Canonical (origin-instance) watch URL, also the ActivityPub id host. */
  url: string;
  name: string;
  description?: string | null;
  truncatedDescription?: string | null;
  duration: number;
  aspectRatio?: number | null;
  isLocal?: boolean;
  isLive?: boolean;
  nsfw?: boolean;
  nsfwFlags?: number;
  nsfwSummary?: string | null;
  privacy: PtIdLabel;
  state?: PtIdLabel;
  blacklisted?: boolean;
  downloadEnabled?: boolean;
  language?: PtIdLabel<string | null>;
  licence?: PtIdLabel<number | null>;
  tags?: string[];
  publishedAt: string;
  originallyPublishedAt?: string | null;
  updatedAt?: string;
  thumbnailPath?: string | null;
  previewPath?: string | null;
  thumbnails?: PtThumbnail[];
  account?: PtActor;
  channel?: PtActor;
  files?: PtVideoFile[];
  streamingPlaylists?: PtStreamingPlaylist[];
}

export interface PtCaption {
  language: PtIdLabel<string>;
  automaticallyGenerated?: boolean;
  captionPath?: string;
  fileUrl?: string;
}

export interface PtChapter {
  timecode: number;
  title: string;
}

export interface PtPage<T> {
  total: number;
  data: T[];
}

// PeerTube constants (stable since PeerTube 1.x/6.x respectively).
export const PT_PRIVACY_PUBLIC = 1;
export const PT_STATE_PUBLISHED = 1;
export const PT_PLAYLIST_HLS = 1;

// ---- Nostr (NIP-01) ----

export type Tag = string[];

/** An event before pubkey/id/sig are attached (what NIP-07 `signEvent` takes). */
export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: Tag[];
  content: string;
}

export interface UnsignedEvent extends EventTemplate {
  pubkey: string;
}

export interface SignedEvent extends UnsignedEvent {
  id: string;
  sig: string;
}

// NIP-71 kinds.
export const KIND_VIDEO = 21;
export const KIND_SHORT_VIDEO = 22;
export const KIND_ADDRESSABLE_VIDEO = 34235;
export const KIND_ADDRESSABLE_SHORT_VIDEO = 34236;
