"""Feed strategies for experiment 1/2/5.

All strategies return an (N, feed_size) int array of video ids (-1 = empty slot)
and never recommend something the viewer was already exposed to or that is not yet
uploaded. Scores from each source are normalized per viewer (divided by the row max)
before mixing, so the weights in ``RecParams`` are comparable.

Strategies (experiment 1 labels):
  a  global_cf      centralized user-based kNN CF over everyone's endorsements
  b  follow_chrono  newest videos from followed creators
  c  match          on-device user CF from the viewer's chosen matches only
  d  match_lists    c + subscribed public taste lists + follows
  e  match_2nd      d + second-degree picks (opted-in middles, decayed)
  f  full           e + reserved explore slots for untied, under-exposed creators

Every strategy backfills empty score with follow recency and then global popularity
(tiny tie-break weights), as a real client would rather than show an empty slot.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

from .world import World, State, gumbel32, list_items

STRATEGIES = {
    "a": "global_cf",
    "b": "follow_chrono",
    "c": "match",
    "d": "match_lists",
    "e": "match_2nd",
    "f": "full_explore",
}


@dataclass(frozen=True)
class RecParams:
    feed_size: int = 20
    w_list: float = 0.15             # tuned on held-out seed 7 (see SIMULATION_RESULTS.md)
    w_follow: float = 0.1
    decay: float = 0.3               # weight of second-degree vs first-degree
    creator_cap: int = 2             # max items per creator in one feed (d, e, f)
    explore_share: float = 0.10
    explore_new_age: int = 4         # creators younger than this (rounds) are "new"
    explore_follower_pct: float = 50  # or below this follower-count percentile
    global_knn: int = 50
    sim_floor: float = 0.1           # a chosen match gets some weight even w/o overlap
    explore_noise: float = 0.15

    def with_(self, **kw) -> "RecParams":
        return replace(self, **kw)


def rowmax_norm(x: np.ndarray) -> np.ndarray:
    m = x.max(axis=1, keepdims=True)
    m[m <= 0] = 1.0
    return x / m


def cosine_matrix(E: np.ndarray) -> np.ndarray:
    Ef = E.astype(np.float32)
    G = Ef @ Ef.T
    n = np.sqrt(np.diag(G)).copy()
    n[n == 0] = 1.0
    return G / n[:, None] / n[None, :]


def peer_trust(adj: np.ndarray, E: np.ndarray, optin: np.ndarray, decay: float,
               second_degree: bool, sim_floor: float = 0.1,
               cos: np.ndarray | None = None) -> np.ndarray:
    """Row-normalized trust over peers. First degree: chosen matches weighted by
    (floor + cosine of sketches). Second degree: matches-of-matches via opted-in
    middles, multiplied by ``decay``; the viewer never sees who they are."""
    if cos is None:
        cos = cosine_matrix(E)
    W = adj * (sim_floor + cos)
    rs = W.sum(1, keepdims=True)
    rs[rs == 0] = 1.0
    W = (W / rs).astype(np.float32)
    if not second_degree:
        return W
    W2 = W @ (optin[:, None] * W)
    np.fill_diagonal(W2, 0.0)
    return W + decay * W2


def global_knn_weights(E: np.ndarray, k: int, cos: np.ndarray | None = None) -> np.ndarray:
    if cos is None:
        cos = cosine_matrix(E)
    S = cos.copy()
    np.fill_diagonal(S, 0.0)
    k = min(k, S.shape[0] - 1)
    idx = np.argpartition(-S, k - 1, axis=1)[:, :k]
    W = np.zeros_like(S)
    rows = np.arange(S.shape[0])[:, None]
    W[rows, idx] = S[rows, idx]
    return W


def follow_recency(w: World, s: State, avail: np.ndarray) -> np.ndarray:
    """Score = 1 for followed creators' videos, scaled by recency in (0.5, 1]."""
    F = s.follows[:, w.video_creator]
    age = np.maximum(s.now - w.video_upload, 0)
    rec = (1.0 / (1.0 + 0.1 * age)).astype(np.float32)
    return (F * rec[None, :] * avail[None, :]).astype(np.float32)


def select_topk(score: np.ndarray, allowed: np.ndarray, k: int, creator_of: np.ndarray,
                cap: int | None) -> np.ndarray:
    """Top-k per row under an optional per-creator cap. Returns (N, k) ids, -1 pad."""
    N, V = score.shape
    sc = np.where(allowed, score, -np.inf).astype(np.float32)
    K = min(V, k * 4 if cap else k)
    idx = np.argpartition(-sc, K - 1, axis=1)[:, :K]
    vals = np.take_along_axis(sc, idx, 1)
    order = np.argsort(-vals, axis=1, kind="stable")
    idx = np.take_along_axis(idx, order, 1)
    vals = np.take_along_axis(vals, order, 1)
    keep = np.isfinite(vals)
    if cap:
        c = creator_of[idx]
        same = (c[:, :, None] == c[:, None, :]) & np.tri(K, K, -1, dtype=bool)[None, :, :]
        keep &= same.sum(2) < cap
    pos = np.argsort(~keep, axis=1, kind="stable")[:, :k]
    out = np.take_along_axis(idx, pos, 1)
    ok = np.take_along_axis(keep, pos, 1)
    out[~ok] = -1
    return out


class Context:
    """Precomputed per-round quantities shared by strategies."""

    def __init__(self, w: World, s: State, p: RecParams, lists: np.ndarray | None = None,
                 list_trust: np.ndarray | None = None):
        self.w, self.s, self.p = w, s, p
        self.avail = w.video_upload < s.now
        self.allowed = self.avail[None, :] & ~s.exposed
        self.Ef = s.E.astype(np.float32)
        self.cos = cosine_matrix(s.E)
        self.pop = self.Ef.sum(0)
        self.pop_norm = (self.pop / max(self.pop.max(), 1.0)).astype(np.float32)
        self.follow = follow_recency(w, s, self.avail)
        self.lists = list_items(w, s) if lists is None else lists
        lt = np.ones(len(w.list_owner), np.float32) if list_trust is None else list_trust
        self.list_score = rowmax_norm((w.subs * lt[None, :]).astype(np.float32)
                                      @ self.lists.astype(np.float32))
        self._peer = {}

    def tiebreak(self) -> np.ndarray:
        return 1e-3 * self.follow + 1e-6 * self.pop_norm[None, :]

    def peer_score(self, second: bool) -> np.ndarray:
        if second not in self._peer:
            T = peer_trust(self.w.adj, self.s.E, self.w.optin, self.p.decay, second,
                           self.p.sim_floor, self.cos)
            self._peer[second] = rowmax_norm(T @ self.Ef)
        return self._peer[second]


def strategy_scores(ctx: Context, strat: str) -> np.ndarray:
    p = ctx.p
    if strat == "a":
        W = global_knn_weights(ctx.s.E, p.global_knn, ctx.cos)
        return rowmax_norm(W @ ctx.Ef) + ctx.tiebreak()
    if strat == "b":
        return ctx.follow + 1e-6 * ctx.pop_norm[None, :]
    if strat == "c":
        return ctx.peer_score(False) + ctx.tiebreak()
    if strat == "d":
        return (ctx.peer_score(False) + p.w_list * ctx.list_score
                + p.w_follow * ctx.follow + ctx.tiebreak())
    if strat in ("e", "f"):
        return (ctx.peer_score(True) + p.w_list * ctx.list_score
                + p.w_follow * ctx.follow + ctx.tiebreak())
    raise ValueError(strat)


def explore_pick(ctx: Context, n_slots: np.ndarray, rng: np.random.Generator,
                 tie_mask: np.ndarray) -> np.ndarray:
    """Explore slots: candidates are videos from creators the viewer has no tie to
    (not followed, not surfaced by matches or lists) who are new or under-exposed.
    New creators compete only with each other here. Ranked by on-device content
    similarity between the viewer's own profile (tags of endorsed / listed /
    followed items) and the video's noisy tags."""
    w, s, p = ctx.w, ctx.s, ctx.p
    kmax = int(n_slots.max()) if len(n_slots) else 0
    N = w.N
    if kmax == 0:
        return np.full((N, 0), -1, dtype=np.int64)
    fc = s.follower_counts()
    age = s.now - w.creator_arrival
    exists = w.creator_arrival < s.now
    thr = np.percentile(fc[exists], p.explore_follower_pct) if exists.any() else 0
    under = exists & ((fc <= thr) | (age < p.explore_new_age))
    cols = np.flatnonzero(under[w.video_creator] & ctx.avail)
    if len(cols) == 0:
        return np.full((N, 0), -1, dtype=np.int64)
    allowed = ctx.allowed[:, cols] & ~tie_mask[:, cols]
    tags = w.video_tags.astype(np.float32)
    prof = (ctx.Ef @ tags + 0.3 * (ctx.w.subs.astype(np.float32)
                                   @ (ctx.lists.astype(np.float32) @ tags))
            + 0.3 * (ctx.follow @ tags))
    prof /= np.maximum(np.linalg.norm(prof, axis=1, keepdims=True), 1e-9)
    sc = (prof @ tags[cols].T).astype(np.float32)
    sc += p.explore_noise * gumbel32(rng, sc.shape)
    sub = select_topk(sc, allowed, min(kmax, len(cols)), w.video_creator[cols], cap=1)
    return np.where(sub >= 0, cols[np.maximum(sub, 0)], -1)


def make_feeds(ctx: Context, strat: str, rng: np.random.Generator,
               explore_share: float | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Return (feeds, is_explore) arrays of shape (N, feed_size)."""
    p = ctx.p
    k = p.feed_size
    score = strategy_scores(ctx, strat)
    cap = p.creator_cap if strat in ("d", "e", "f") else None
    share = (p.explore_share if explore_share is None else explore_share) if strat == "f" else 0.0
    N = ctx.w.N
    if share <= 0:
        feeds = select_topk(score, ctx.allowed, k, ctx.w.video_creator, cap)
        return feeds, np.zeros_like(feeds, dtype=bool)
    n_ex = rng.binomial(k, share, N)
    tie = (ctx.peer_score(True) > 0) | (ctx.list_score > 0) | (ctx.follow > 0)
    ex = explore_pick(ctx, n_ex, rng, tie)
    allowed = ctx.allowed.copy()
    rows = np.broadcast_to(np.arange(N)[:, None], ex.shape)
    okx = ex >= 0
    allowed[rows[okx], ex[okx]] = False
    main = select_topk(score, allowed, k, ctx.w.video_creator, cap)
    # explore picks are contiguous at the front of ``ex`` (select_topk pads at the end)
    n_used = np.minimum(n_ex, (ex >= 0).sum(1))
    j = np.arange(k)[None, :]
    is_ex = j < n_used[:, None]
    ex_pad = np.full((N, k), -1, dtype=np.int64)
    ex_pad[:, :min(k, ex.shape[1])] = ex[:, :k]
    from_main = np.take_along_axis(main, np.clip(j - n_used[:, None], 0, k - 1), 1)
    feeds = np.where(is_ex, ex_pad, from_main)
    return feeds, is_ex
