"""Experiment 2: explore-slot share sweep (dynamic, week by week).

Starts from a history that only contains the initial creators' videos. Each week
(round): new creators arrive and upload, every viewer gets a 20-item feed from
strategy (f) with a given explore share, watches each item with probability
``watch_prob``, endorses it according to ground truth ``Y``, and follows the
creator of an endorsed video with probability ``follow_prob``. Off-app discovery
(search, links, embeds) gives each viewer Poisson(``external_rate``) extra views a
week drawn popularity-biased, so creators are not *only* discoverable via the feed.

Main outcome: for new creators, the number of weeks until the first in-feed view
by someone who does not follow them ("time to first non-follower view", TTFV).
Uses common random numbers across shares so differences are due to the policy.
"""
from __future__ import annotations

import time

import numpy as np

from .common import aggregate, md_table, out_path, parallel_map, write_csv
from .recs import Context, RecParams, make_feeds
from .world import WorldConfig, build_world, gini, gumbel_topk_mask, initial_state

SHARES = (0.0, 0.01, 0.02, 0.05, 0.10, 0.15)


def simulate(w, share: float, params: RecParams, seed: int, watch_prob=0.6,
             follow_prob=0.15, external_rate=0.5, window=6) -> dict:
    cfg = w.cfg
    T = cfg.n_rounds
    s = initial_state(w, upto_round=0)
    M = w.M
    first_feed = np.full(M, -1)
    first_any = np.full(M, -1)
    first_via_explore = np.zeros(M, dtype=bool)
    impressions = np.zeros(M)
    hits = slots = 0
    psum = 0.0
    hits_new_users = []
    ext_logw = (0.8 * np.log(w.creator_pop[w.video_creator])[None, :]
                + 3.0 * (w.taste @ w.video_topic.T)).astype(np.float32)
    for r in range(T):
        s.now = r + 1                               # videos uploaded in round <= r
        ctx = Context(w, s, params)
        feeds, is_ex = make_feeds(ctx, "f", np.random.default_rng([seed, r, 7]),
                                  explore_share=share)
        valid = feeds >= 0
        f = np.where(valid, feeds, 0)
        rows = np.broadcast_to(np.arange(w.N)[:, None], f.shape)
        hits += int((w.Y[rows, f] & valid).sum())
        psum += float(w.P[rows, f][valid].sum())
        slots += feeds.size
        np.add.at(impressions, w.video_creator[f[valid]], 1)

        rv = np.random.default_rng([seed, r, 11])
        watched = valid & (rv.random(feeds.shape) < watch_prob)
        u, j = np.nonzero(watched)
        vid = feeds[u, j]
        cr = w.video_creator[vid]
        nonfol = ~s.follows[u, cr]
        _first(first_feed, cr[nonfol], r)
        new_first = cr[nonfol & is_ex[u, j]]
        first_via_explore[new_first[first_feed[new_first] == r]] = True
        _first(first_any, cr[nonfol], r)
        _watch(w, s, u, vid, r, rv, follow_prob)

        # off-app discovery
        avail = w.video_upload <= r
        lw = np.where(avail[None, :] & ~s.exposed, ext_logw, -np.inf).astype(np.float32)
        k = rv.poisson(external_rate, w.N)
        ext = gumbel_topk_mask(lw, k, rv)
        u2, vid2 = np.nonzero(ext)
        cr2 = w.video_creator[vid2]
        _first(first_any, cr2[~s.follows[u2, cr2]], r)
        _watch(w, s, u2, vid2, r, rv, follow_prob)

    arr = w.creator_arrival
    new = (arr >= 1) & (arr <= T - window)
    ttfv = np.where(first_feed[new] >= 0, first_feed[new] - arr[new] + 1, np.inf)
    ttfv_any = np.where(first_any[new] >= 0, first_any[new] - arr[new] + 1, np.inf)
    exists = arr < T
    newer = arr >= 1
    out = {
        "explore_share": share,
        "n_new_creators": int(new.sum()),
        "ttfv_median_wk": float(np.median(ttfv)),
        "ttfv_mean_capped_wk": float(np.minimum(ttfv, window + 1).mean()),
        "found_in_1wk": float((ttfv <= 1).mean()),
        "found_in_2wk": float((ttfv <= 2).mean()),
        "found_in_4wk": float((ttfv <= 4).mean()),
        "never_in_window": float(np.isinf(ttfv).mean()),
        "any_channel_found_in_1wk": float((ttfv_any <= 1).mean()),
        "first_view_via_explore": float(first_via_explore[new].mean()),
        "precision@20": hits / slots,
        "exp_precision": psum / max(slots, 1),
        "creator_gini": gini(impressions[exists]),
        "new_creator_impr_share": float(impressions[newer].sum() / max(impressions.sum(), 1)),
        "new_creator_followers": float(s.follows[:, newer].sum(0).mean()),
    }
    return out


def _first(first: np.ndarray, creators: np.ndarray, r: int) -> None:
    c = np.unique(creators)
    c = c[first[c] < 0]
    first[c] = r


def _watch(w, s, u, vid, r, rng, follow_prob):
    s.exposed[u, vid] = True
    e = w.Y[u, vid]
    s.E[u[e], vid[e]] = True
    s.endorse_round[u[e], vid[e]] = r
    fol = e & (rng.random(len(u)) < follow_prob)
    s.follows[u[fol], w.video_creator[vid[fol]]] = True


_WORLD_CACHE: dict = {}


def _job(args):
    cfg, seed, share = args[:3]
    params = args[3] if len(args) > 3 else RecParams()
    key = cfg.scaled(seed=seed)
    if key not in _WORLD_CACHE:
        _WORLD_CACHE.clear()
        _WORLD_CACHE[key] = build_world(key)
    return {"seed": seed, **simulate(_WORLD_CACHE[key], share, params, seed)}


def run(seeds=(0, 1), cfg: WorldConfig = WorldConfig(n_viewers=2000, n_creators=1000),
        shares=SHARES, random_shares=(0.02, 0.05, 0.10), out_dir=None, log=print, workers: int | None = None) -> dict:
    # "content": explore candidates ranked by on-device tag similarity (default).
    # "random": explore candidates drawn at random among eligible creators — a
    # pessimistic bound on the viewer-quality cost.
    jobs, labels = [], []
    for seed in seeds:
        for sh in shares:
            jobs.append((cfg, seed, sh))
            labels.append("content")
        for sh in random_shares:
            jobs.append((cfg, seed, sh, RecParams(explore_noise=1e4)))
            labels.append("random")
    t0 = time.time()
    rows = parallel_map(_job, jobs, workers)
    for r, lab in zip(rows, labels):
        r["explore_ranking"] = lab
        log(f"  exp2 seed {r['seed']} {lab} share {r['explore_share']:.2f}: "
            f"TTFV median {r['ttfv_median_wk']} P@20 {r['precision@20']:.3f}")
    log(f"  exp2 total {time.time() - t0:.1f}s")
    metrics = [k for k in rows[0] if k not in ("seed", "explore_share", "explore_ranking")]
    agg = aggregate(rows, ["explore_ranking", "explore_share"], metrics)
    base = next(a for a in agg if a["explore_share"] == 0.0)
    for a in agg:
        a["quality_cost_pct"] = 100.0 * (1 - a["precision@20"] / base["precision@20"])
    write_csv(rows, out_path("exp2_explore_raw.csv", out_dir))
    write_csv(agg, out_path("exp2_explore.csv", out_dir))
    headers = {"explore_share": "explore share", "explore_ranking": "explore ranking", "ttfv_median_wk": "median TTFV (wk)",
               "ttfv_mean_capped_wk": "mean TTFV (wk, capped 7)",
               "found_in_1wk": "found ≤1 wk", "found_in_2wk": "found ≤2 wk",
               "found_in_4wk": "found ≤4 wk", "never_in_window": "not found in 6 wk",
               "first_view_via_explore": "1st view via explore",
               "precision@20": "viewer P@20", "quality_cost_pct": "P@20 cost %",
               "creator_gini": "exposure Gini", "new_creator_impr_share": "new-creator impr. share",
               "new_creator_followers": "followers / new creator"}
    md = ["# Experiment 2: explore-slot share sweep", "",
          f"World: {cfg.n_viewers} viewers, {cfg.n_creators} creators, {cfg.n_rounds} weekly "
          f"rounds, seeds {list(seeds)}. TTFV = weeks from a new creator's first upload to the "
          "first in-feed view by a non-follower (week of upload = 1).", "",
          md_table(agg, ["explore_ranking", "explore_share", "ttfv_median_wk", "ttfv_mean_capped_wk",
                         "found_in_1wk", "found_in_2wk", "found_in_4wk", "never_in_window",
                         "first_view_via_explore"], sd=True, headers=headers), "",
          md_table(agg, ["explore_ranking", "explore_share", "precision@20", "quality_cost_pct", "creator_gini",
                         "new_creator_impr_share", "new_creator_followers"], sd=True,
                   headers=headers)]
    with open(out_path("exp2_summary.md", out_dir), "w") as f:
        f.write("\n".join(md) + "\n")
    return {"rows": rows, "agg": agg, "markdown": "\n".join(md)}
