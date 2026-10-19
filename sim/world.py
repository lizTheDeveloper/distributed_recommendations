"""Synthetic world for the Match Feed simulations.

Everything here is synthetic. The generative model is deliberately simple and is
documented in docs/SIMULATION_RESULTS.md ("World model"). Nothing in this file is
calibrated to real PeerTube or YouTube data.

Static parts (``World``): latent tastes and topics, creators, videos, ground-truth
endorsement probabilities ``P`` and fixed "would endorse if shown" labels ``Y``,
the match graph, circles, list owners and list subscriptions.

Dynamic parts (``State``): what each viewer has been exposed to, what they endorsed
(and when), who follows whom. ``initial_state`` samples a popularity-biased exposure
history up to a given round.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np


# --------------------------------------------------------------------------- utils

def normalize(x: np.ndarray, axis: int = -1) -> np.ndarray:
    n = np.linalg.norm(x, axis=axis, keepdims=True)
    n[n == 0] = 1.0
    return x / n


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def gumbel32(rng: np.random.Generator, shape) -> np.ndarray:
    """Standard Gumbel noise as float32 (faster than rng.gumbel for big arrays)."""
    u = rng.random(shape, dtype=np.float32)
    np.clip(u, 1e-12, 1 - 1e-7, out=u)
    return -np.log(-np.log(u))


def gumbel_topk_mask(logw: np.ndarray, k: np.ndarray, rng: np.random.Generator,
                     chunk: int = 512) -> np.ndarray:
    """Per row, sample ``k[row]`` columns without replacement with probability
    proportional to ``exp(logw)`` (Gumbel top-k trick). ``-inf`` entries are never
    chosen. Returns a boolean mask of the same shape as ``logw``."""
    n, m = logw.shape
    out = np.zeros((n, m), dtype=bool)
    k = np.minimum(np.asarray(k, dtype=np.int64), m)
    for s in range(0, n, chunk):
        e = min(n, s + chunk)
        kk = k[s:e]
        kmax = int(kk.max()) if len(kk) else 0
        if kmax <= 0:
            continue
        g = logw[s:e] + gumbel32(rng, (e - s, m))
        idx = np.argpartition(-g, kmax - 1, axis=1)[:, :kmax]
        gv = np.take_along_axis(g, idx, 1)
        order = np.argsort(-gv, axis=1)
        idx = np.take_along_axis(idx, order, 1)
        gv = np.take_along_axis(gv, order, 1)
        take = (np.arange(kmax)[None, :] < kk[:, None]) & np.isfinite(gv)
        rows = np.broadcast_to(np.arange(s, e)[:, None], idx.shape)
        out[rows[take], idx[take]] = True
    return out


def gini(x: np.ndarray) -> float:
    """Gini coefficient of a non-negative vector (0 = equal, ->1 = concentrated)."""
    x = np.sort(np.asarray(x, dtype=np.float64))
    n = len(x)
    if n == 0 or x.sum() == 0:
        return 0.0
    cum = np.cumsum(x)
    return float((n + 1 - 2 * (cum / cum[-1]).sum()) / n)


# --------------------------------------------------------------------------- config

@dataclass(frozen=True)
class WorldConfig:
    n_viewers: int = 3000
    n_creators: int = 1200
    n_communities: int = 12
    dim: int = 16
    n_rounds: int = 12               # weeks; creators arrive over rounds 1..n_rounds-1
    frac_initial_creators: float = 0.7
    videos_per_creator: float = 6.0
    pareto_shape: float = 1.16        # creator popularity ~ Pareto (80/20-ish)
    taste_noise: float = 0.7
    topic_noise: float = 0.6
    video_noise: float = 0.35
    tag_noise: float = 0.9            # observed tags = topic + noise (content signal is weak)
    secondary_interest: float = 0.3   # prob. a viewer has a second community
    follows_mean: float = 15.0
    match_k_min: int = 3
    match_k_max: int = 15
    match_affinity_noise: float = 0.15
    n_circles: int = 120
    circle_min: int = 8
    circle_max: int = 30
    n_lists: int = 60
    list_len: int = 40
    lists_per_user: float = 2.0
    cold_start_frac: float = 0.10
    exposure_mean: float = 150.0
    optin_second_degree: float = 0.8
    # ground-truth endorsement model: P = sigmoid(a*taste.topic + b*quality + c0)
    a_taste: float = 6.0
    b_quality: float = 0.6
    c0: float = -5.0
    seed: int = 0

    def scaled(self, **kw) -> "WorldConfig":
        return replace(self, **kw)


QUICK = WorldConfig(n_viewers=400, n_creators=160, n_circles=20, n_lists=12,
                    exposure_mean=80.0)


# --------------------------------------------------------------------------- world

@dataclass
class World:
    cfg: WorldConfig
    comm_u: np.ndarray
    taste: np.ndarray
    cold: np.ndarray
    creator_comm: np.ndarray
    creator_topic: np.ndarray
    creator_pop: np.ndarray
    creator_quality: np.ndarray
    creator_arrival: np.ndarray
    video_creator: np.ndarray
    video_topic: np.ndarray
    video_quality: np.ndarray
    video_upload: np.ndarray
    video_tags: np.ndarray
    P: np.ndarray                    # (N, V) float32 ground-truth endorse prob
    Y: np.ndarray                    # (N, V) bool, "would endorse if shown"
    adj: np.ndarray                  # (N, N) bool mutual matches
    optin: np.ndarray                # (N,) bool, middle opts in to 2nd-degree forwarding
    circles: list = field(default_factory=list)
    list_owner: np.ndarray = None    # (L,) viewer id of list owner (creator/curator account)
    list_pop: np.ndarray = None      # (L,) latent list popularity
    subs: np.ndarray = None          # (N, L) bool

    @property
    def N(self) -> int:
        return self.taste.shape[0]

    @property
    def V(self) -> int:
        return self.video_creator.shape[0]

    @property
    def M(self) -> int:
        return self.creator_topic.shape[0]


def _rngs(seed: int, n: int):
    return [np.random.default_rng(s) for s in np.random.SeedSequence(seed).spawn(n)]


def build_world(cfg: WorldConfig = WorldConfig()) -> World:
    (r_comm, r_taste, r_cre, r_vid, r_y, r_match, r_circ, r_list, r_opt) = _rngs(cfg.seed, 9)
    C, D, N, M, T = cfg.n_communities, cfg.dim, cfg.n_viewers, cfg.n_creators, cfg.n_rounds

    centers = normalize(r_comm.standard_normal((C, D)))
    comm_sizes = r_comm.dirichlet(np.full(C, 2.0))

    # viewers
    comm_u = r_taste.choice(C, size=N, p=comm_sizes)
    second = r_taste.choice(C, size=N, p=comm_sizes)
    has2 = r_taste.random(N) < cfg.secondary_interest
    taste = centers[comm_u] + 0.6 * has2[:, None] * centers[second]
    taste = normalize(taste + cfg.taste_noise * r_taste.standard_normal((N, D)) / np.sqrt(D))
    cold = r_taste.random(N) < cfg.cold_start_frac

    # creators
    creator_comm = r_cre.choice(C, size=M, p=comm_sizes)
    creator_topic = normalize(centers[creator_comm]
                              + cfg.topic_noise * r_cre.standard_normal((M, D)) / np.sqrt(D))
    creator_pop = (r_cre.pareto(cfg.pareto_shape, M) + 1.0)
    creator_quality = r_cre.normal(0, 0.5, M)
    n_initial = int(round(cfg.frac_initial_creators * M))
    creator_arrival = np.zeros(M, dtype=np.int64)
    creator_arrival[n_initial:] = r_cre.integers(1, T, M - n_initial)
    perm = r_cre.permutation(M)                     # don't tie arrival to index
    creator_arrival = creator_arrival[perm]

    # videos
    nv = 1 + r_vid.poisson(cfg.videos_per_creator - 1, M)
    video_creator = np.repeat(np.arange(M), nv)
    V = len(video_creator)
    video_topic = normalize(creator_topic[video_creator]
                            + cfg.video_noise * r_vid.standard_normal((V, D)) / np.sqrt(D))
    video_quality = creator_quality[video_creator] + r_vid.normal(0, 0.3, V)
    arr = creator_arrival[video_creator]
    lo = np.where(arr == 0, -8, arr)
    video_upload = lo + np.floor(r_vid.random(V) * (T - lo)).astype(np.int64)
    # each new creator's first video lands in its arrival round
    first = np.r_[0, np.cumsum(nv)[:-1]]
    video_upload[first] = np.where(creator_arrival > 0, creator_arrival, video_upload[first])
    video_tags = normalize(video_topic + cfg.tag_noise * r_vid.standard_normal((V, D)) / np.sqrt(D))

    # ground truth
    logits = (cfg.a_taste * (taste @ video_topic.T) + cfg.b_quality * video_quality[None, :]
              + cfg.c0)
    P = sigmoid(logits).astype(np.float32)
    Y = r_y.random((N, V), dtype=np.float32) < P

    adj = _build_matches(cfg, taste, comm_u, cold, r_match)
    optin = r_opt.random(N) < cfg.optin_second_degree
    circles = _build_circles(cfg, comm_u, r_circ)

    w = World(cfg=cfg, comm_u=comm_u, taste=taste, cold=cold, creator_comm=creator_comm,
              creator_topic=creator_topic, creator_pop=creator_pop,
              creator_quality=creator_quality, creator_arrival=creator_arrival,
              video_creator=video_creator, video_topic=video_topic,
              video_quality=video_quality, video_upload=video_upload, video_tags=video_tags,
              P=P, Y=Y, adj=adj, optin=optin, circles=circles)
    _build_list_subscriptions(w, r_list)
    return w


def _build_matches(cfg, taste, comm_u, cold, rng) -> np.ndarray:
    """Mutual, user-chosen, homophilous matches. Each viewer wants k in
    [k_min, k_max] (cold-start viewers 0..3). Viewers pick from people they
    perceive as similar (noisy taste affinity + same-community bonus) plus a few
    random acquaintances; an edge forms only if both still have capacity."""
    N = taste.shape[0]
    want = rng.integers(cfg.match_k_min, cfg.match_k_max + 1, N)
    want[cold] = rng.integers(0, 4, cold.sum())
    aff = taste @ taste.T + 0.2 * (comm_u[:, None] == comm_u[None, :])
    aff += cfg.match_affinity_noise * rng.standard_normal((N, N))
    np.fill_diagonal(aff, -np.inf)
    adj = np.zeros((N, N), dtype=bool)
    deg = np.zeros(N, dtype=np.int64)
    top = np.argsort(-aff, axis=1)[:, :60]
    for u in rng.permutation(N):
        if deg[u] >= want[u]:
            continue
        cands = np.concatenate([top[u], rng.integers(0, N, 15)])
        rng.shuffle(cands[:20])                  # some randomness among the closest
        for v in cands:
            if deg[u] >= want[u]:
                break
            if v == u or adj[u, v] or deg[v] >= want[v]:
                continue
            adj[u, v] = adj[v, u] = True
            deg[u] += 1
            deg[v] += 1
    return adj


def _build_circles(cfg, comm_u, rng) -> list:
    N = len(comm_u)
    out = []
    for _ in range(cfg.n_circles):
        c = rng.choice(comm_u)
        size = int(rng.integers(cfg.circle_min, cfg.circle_max + 1))
        pool = np.flatnonzero(comm_u == c)
        n_in = min(len(pool), int(round(0.8 * size)))
        mem = set(rng.choice(pool, n_in, replace=False).tolist())
        while len(mem) < size:
            mem.add(int(rng.integers(0, N)))
        out.append(np.array(sorted(mem)))
    return out


def _build_list_subscriptions(w: World, rng) -> None:
    cfg = w.cfg
    cand = np.flatnonzero(~w.cold)
    owners = rng.choice(cand, min(cfg.n_lists, len(cand)), replace=False)
    L = len(owners)
    w.list_owner = owners
    w.list_pop = rng.pareto(1.2, L) + 1.0
    k = rng.poisson(cfg.lists_per_user, w.N)
    k[w.cold] = 1 + rng.poisson(1.5, w.cold.sum())       # "starter packs" for new users
    k = np.minimum(k, L)
    logw = (np.log(w.list_pop)[None, :] + 4.0 * (w.taste @ w.taste[owners].T)).astype(np.float32)
    logw[owners, np.arange(L)] = -np.inf                  # don't subscribe to own list
    w.subs = gumbel_topk_mask(logw, k, rng)


# --------------------------------------------------------------------------- state

@dataclass
class State:
    exposed: np.ndarray          # (N, V) bool
    E: np.ndarray                # (N, V) bool endorsed
    endorse_round: np.ndarray    # (N, V) int16, -32768 = never
    follows: np.ndarray          # (N, M) bool
    now: int

    def copy(self) -> "State":
        return State(self.exposed.copy(), self.E.copy(), self.endorse_round.copy(),
                     self.follows.copy(), self.now)

    def follower_counts(self) -> np.ndarray:
        return self.follows.sum(0)


NEVER = np.iinfo(np.int16).min


def initial_state(w: World, upto_round: int | None = None, seed: int | None = None) -> State:
    """Sample a popularity-biased exposure history over videos uploaded before
    ``upto_round`` (default: all of them), then follows."""
    cfg = w.cfg
    T = cfg.n_rounds if upto_round is None else upto_round
    rng_e, rng_f = _rngs(cfg.seed * 1000 + 17 + (seed or 0), 2)
    avail = w.video_upload < T
    budget = np.clip(rng_e.lognormal(np.log(cfg.exposure_mean) - 0.245, 0.7, w.N), 20, 1000)
    budget[w.cold] = rng_e.integers(3, 9, w.cold.sum())
    budget = np.minimum(budget.astype(np.int64), avail.sum())
    logw = (0.8 * np.log(w.creator_pop[w.video_creator])[None, :]
            + 3.0 * (w.taste @ w.video_topic.T)).astype(np.float32)
    logw[:, ~avail] = -np.inf
    exposed = gumbel_topk_mask(logw, budget, rng_e)
    E = exposed & w.Y
    er = np.full(E.shape, NEVER, dtype=np.int16)
    up = np.broadcast_to(w.video_upload.astype(np.int16)[None, :], E.shape)
    er[E] = up[E]

    # follows: preferential (creator popularity) x taste, among creators already active
    k = 1 + rng_f.poisson(cfg.follows_mean - 1, w.N)
    k[w.cold] = rng_f.integers(1, 6, w.cold.sum())
    active = w.creator_arrival < max(T - 1, 1)
    flog = (np.log(w.creator_pop)[None, :] + 4.0 * (w.taste @ w.creator_topic.T)).astype(np.float32)
    flog[:, ~active] = -np.inf
    k = np.minimum(k, active.sum())
    follows = gumbel_topk_mask(flog, k, rng_f)
    return State(exposed=exposed, E=E, endorse_round=er, follows=follows, now=T)


def list_items(w: World, s: State, list_len: int | None = None) -> np.ndarray:
    """(L, V) bool: each list holds its owner's ``list_len`` most recent endorsements."""
    ll = w.cfg.list_len if list_len is None else list_len
    er = s.endorse_round[w.list_owner].astype(np.float32)
    er[er == NEVER] = -np.inf
    # tie-break deterministically by video id
    er = er + np.linspace(0, 0.5, w.V, dtype=np.float32)[None, :]
    out = np.zeros((len(w.list_owner), w.V), dtype=bool)
    kk = min(ll, w.V)
    idx = np.argpartition(-er, kk - 1, axis=1)[:, :kk]
    vals = np.take_along_axis(er, idx, 1)
    rows = np.broadcast_to(np.arange(len(w.list_owner))[:, None], idx.shape)
    ok = np.isfinite(vals)
    out[rows[ok], idx[ok]] = True
    return out
