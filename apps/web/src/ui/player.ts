// One PeerTube embed in a reel, with a minimal client for PeerTube's embed API
// (`api=1`): the embed talks jschannel over postMessage with scope "peertube". We
// start its "__ready" handshake (PeerTube's jschannel fork: publish-request /
// publish-reply), then send play / pause / setVolume and listen for
// playbackStatusUpdate (position and duration, for finish detection).
//
// If the instance never completes the handshake (old PeerTube, API disabled), the
// player still works: autoplay and mute are URL flags, and pausing an off-screen
// video falls back to unloading it.

import type { Video } from "../lib/core.ts";
import { embedOrigin, embedUrl } from "../lib/videos.ts";

export interface PlayerStatus {
  position: number;
  duration: number;
  state: string;
}

const players = new Set<EmbedPlayer>();
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  globalThis.addEventListener?.("message", (e: MessageEvent) => {
    for (const p of players) if (e.source && e.source === p.iframe.contentWindow) p.receive(e);
  });
}

export class EmbedPlayer {
  readonly iframe: HTMLIFrameElement;
  private readonly origin: string;
  private nextId = 1;
  ready = false;
  private wantPlay: boolean;
  onStatus?: (s: PlayerStatus) => void;
  onReady?: () => void;

  constructor(
    v: Video,
    opts: { p2p: boolean; muted: boolean; autoplay: boolean },
  ) {
    listen();
    this.origin = embedOrigin(v) ?? "*";
    this.wantPlay = opts.autoplay;
    this.iframe = document.createElement("iframe");
    this.iframe.className = "reel-frame";
    this.iframe.src = embedUrl(v, { p2p: opts.p2p, autoplay: opts.autoplay, muted: opts.muted, loop: true, api: true, controls: false }) ?? "about:blank";
    this.iframe.title = `Video: ${v.title}`;
    this.iframe.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
    this.iframe.setAttribute("referrerpolicy", "no-referrer");
    this.iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-presentation");
    this.iframe.setAttribute("tabindex", "-1");
    players.add(this);
    // The embed waits for the parent to start the handshake.
    this.iframe.addEventListener("load", () => {
      let tries = 0;
      const knock = () => {
        if (this.ready || tries++ > 12 || !this.iframe.isConnected) return;
        this.post("__ready", { type: "publish-request", publish: [] }, true);
        setTimeout(knock, 700);
      };
      knock();
    });
  }

  private post(method: string, params?: unknown, notify = false) {
    const w = this.iframe.contentWindow;
    if (!w) return;
    const msg: Record<string, unknown> = { method: `peertube::${method}`, params };
    if (!notify) msg.id = this.nextId++;
    try {
      w.postMessage(JSON.stringify(msg), this.origin);
    } catch {
      /* frame navigated away */
    }
  }

  receive(e: MessageEvent) {
    let m: { method?: string; params?: unknown };
    try {
      m = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    if (!m || typeof m.method !== "string") return;
    if (m.method === "peertube::__ready") {
      // PeerTube's jschannel fork: {type: "publish-request" | "publish-reply", publish}.
      // Older jschannel: "ping" / "pong".
      const p = m.params as { type?: string } | string | undefined;
      if (p === "ping") this.post("__ready", "pong", true);
      else if (typeof p === "object" && p?.type === "publish-request") this.post("__ready", { type: "publish-reply", publish: [] }, true);
      if (!this.ready) {
        this.ready = true;
        if (this.wantPlay) this.post("play");
        else this.post("pause");
        this.onReady?.();
      }
    } else if (m.method === "peertube::ready" && !this.ready) {
      // Sent once the player has loaded (after the handshake).
      this.ready = true;
      if (this.wantPlay) this.post("play");
      else this.post("pause");
      this.onReady?.();
    } else if (m.method === "peertube::playbackStatusUpdate" && m.params && typeof m.params === "object") {
      const p = m.params as Record<string, unknown>;
      this.onStatus?.({
        position: Number(p.position) || 0,
        duration: Number(p.duration) || 0,
        state: String(p.playbackState ?? ""),
      });
    }
  }

  play() {
    this.wantPlay = true;
    if (this.ready) this.post("play");
  }

  pause() {
    this.wantPlay = false;
    if (this.ready) this.post("pause");
  }

  setMuted(muted: boolean) {
    if (this.ready) this.post("setVolume", muted ? 0 : 1);
  }

  destroy() {
    players.delete(this);
    this.iframe.src = "about:blank";
    this.iframe.remove();
  }
}
