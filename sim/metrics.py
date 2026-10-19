"""Feed metrics shared by experiments 1, 2 and 5."""
from __future__ import annotations

import numpy as np

from .world import World, State, gini


def feed_metrics(w: World, s: State, feeds: np.ndarray, allowed: np.ndarray,
                 new_age: int = 4, head_frac: float = 0.2) -> dict:
    """Quality metrics are measured against the fixed ground-truth labels ``Y``
    ("would endorse if shown") on items the viewer has not been exposed to.

    - precision@k: hits / k (empty slots count as misses)
    - recall@k: hits / (number of relevant, allowed, unexposed items)
    - exp_precision: mean ground-truth endorse probability of shown items
    - novelty: mean self-information -log2(share of viewers who endorsed it)
    - coverage: distinct shown videos / allowed videos
    - creator Gini over impressions, long-tail share (creators outside the top
      ``head_frac`` by follower count), new-creator share (age < ``new_age``)
    """
    N, k = feeds.shape
    valid = feeds >= 0
    f = np.where(valid, feeds, 0)
    rows = np.broadcast_to(np.arange(N)[:, None], f.shape)
    hits = w.Y[rows, f] & valid
    probs = np.where(valid, w.P[rows, f], 0.0)
    relevant = (w.Y & allowed).sum(1)
    prec_u = hits.sum(1) / k
    rec_u = hits.sum(1) / np.maximum(relevant, 1)
    pop = s.E.sum(0).astype(np.float64)
    selfinfo = -np.log2((pop + 1.0) / (N + 1.0))
    nov = selfinfo[f][valid].mean() if valid.any() else 0.0
    shown = f[valid]
    avail_videos = allowed.any(0).sum()
    exposure = np.bincount(w.video_creator[shown], minlength=w.M).astype(np.float64)
    exists = w.creator_arrival < s.now
    fc = s.follower_counts()
    order = np.argsort(-fc[exists])
    head_ids = np.flatnonzero(exists)[order[: int(np.ceil(head_frac * exists.sum()))]]
    head = np.zeros(w.M, dtype=bool)
    head[head_ids] = True
    tot = max(exposure.sum(), 1.0)
    new = (s.now - w.creator_arrival <= new_age) & exists
    cold = w.cold
    cold0 = cold & (w.adj.sum(1) == 0)
    return {
        "precision@k": float(prec_u.mean()),
        "recall@k": float(rec_u.mean()),
        "exp_precision": float(probs.sum() / max(valid.sum(), 1)),
        "novelty_bits": float(nov),
        "coverage": float(len(np.unique(shown)) / max(avail_videos, 1)),
        "creator_gini": gini(exposure[exists]),
        "longtail_share": float(exposure[~head & exists].sum() / tot),
        "new_creator_share": float(exposure[new].sum() / tot),
        "creators_reached": float((exposure[exists] > 0).mean()),
        "cold_precision@k": float(prec_u[cold].mean()) if cold.any() else float("nan"),
        "cold_recall@k": float(rec_u[cold].mean()) if cold.any() else float("nan"),
        "cold_nomatch_precision@k": float(prec_u[cold0].mean()) if cold0.any() else float("nan"),
        "fill_rate": float(valid.mean()),
    }
