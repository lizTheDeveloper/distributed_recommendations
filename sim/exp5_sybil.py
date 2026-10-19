"""Experiment 5: Sybil reach (THREAT_MODEL T7).

An attacker controls S sybil accounts and wants 10 low-quality "attack" videos
(each from a different sybil creator, so per-creator caps don't help) in honest
feeds. Sybils:
  - match each other freely (each sybil has ~14 sybil matches, the UX cap),
  - endorse all attack videos plus 50 globally popular videos (camouflage),
  - opt in to second-degree forwarding,
  - publish one public taste list (attack videos + 30 popular videos) and all
    subscribe to it to inflate its subscriber count.
g honest users (uniformly chosen, newcomers included) are persuaded to match a
sybil (attack edges); that sybil drops its camouflage and mirrors the victim's
sketch to maximize similarity. Another g honest users are
lured into subscribing to the attacker's list.

Policies (feeds = strategy (e) scores: peers + lists + follows, creator cap 2):
  P0 no_decay    naive: similarity-weighted path counts over 1-, 2- and 3-hop match
                 paths, equal weight, no normalization; lists weighted by subscriber
                 count (sybils inflate it)
  P1 decay_cap   row-normalized trust walk: 1st degree + 0.3 x 2nd degree only,
                 per-node 2nd-degree trust capped at 0.05 of the viewer's total;
                 lists as in P0
  P2 +list_cap   P1 + each subscribed list contributes at most 2 items per feed
                 + list weight from track record (subscribers' observed endorse
                 rate of its items) instead of subscriber count
Reach = share of honest users with >= 1 attack video in their top 20.
Run with default mixing weights (lists 0.15, follows 0.1) and "taste-heavy"
weights (lists 0.6, follows 0.3).
"""
from __future__ import annotations

import time

import numpy as np

from .common import md_table, out_path, parallel_map, write_csv
from .recs import cosine_matrix, follow_recency, rowmax_norm, select_topk
from .world import WorldConfig, build_world, initial_state, list_items

N_ATTACK = 10
CAMO = 50
POLICIES = ("P0_no_decay", "P1_decay_cap", "P2_plus_list_cap")
SYBILS = (10, 100, 1000)
EDGES = (0, 10, 50, 200)


def setup(w, s, S: int, g: int, rng):
    N, V = w.N, w.V
    Nt, Vt = N + S, V + N_ATTACK
    A = np.zeros((Nt, Nt), dtype=bool)
    A[:N, :N] = w.adj
    if S > 1:
        for _ in range(min(7, max(1, (S - 1) // 2))):
            perm = rng.permutation(S) + N
            A[perm, np.roll(perm, 1)] = True
            A[np.roll(perm, 1), perm] = True
        np.fill_diagonal(A, False)
    victims = rng.choice(N, g, replace=False) if g else np.array([], dtype=int)
    sybil_of = N + (np.arange(g) % S)
    A[victims, sybil_of] = True
    A[sybil_of, victims] = True

    E = np.zeros((Nt, Vt), dtype=bool)
    E[:N, :V] = s.E
    popular = np.argsort(-s.E.sum(0))[:CAMO]
    E[N:, popular] = True
    E[N:, V:] = True
    for v, sy in zip(victims, sybil_of):
        if not E[sy, :V].sum() > CAMO:           # first victim: drop camouflage
            E[sy, :V] = False
        E[sy, :V] |= s.E[v]                      # mirror the victim's sketch
    optin = np.r_[w.optin, np.ones(S, dtype=bool)]

    # ground truth for honest users on attack videos: low quality spam
    P_att = np.full((N, N_ATTACK), 0.02, dtype=np.float32)
    Y_att = rng.random((N, N_ATTACK)) < P_att

    # lists: honest lists + attacker list
    L_h = list_items(w, s)
    L = np.zeros((L_h.shape[0] + 1, Vt), dtype=bool)
    L[:-1, :V] = L_h
    L[-1, V:] = True
    L[-1, popular[:30]] = True
    rest = np.setdiff1d(np.arange(N), victims)
    lured = rng.choice(rest, g, replace=False) if g else np.array([], dtype=int)
    subs = np.zeros((N, L.shape[0]), dtype=bool)
    subs[:, :-1] = w.subs
    subs[lured, -1] = True
    sub_count = subs.sum(0).astype(float)
    sub_count[-1] += S
    return dict(A=A, E=E, optin=optin, victims=victims, lured=lured, P_att=P_att,
                Y_att=Y_att, L=L, subs=subs, sub_count=sub_count, Nt=Nt, Vt=Vt)


def feeds_for(w, s, d, policy: str, w_list=0.15, w_follow=0.1, k=20, rng=None,
              decay=0.3, node_cap=0.05):
    N, V = w.N, w.V
    A, E = d["A"], d["E"]
    Ef = E.astype(np.float32)
    cos = cosine_matrix(E)
    Wraw = (A * (0.1 + cos)).astype(np.float32)
    if policy == "P0_no_decay":
        # naive: sum similarity-weighted path counts over 1-3 hops, no normalization
        Wo = d["optin"][:, None] * Wraw
        T2 = Wraw[:N] @ Wo
        T = Wraw[:N] + T2 + T2 @ Wo
    else:
        rs = Wraw.sum(1, keepdims=True)
        rs[rs == 0] = 1
        W = Wraw / rs
        Wopt = d["optin"][:, None] * W
        Wh = W[:N]
        T2 = decay * (Wh @ Wopt)
        T2[A[:N]] = 0.0                              # direct matches count once
        T2[np.arange(N), np.arange(N)] = 0.0
        np.minimum(T2, node_cap, out=T2)             # per-node cap
        T = Wh + T2
    peer = rowmax_norm(T @ Ef)

    L = d["L"].astype(np.float32)
    subs = d["subs"]
    if policy == "P2_plus_list_cap":
        P_full = np.concatenate([w.P, d["P_att"]], axis=1)
        hit = np.array([P_full[np.ix_(np.flatnonzero(subs[:, l]), np.flatnonzero(d["L"][l]))].mean()
                        if subs[:, l].any() and d["L"][l].any() else 0.0
                        for l in range(L.shape[0])])
        lw = np.clip(hit / np.median(hit[hit > 0]), 0, 1)
        ls = np.zeros((N, d["Vt"]), dtype=np.float32)
        for l in range(L.shape[0]):
            u = np.flatnonzero(subs[:, l])
            items = np.flatnonzero(d["L"][l])
            if len(u) == 0 or len(items) == 0:
                continue
            # each list offers its 2 items the viewer's own peer signal likes best
            sc = peer[np.ix_(u, items)] + 1e-3 * rng.random((len(u), len(items)))
            top = np.argsort(-sc, axis=1)[:, :2]
            ls[u[:, None], items[top]] += lw[l]
        list_score = rowmax_norm(ls)
    else:
        # popularity-weighted lists: weight proportional to subscriber count
        lw = d["sub_count"] / d["sub_count"][:-1].mean()
        list_score = rowmax_norm((subs * lw[None, :]).astype(np.float32) @ L)

    avail = np.ones(V, dtype=bool)
    fol = np.zeros((N, d["Vt"]), dtype=np.float32)
    fol[:, :V] = follow_recency(w, s, avail)
    pop = np.r_[s.E.sum(0), np.zeros(N_ATTACK)].astype(np.float32)
    score = peer + w_list * list_score + w_follow * fol + 1e-6 * pop / pop.max()
    allowed = np.zeros((N, d["Vt"]), dtype=bool)
    allowed[:, :V] = ~s.exposed
    allowed[:, V:] = True
    creator = np.r_[w.video_creator, w.M + np.arange(N_ATTACK)]
    return select_topk(score, allowed, k, creator, cap=2)


def measure(w, d, feeds) -> dict:
    N, V = w.N, w.V
    att = feeds >= V
    has = att.any(1)
    victims = np.zeros(N, dtype=bool)
    victims[d["victims"]] = True
    lured = np.zeros(N, dtype=bool)
    lured[d["lured"]] = True
    other = ~victims & ~lured
    f = np.where(feeds >= 0, feeds, 0)
    rows = np.arange(N)[:, None]
    Yfull = np.concatenate([w.Y, d["Y_att"]], axis=1)
    hits = Yfull[rows, f] & (feeds >= 0)
    return {
        "reach_all": float(has.mean()),
        "reach_victims": float(has[victims].mean()) if victims.any() else float("nan"),
        "reach_list_subscribers": float(has[lured].mean()) if lured.any() else float("nan"),
        "reach_others": float(has[other].mean()),
        "n_others_reached": int(has[other].sum()),
        "attack_impression_share": float(att.mean()),
        "honest_precision@20": float(hits.mean()),
    }


_CACHE: dict = {}


def _job(args):
    cfg, S, g = args
    if cfg not in _CACHE:
        _CACHE.clear()
        w = build_world(cfg)
        _CACHE[cfg] = (w, initial_state(w))
    w, s = _CACHE[cfg]
    rng = np.random.default_rng([cfg.seed, S, g, 5])
    d = setup(w, s, S, g, rng)
    out = []
    for mix, (wl, wf) in (("default", (0.15, 0.1)), ("taste_heavy", (0.6, 0.3))):
        for pol in POLICIES:
            feeds = feeds_for(w, s, d, pol, w_list=wl, w_follow=wf,
                              rng=np.random.default_rng([cfg.seed, S, g, 6]))
            out.append({"weights": mix, "sybils": S, "attack_edges": g, "policy": pol,
                        **measure(w, d, feeds)})
    return out


def run(seed=0, cfg: WorldConfig = WorldConfig(), sybils=SYBILS, edges=EDGES, out_dir=None,
        log=print, workers=None) -> dict:
    t0 = time.time()
    jobs = [(cfg.scaled(seed=seed), S, g) for S in sybils for g in edges]
    rows = [r for rr in parallel_map(_job, jobs, workers) for r in rr]
    log(f"  exp5: {len(rows)} runs in {time.time() - t0:.1f}s")
    write_csv(rows, out_path("exp5_sybil.csv", out_dir))
    md = ["# Experiment 5: Sybil reach", "",
          f"{cfg.n_viewers} honest viewers. Reach = share of honest users with ≥ 1 of the 10 "
          "attack videos in their top 20. 'others' = honest users who neither matched a sybil "
          "nor subscribed to the attacker's list (collateral reach through propagation).", ""]
    hdr = {"sybils": "S", "attack_edges": "g", "reach_all": "reach (all honest)",
           "reach_victims": "reach: matched a sybil", "reach_list_subscribers":
           "reach: list subscribers", "reach_others": "reach: others",
           "n_others_reached": "# others reached", "attack_impression_share":
           "attack impr. share", "honest_precision@20": "honest P@20"}
    for mix in ("default", "taste_heavy"):
        for pol in POLICIES:
            md.append(f"## {pol}, {mix} weights")
            md.append("")
            md.append(md_table([r for r in rows if r["policy"] == pol and r["weights"] == mix],
                               ["sybils", "attack_edges", "reach_all", "reach_victims",
                                "reach_list_subscribers", "reach_others", "n_others_reached",
                                "attack_impression_share", "honest_precision@20"],
                               digits=4, headers=hdr))
            md.append("")
    md = "\n".join(md)
    with open(out_path("exp5_summary.md", out_dir), "w") as f:
        f.write(md + "\n")
    return {"rows": rows, "markdown": md}
