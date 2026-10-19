"""Experiment 3: Circle output leakage (THREAT_MODEL T3).

A Circle of k members pools endorsements over a set of candidate items. Secure
aggregation hides inputs, but the *output* is visible to every member:

  count_x = sum_i y_ix          (true number of members who endorsed item x)
  noisy_x = count_x + Z_x       (Z ~ discrete Laplace(eps), eps = inf means no noise)
  output  = "x is a group pick" iff noisy_x >= t         (mode "set", the design)
            or the noisy count itself when >= t           (mode "count")

Attacker: one insider member who knows their own input and, as strong auxiliary
knowledge, every other member's true endorsement probability for every item (from
the world's ground truth). This makes the attacker Bayes-optimal: their score is
the exact posterior P(target endorsed x | everything observed). We report the
ROC AUC of that posterior and subtract the AUC of the prior alone, so ΔAUC is the
leakage caused by the output itself.

Scenarios:
  single       one release, attacker alone
  collude      all members except the target collude (worst case, pure subtraction)
  diff_fresh   two releases, before and after the target leaves; fresh noise each
  diff_sticky  same, but noise is "sticky" (seeded per item, reused across releases)
  repeat10     ten releases with the same membership and fresh noise (averaging)
Mitigation "epoch freeze" (items already released are never recomputed after a
membership change) makes diff_* identical to ``single`` by construction, and
sticky noise makes repeat10 identical to ``single``.

Utility: "true group picks" = items endorsed by at least max(2, ceil(k/5))
members; we report recall and precision of the released set against that.
"""
from __future__ import annotations

import math
import time

import numpy as np

from .common import auc, h2, max_advantage, md_table, out_path, parallel_map, write_csv
from .privacy import dlap_pmf, dlap_sample, dlap_sf, dlap_support, poisson_binomial
from .world import WorldConfig, build_world

KS = (5, 8, 12, 20, 30)
TS = (1, 2, 3, 4, 6)
EPS = (math.inf, 2.0, 1.0, 0.5)
SCENARIOS = ("single", "collude", "diff_fresh", "diff_sticky", "repeat10")


def circle_data(w, k: int, n_circles: int, n_items: int, n_targets: int,
                rng: np.random.Generator) -> dict:
    """Pairs (target, item) from simulated circles of exactly k members drawn
    mostly (80%) from one community, over items the group plausibly cares about."""
    rows = {"yT": [], "pT": [], "ya": [], "y_other": [], "p_other": [], "first": [],
            "p_group": []}
    for _ in range(n_circles):
        c = rng.choice(w.comm_u)
        pool = np.flatnonzero(w.comm_u == c)
        n_in = min(len(pool), int(round(0.8 * k)))
        mem = list(rng.choice(pool, n_in, replace=False))
        while len(mem) < k:
            x = int(rng.integers(0, w.N))
            if x not in mem:
                mem.append(x)
        mem = np.array(mem)
        wts = w.P[mem].mean(0).astype(float)
        items = rng.choice(w.V, n_items, replace=False, p=wts / wts.sum())
        Y = w.Y[np.ix_(mem, items)]
        Pm = w.P[np.ix_(mem, items)].astype(float)
        for ti in range(1, 1 + n_targets):
            others = [i for i in range(k) if i not in (0, ti)]
            rows["yT"].append(Y[ti])
            rows["pT"].append(Pm[ti])
            rows["ya"].append(Y[0])
            rows["y_other"].append(Y[others].T)
            rows["p_other"].append(Pm[others].T)
            rows["first"].append(np.full(n_items, ti == 1))
            rows["p_group"].append(Pm.mean(0))
    return {key: np.concatenate(v, axis=0) for key, v in rows.items()}


def _obs_lik(mode: str, t: int, eps: float, obs: np.ndarray, revealed: np.ndarray,
             kmax: int) -> np.ndarray:
    """g[pair, c] = P(observation | true count c), c = 0..kmax."""
    c = np.arange(kmax + 1)[None, :]
    if mode == "set":
        p_rev = dlap_sf(t - c, eps)
        return np.where(revealed[:, None], p_rev, 1 - p_rev)
    p_hidden = 1 - dlap_sf(t - c, eps)
    p_val = dlap_pmf(obs[:, None] - c, eps)
    return np.where(revealed[:, None], p_val, p_hidden)


def evaluate(data: dict, k: int, t: int, eps: float, mode: str, scenario: str,
             rng: np.random.Generator, knowledge: str = "group") -> dict:
    """knowledge="group": attacker knows each item's average endorse rate in the
    circle (realistic auxiliary knowledge). knowledge="personal": attacker knows
    every member's true personal probability (worst case)."""
    yT = data["yT"].astype(int)
    ya = data["ya"].astype(int)
    yo = data["y_other"].astype(int)
    if knowledge == "personal":
        pT = np.clip(data["pT"], 1e-6, 1 - 1e-6)
        po = data["p_other"]
    else:
        pg = np.clip(data["p_group"], 1e-6, 1 - 1e-6)
        pT = pg
        po = np.repeat(pg[:, None], yo.shape[1], axis=1)
    n = len(yT)
    true_count = ya + yo.sum(1) + yT
    # what the attacker knows exactly vs must marginalize
    if scenario == "collude":
        known = ya + yo.sum(1)
        PU = np.ones((n, 1))
    else:
        known = ya
        PU = poisson_binomial(po)                    # (n, k-1)
    nU = PU.shape[1]
    U = np.arange(nU)[None, :]
    kmax = k

    def release(count, z):
        noisy = count + z
        return noisy, noisy >= t

    if scenario in ("single", "collude"):
        z = dlap_sample(rng, n, eps)
        obs, rev = release(true_count, z)
        g = _obs_lik(mode, t, eps, obs, rev, kmax)
        L = [np.sum(PU * np.take_along_axis(g, np.minimum(known[:, None] + U + y, kmax), 1), 1)
             for y in (0, 1)]
    elif scenario in ("diff_fresh", "repeat10"):
        R = 2 if scenario == "diff_fresh" else 10
        L = [np.ones((n, nU)) * PU, np.ones((n, nU)) * PU]
        for r in range(R):
            target_in = not (scenario == "diff_fresh" and r == 1)
            cnt = true_count - (0 if target_in else yT)
            obs, rev = release(cnt, dlap_sample(rng, n, eps))
            g = _obs_lik(mode, t, eps, obs, rev, kmax)
            for y in (0, 1):
                idx = np.minimum(known[:, None] + U + (y if target_in else 0), kmax)
                L[y] = L[y] * np.take_along_axis(g, idx, 1)
        L = [L[0].sum(1), L[1].sum(1)]
    elif scenario == "diff_sticky":
        z = dlap_sample(rng, n, eps)
        obs1, rev1 = release(true_count, z)
        obs2, rev2 = release(true_count - yT, z)
        H = dlap_support(eps)
        L = [np.zeros(n), np.zeros(n)]
        for zz in range(-H, H + 1):
            pz = float(dlap_pmf(zz, eps))
            for y in (0, 1):
                c1 = known[:, None] + U + y + zz
                c2 = known[:, None] + U + zz
                if mode == "set":
                    ok = ((c1 >= t) == rev1[:, None]) & ((c2 >= t) == rev2[:, None])
                else:
                    ok1 = np.where(rev1[:, None], c1 == obs1[:, None], c1 < t)
                    ok2 = np.where(rev2[:, None], c2 == obs2[:, None], c2 < t)
                    ok = ok1 & ok2
                L[y] += pz * (PU * ok).sum(1)
    else:
        raise ValueError(scenario)

    post = pT * L[1] / np.maximum(pT * L[1] + (1 - pT) * L[0], 1e-300)
    lab = yT.astype(bool)
    a_post, a_prior = auc(post, lab), auc(pT, lab)
    # bits: reduction in log-loss of the attacker's belief about y_T, per pair
    ll_prior = -np.log2(np.where(lab, pT, 1 - pT))
    ll_post = -np.log2(np.clip(np.where(lab, post, 1 - post), 1e-12, 1))
    conf = post >= 0.9
    # utility (one row per circle-item: the first target's rows)
    first = data["first"]
    thr = max(2, math.ceil(k / 5))
    truth = (true_count >= thr)[first]
    z = dlap_sample(np.random.default_rng(1), first.sum(), eps)
    shown = (true_count[first] + z) >= t
    return {
        "k": k, "t": t, "eps": eps, "mode": mode, "scenario": scenario, "knowledge": knowledge,
        "pairs": n, "base_rate": float(lab.mean()),
        "auc_post": a_post, "auc_prior": a_prior, "delta_auc": a_post - a_prior,
        "adv_post": max_advantage(post, lab), "adv_prior": max_advantage(pT, lab),
        "bits_gained": float((ll_prior - ll_post).mean()),
        "prior_entropy": float(h2(pT).mean()),
        "conf90_recall": float(conf[lab].mean()) if lab.any() else float("nan"),
        "conf90_precision": float(lab[conf].mean()) if conf.any() else float("nan"),
        "util_recall": float(shown[truth].mean()) if truth.any() else float("nan"),
        "util_precision": float(truth[shown].mean()) if shown.any() else float("nan"),
        "picks_per_100_items": float(100 * shown.mean()),
    }


def _job(args):
    cfg, k, n_circles, n_items, n_targets, grid = args
    w = build_world(cfg)
    rng = np.random.default_rng([cfg.seed, k, 3])
    data = circle_data(w, k, n_circles, n_items, n_targets, rng)
    out = []
    for (t, eps, mode, scen, know) in grid:
        if t > k:
            continue
        r = np.random.default_rng([cfg.seed, k, t, int(1000 * min(eps, 99)),
                                   SCENARIOS.index(scen), mode == "count", know == "personal"])
        out.append(evaluate(data, k, t, eps, mode, scen, r, know))
    return out


def default_grid() -> list:
    g = []
    for t in TS:
        for eps in EPS:
            for scen in SCENARIOS:
                g.append((t, eps, "set", scen, "group"))
            for scen in ("single", "diff_sticky"):
                g.append((t, eps, "count", scen, "group"))
            g.append((t, eps, "set", "single", "personal"))
    return g


def run(seed=0, cfg: WorldConfig = WorldConfig(), ks=KS, n_circles=60, n_items=150,
        n_targets=2, grid=None, out_dir=None, log=print, workers=None) -> dict:
    grid = grid or default_grid()
    t0 = time.time()
    res = parallel_map(_job, [(cfg.scaled(seed=seed), k, n_circles, n_items, n_targets, grid)
                              for k in ks], workers)
    rows = [r for rr in res for r in rr]
    log(f"  exp3: {len(rows)} configs in {time.time() - t0:.1f}s")
    write_csv(rows, out_path("exp3_circles.csv", out_dir))
    md = summary_markdown(rows, ks)
    with open(out_path("exp3_summary.md", out_dir), "w") as f:
        f.write(md + "\n")
    return {"rows": rows, "markdown": md}


def _pick(rows, **kw):
    return [r for r in rows if all(r[k] == v for k, v in kw.items())]


def _cell(rows, **kw) -> str:
    r = _pick(rows, **kw)
    if not r:
        return "–"
    r = r[0]
    return f"{r['delta_auc']:.3f} / {100 * r['conf90_recall']:.1f}%"


def summary_markdown(rows, ks) -> str:
    G = dict(knowledge="group")
    md = ["# Experiment 3: Circle output leakage", "",
          "Insider attacker, Bayes posterior. Cells are **ΔAUC / conf90**: ΔAUC = AUC(posterior) − "
          "AUC(prior); conf90 = share of the target's true endorsements that the attacker "
          "infers with ≥ 90% confidence (prior alone: ~0%). 'set' output (picks only) unless "
          "noted; attacker knows the circle's average endorse rate per item.", ""]
    md.append("## 1. No noise, single insider, by circle size k and reveal threshold t")
    md.append("")
    md += ["| k | " + " | ".join(f"t={t}" for t in TS) + " |", "|" + "---|" * (len(TS) + 1)]
    for k in ks:
        md.append(f"| {k} | " + " | ".join(
            _cell(rows, k=k, t=t, eps=math.inf, mode="set", scenario="single", **G)
            for t in TS) + " |")
    md.append("")
    for t in (2, 3, 4):
        md.append(f"## 2.{t} Attack scenarios at t = {t}")
        md.append("")
        md.append("| k | eps | " + " | ".join(SCENARIOS) + " | pick recall | pick precision |")
        md.append("|" + "---|" * (len(SCENARIOS) + 4))
        for k in ks:
            if t > k:
                continue
            for e in EPS:
                cells = [_cell(rows, k=k, t=t, eps=e, mode="set", scenario=sc, **G)
                         for sc in SCENARIOS]
                r = _pick(rows, k=k, t=t, eps=e, mode="set", scenario="single", **G)
                ur = f"{r[0]['util_recall']:.2f}" if r else "–"
                up = f"{r[0]['util_precision']:.2f}" if r else "–"
                md.append(f"| {k} | {e:g} | " + " | ".join(cells) + f" | {ur} | {up} |")
        md.append("")
    md.append("## 3. Showing noisy counts vs picks only (t = 3)")
    md.append("")
    md.append("| k | eps | set, single | count, single | count, diff_sticky |")
    md.append("|---|---|---|---|---|")
    for k in ks:
        for e in EPS:
            md.append(f"| {k} | {e:g} | "
                      + _cell(rows, k=k, t=3, eps=e, mode="set", scenario="single", **G) + " | "
                      + _cell(rows, k=k, t=3, eps=e, mode="count", scenario="single", **G) + " | "
                      + _cell(rows, k=k, t=3, eps=e, mode="count", scenario="diff_sticky", **G)
                      + " |")
    md.append("")
    md.append("## 4. Worst case: attacker knows every member's personal endorse probability "
              "(single insider, set output, t = 3)")
    md.append("")
    md.append("| k | eps | AUC prior | AUC posterior | ΔAUC | conf90 |")
    md.append("|---|---|---|---|---|---|")
    for k in ks:
        for e in EPS:
            r = _pick(rows, k=k, t=3, eps=e, mode="set", scenario="single", knowledge="personal")
            if r:
                r = r[0]
                md.append(f"| {k} | {e:g} | {r['auc_prior']:.3f} | {r['auc_post']:.3f} | "
                          f"{r['delta_auc']:.3f} | {100 * r['conf90_recall']:.1f}% |")
    return "\n".join(md)
