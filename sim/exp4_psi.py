"""Experiment 4: PSI-cardinality preview leakage (THREAT_MODEL T2).

A preview tells two users |S_A ∩ S_T| for their sketch sets (endorsements by
default). An attacker A wants to know whether target T has video X in S_T.

Attacker strategy (best response over a small grid, per mechanism):
  probe = {X} ∪ (j_aux items A already knows T has) ∪ (j_pop popular "filler"
          items from T's community, redrawn each query) ∪ minted decoys
Minted decoys are videos A uploads that nobody has watched; they pad the probe to
the minimum set size at zero cost and contribute exactly 0 to the count. This is
why a minimum set size alone does not protect anything.

Mechanisms for what the preview reveals:
  exact          |S_A ∩ S_T|
  floor5         exact if >= 5, else "fewer than 5"
  bucket         {0-4, 5-9, 10-19, 20+}
  dp_eps         count + discrete Laplace(eps) (fresh noise per preview)
  floor5+dp1     dp_1, then floor 5 applied to the noisy count

Metrics vs. number of *accepted* previews n: attacker AUC for y_X, bits learned
(mean reduction in log-loss of the attacker's belief about y_X vs. the prior;
can be < 0 if the attacker's model is miscalibrated), share of positives
inferred with >= 90% confidence. Also: bits about the whole set revealed by one
preview of 20 unknown items ("profiling", entropy of the response).
Policy timing converts queries to weeks: under the design (1 preview/week/pair,
target must accept), accepted previews per week = attacker accounts x acceptance
rate.
"""
from __future__ import annotations

import math
import time
import zlib

import numpy as np

from .common import auc, h2, md_table, out_path, write_csv
from .privacy import dlap_pmf, dlap_sample, dlap_sf, poisson_binomial
from .world import WorldConfig, build_world, initial_state

MECHS = ("exact", "floor5", "bucket", "dp2", "dp1", "dp0.5", "floor5+dp1", "floor5+dp0.5")
QUERIES = (1, 2, 4, 8, 16, 32)
MIN_SET = 20
CMAX = 64          # max count we model


def _mech_obs(mech: str, c: np.ndarray, rng) -> np.ndarray:
    if mech == "exact":
        return c
    if mech == "floor5":
        return np.where(c >= 5, c, -1)
    if mech == "bucket":
        return np.digitize(c, [5, 10, 20])
    if mech.startswith("floor5+dp"):
        n = c + dlap_sample(rng, c.shape, float(mech[len("floor5+dp"):]))
        return np.where(n >= 5, n, -1)
    if mech.startswith("dp"):
        return c + dlap_sample(rng, c.shape, float(mech[2:]))
    raise ValueError(mech)


def _mech_lik(mech: str, obs: np.ndarray) -> np.ndarray:
    """P(obs | c) for c = 0..CMAX, shape (n, CMAX+1)."""
    c = np.arange(CMAX + 1)[None, :]
    o = obs[:, None]
    if mech == "exact":
        return (o == c).astype(float)
    if mech == "floor5":
        return np.where(o == -1, (c < 5), (o == c)).astype(float)
    if mech == "bucket":
        return (np.digitize(c, [5, 10, 20]) == o).astype(float)
    if mech.startswith("floor5+dp"):
        e = float(mech[len("floor5+dp"):])
        return np.where(o == -1, 1 - dlap_sf(5 - c, e), dlap_pmf(o - c, e))
    if mech.startswith("dp"):
        return dlap_pmf(o - c, float(mech[2:]))
    raise ValueError(mech)


def build_pairs(w, s, n_pairs: int, rng, aux_known: int):
    """Targets with >= MIN_SET endorsements; X drawn from items with a population
    endorsement rate >= 2%. Returns arrays used by the attack."""
    S = s.E
    sizes = S.sum(1)
    targets = np.flatnonzero(sizes >= MIN_SET)
    pop_rate = S.mean(0)
    xs_pool = np.flatnonzero(pop_rate >= 0.02)
    T = rng.choice(targets, n_pairs)
    X = rng.choice(xs_pool, n_pairs)
    y = S[T, X]
    prior = np.clip(pop_rate[X], 1e-4, 1 - 1e-4)
    # community-level rates: the attacker's model for filler items
    comm_rate = np.zeros((w.cfg.n_communities, w.V))
    for c in range(w.cfg.n_communities):
        m = w.comm_u == c
        if m.any():
            comm_rate[c] = S[m].mean(0)
    aux = []
    for t, x in zip(T, X):
        mem = np.flatnonzero(S[t])
        mem = mem[mem != x]
        aux.append(rng.choice(mem, min(aux_known, len(mem)), replace=False))
    # filler candidates: the 200 most common items in T's community (minus X and aux)
    top = np.argsort(-comm_rate, axis=1)[:, :200]
    fill_cand = top[w.comm_u[T]].copy()
    fill_q = np.take_along_axis(comm_rate[w.comm_u[T]], fill_cand, 1)
    fill_in = S[T[:, None], fill_cand]
    for i in range(len(T)):
        bad = (fill_cand[i] == X[i]) | np.isin(fill_cand[i], aux[i])
        fill_q[i, bad] = 0.0                  # attacker drops these: count 0, model 0
        fill_in[i, bad] = False
    return dict(T=T, X=X, y=y, prior=prior, comm_rate=comm_rate, S=S, aux=aux,
                fill_cand=fill_cand, fill_q=fill_q, fill_in=fill_in)


def attack(w, d, mech: str, j_aux: int, j_pop: int, n_queries: int, seed: int) -> np.ndarray:
    """Return the attacker's posterior P(y_X = 1) after n_queries accepted previews."""
    rng = np.random.default_rng(seed)
    T, X, y, prior, S = d["T"], d["X"], d["y"], d["prior"], d["S"]
    n = len(T)
    logL = np.zeros((n, 2))
    base = np.array([min(j_aux, len(a)) for a in d["aux"]])      # known members: count exactly
    cand = d["fill_cand"]                                         # (n, 200)
    cand_q = d["fill_q"]
    cand_in = d["fill_in"]
    for q in range(n_queries):
        c_true = y.astype(int) + base
        PF = np.zeros((n, CMAX + 1))
        if j_pop > 0:
            pick = np.argpartition(rng.random(cand.shape), j_pop - 1, axis=1)[:, :j_pop]
            qf = np.take_along_axis(cand_q, pick, 1)
            c_true = c_true + np.take_along_axis(cand_in, pick, 1).sum(1)
            PF[:, :j_pop + 1] = poisson_binomial(qf)
        else:
            PF[:, 0] = 1.0
        obs = _mech_obs(mech, c_true, rng)
        g = _mech_lik(mech, obs)                                  # (n, CMAX+1)
        for yy in (0, 1):
            shift = base + yy
            # P(obs | y) = sum_f PF[f] g[shift + f]
            idx = np.minimum(shift[:, None] + np.arange(CMAX + 1)[None, :], CMAX)
            lik = (PF * np.take_along_axis(g, idx, 1)).sum(1)
            logL[:, yy] += np.log(np.maximum(lik, 1e-300))
    lo = np.log(prior) - np.log1p(-prior) + logL[:, 1] - logL[:, 0]
    return 1.0 / (1.0 + np.exp(-np.clip(lo, -50, 50)))


def score(post, y, prior) -> dict:
    lab = y.astype(bool)
    llp = -np.log2(np.where(lab, prior, 1 - prior))
    llq = -np.log2(np.clip(np.where(lab, post, 1 - post), 1e-12, 1))
    conf = post >= 0.9
    return {"auc": auc(post, lab), "bits": float((llp - llq).mean()),
            "conf90_recall": float(conf[lab].mean()) if lab.any() else float("nan"),
            "conf90_precision": float(lab[conf].mean()) if conf.any() else float("nan")}


def profiling_bits(mech: str, qf: np.ndarray, n_mc: int = 4000, seed: int = 0) -> float:
    """Bits about the target's set revealed by one preview of items with
    membership probs ``qf`` (attacker's model): I = H(response) - H(response|set)."""
    rng = np.random.default_rng(seed)
    c = (rng.random((n_mc, len(qf))) < qf[None, :]).sum(1)
    obs = _mech_obs(mech, c, rng)
    _, cnt = np.unique(obs, return_counts=True)
    p = cnt / cnt.sum()
    H = float(-(p * np.log2(p)).sum())
    if mech.startswith("dp") or "+dp" in mech:
        # subtract noise entropy given c (exact for dp; upper bound for floor+dp)
        e = float(mech.split("dp")[-1])
        z = np.arange(-60, 61)
        pz = dlap_pmf(z, e)
        Hn = float(-(pz[pz > 0] * np.log2(pz[pz > 0])).sum())
        if mech.startswith("dp"):
            return max(H - Hn, 0.0)
        # floor5+dp: estimate H(obs|c) by MC per c value
        Hc = 0.0
        vals, cc = np.unique(c, return_counts=True)
        for v, k in zip(vals, cc):
            o = _mech_obs(mech, np.full(2000, v), rng)
            _, oc = np.unique(o, return_counts=True)
            po = oc / oc.sum()
            Hc += k / len(c) * float(-(po * np.log2(po)).sum())
        return max(H - Hc, 0.0)
    return H


def run(seed=0, cfg: WorldConfig = WorldConfig(), n_pairs=3000, out_dir=None, log=print) -> dict:
    t0 = time.time()
    w = build_world(cfg.scaled(seed=seed))
    s = initial_state(w)
    rng = np.random.default_rng([seed, 4])
    rows = []
    for aux_known in (0, 4):
        d = build_pairs(w, s, n_pairs, rng, aux_known)
        for mech in MECHS:
            strategies = [(ja, jp) for ja in sorted({0, aux_known}) for jp in (0, 2, 4, 8, 15)]
            for nq in QUERIES:
                best = None
                for ja, jp in strategies:
                    if mech == "exact" and (ja, jp) != (0, 0):
                        continue                     # singleton+decoys is already exact
                    post = attack(w, d, mech, ja, jp, nq,
                                  seed=zlib.crc32(f"{seed}/{mech}/{ja}/{jp}/{nq}".encode()))
                    sc = score(post, d["y"], d["prior"])
                    if best is None or sc["bits"] > best["bits"]:
                        best = {**sc, "j_aux": ja, "j_pop": jp}
                rows.append({"aux_known": aux_known, "mechanism": mech, "queries": nq,
                             "base_rate": float(d["y"].mean()),
                             "prior_entropy_bits": float(h2(d["prior"]).mean()),
                             "prior_logloss_bits": float(-np.log2(np.where(
                                 d["y"], d["prior"], 1 - d["prior"])).mean()), **best})
        log(f"  exp4 aux={aux_known}: {time.time() - t0:.1f}s")
    # profiling: one preview of 20 typical community items
    cr = np.sort(d["comm_rate"][0])[::-1][:200]
    qf = cr[np.linspace(0, 199, 20).astype(int)]
    prof = [{"mechanism": m, "bits_per_preview": profiling_bits(m, qf)} for m in MECHS]
    write_csv(rows, out_path("exp4_psi.csv", out_dir))
    write_csv(prof, out_path("exp4_psi_profiling.csv", out_dir))
    md = summary_markdown(rows, prof, n_pairs)
    with open(out_path("exp4_summary.md", out_dir), "w") as f:
        f.write(md + "\n")
    log(f"  exp4 total {time.time() - t0:.1f}s")
    return {"rows": rows, "profiling": prof, "markdown": md}


def queries_to(rows, aux, mech, key="conf90_recall", target=0.5):
    for r in sorted((r for r in rows if r["aux_known"] == aux and r["mechanism"] == mech),
                    key=lambda r: r["queries"]):
        if r[key] >= target:
            return r["queries"]
    return None


def summary_markdown(rows, prof, n_pairs) -> str:
    md = ["# Experiment 4: PSI-cardinality preview leakage", "",
          f"{n_pairs} (target, video) pairs; targets have ≥ {MIN_SET} endorsements; "
          f"base rate of y_X = {rows[0]['base_rate']:.3f}; the attacker's prior (population "
          f"rate) has mean log-loss {rows[0]['prior_logloss_bits']:.3f} bits, which is the most "
          "'bits learned' can reach. Attacker pads probes with minted "
          "(never-watched) decoys, so the ≥20 minimum set size costs it nothing. "
          "Cells: AUC / bits learned / share of true positives inferred at ≥ 90% confidence.", ""]
    for aux in (0, 4):
        md.append(f"## Attacker knows {aux} items in the target's set")
        md.append("")
        md.append("| mechanism | " + " | ".join(f"n={q}" for q in QUERIES) + " |")
        md.append("|" + "---|" * (len(QUERIES) + 1))
        for m in MECHS:
            cells = []
            for q in QUERIES:
                r = [x for x in rows if x["aux_known"] == aux and x["mechanism"] == m
                     and x["queries"] == q][0]
                cells.append(f"{r['auc']:.2f} / {r['bits']:.2f} / {100 * r['conf90_recall']:.0f}%")
            md.append(f"| {m} | " + " | ".join(cells) + " |")
        md.append("")
    md.append("## Profiling: bits about the target's whole set per accepted preview "
              "(20 typical community items)")
    md.append("")
    md.append(md_table(prof, ["mechanism", "bits_per_preview"], digits=2))
    md.append("")
    md.append("## Wall-clock under the design policy (1 preview / week / pair, target must accept)")
    md.append("")
    md.append("Accepted previews per week = attacker accounts × acceptance rate. Weeks until "
              "≥ 50% of the target's true positives are inferred at ≥ 90% confidence:")
    md.append("")
    md.append("| mechanism | aux | accepted previews needed | 1 account, always accepted | "
              "1 account, 10% accepted | 50 sybils, 10% accepted |")
    md.append("|---|---|---|---|---|---|")
    for m in MECHS:
        for aux in (0, 4):
            q = queries_to(rows, aux, m)
            if q is None:
                md.append(f"| {m} | {aux} | > {QUERIES[-1]} | > {QUERIES[-1]} wk | "
                          f"> {QUERIES[-1] * 10} wk | > {math.ceil(QUERIES[-1] / 5)} wk |")
            else:
                md.append(f"| {m} | {aux} | {q} | {q} wk | {q * 10} wk | "
                          f"{math.ceil(q / 5)} wk |")
    md.append("")
    md.append("Without any policy (no acceptance, no rate limit, singleton probes allowed) a "
              "single query answers the question exactly: the 'exact' row at n = 1.")
    return "\n".join(md)
