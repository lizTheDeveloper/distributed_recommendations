"""Experiment 1: recommender quality and creator exposure.

Compares (a) centralized global user-kNN CF, (b) follow-only chronological,
(c) match-based CF from chosen peers, (d) match + taste lists, (d') a
"taste-heavy" variant of d, (e) d + decayed second-degree, (f) e + explore slots.
Static snapshot at the end of the world's history; several world seeds.
"""
from __future__ import annotations

import time

import numpy as np

from .common import aggregate, md_table, out_path, write_csv
from .metrics import feed_metrics
from .recs import Context, RecParams, make_feeds
from .world import WorldConfig, build_world, initial_state

VARIANTS = [
    ("a_global_cf", "a", {}),
    ("b_follow_chrono", "b", {}),
    ("c_match", "c", {}),
    ("d_match_lists", "d", {}),
    ("d'_taste_heavy", "d", {"w_list": 0.6, "w_follow": 0.3}),
    ("e_match_lists_2nd", "e", {}),
    ("f_full_explore10", "f", {"explore_share": 0.10}),
    ("f_full_explore2", "f", {"explore_share": 0.02}),
]

METRICS = ["precision@k", "recall@k", "exp_precision", "novelty_bits", "coverage",
           "creator_gini", "longtail_share", "new_creator_share", "creators_reached",
           "cold_precision@k", "cold_nomatch_precision@k"]


def run(seeds=(0, 1, 2), cfg: WorldConfig = WorldConfig(), out_dir=None, log=print) -> dict:
    rows = []
    for seed in seeds:
        t0 = time.time()
        w = build_world(cfg.scaled(seed=seed))
        s = initial_state(w)
        base = RecParams()
        ctx = Context(w, s, base)
        for name, strat, over in VARIANTS:
            c = ctx if not over else _ctx_with(ctx, base.with_(**over))
            rng = np.random.default_rng([seed, 101])
            feeds, is_ex = make_feeds(c, strat, rng)
            m = feed_metrics(w, s, feeds, c.allowed)
            m["explore_slot_share"] = float(is_ex.mean())
            rows.append({"seed": seed, "variant": name, **m})
        log(f"  exp1 seed {seed}: {time.time() - t0:.1f}s")
    write_csv(rows, out_path("exp1_quality_raw.csv", out_dir))
    agg = aggregate(rows, ["variant"], METRICS)
    write_csv(agg, out_path("exp1_quality.csv", out_dir))
    headers = {"precision@k": "P@20", "recall@k": "R@20", "novelty_bits": "novelty (bits)",
               "creator_gini": "exposure Gini", "longtail_share": "long-tail share",
               "new_creator_share": "new-creator share", "creators_reached": "creators reached",
               "cold_precision@k": "cold-start P@20",
               "cold_nomatch_precision@k": "cold, 0 matches P@20"}
    md = ["# Experiment 1: recommender quality and creator exposure", "",
          f"World: {cfg.n_viewers} viewers, {cfg.n_creators} creators, seeds {list(seeds)}; "
          "mean ± sd over seeds.", "",
          md_table(agg, ["variant", "precision@k", "recall@k", "novelty_bits", "coverage"],
                   sd=True, headers=headers), "",
          md_table(agg, ["variant", "creator_gini", "longtail_share", "new_creator_share",
                         "creators_reached"], sd=True, headers=headers), "",
          md_table(agg, ["variant", "cold_precision@k", "cold_nomatch_precision@k"],
                   sd=True, headers=headers)]
    with open(out_path("exp1_summary.md", out_dir), "w") as f:
        f.write("\n".join(md) + "\n")
    return {"rows": rows, "agg": agg, "markdown": "\n".join(md)}


def _ctx_with(ctx: Context, p: RecParams) -> Context:
    """Reuse expensive precomputations from ``ctx`` with different mixing params."""
    c = object.__new__(Context)
    c.__dict__.update(ctx.__dict__)
    c.p = p
    if p.decay != ctx.p.decay or p.sim_floor != ctx.p.sim_floor:
        c._peer = {}
    return c
