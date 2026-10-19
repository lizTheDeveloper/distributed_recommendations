# Match Feed simulation harness

Synthetic-data simulations for the open questions in `docs/DESIGN.md` and the
"simulate T2, T3, T7" item in `docs/THREAT_MODEL.md`. Results and recommended
parameter values: `docs/SIMULATION_RESULTS.md`.

Pure Python 3 + numpy (tested with Python 3.13, numpy 2.5). No other dependencies.
Everything is seeded and reproducible; the number of worker processes doesn't
change results.

## Run

From the repository root:

```sh
python3 -m sim.run --all            # all five experiments, default sizes (~6-7 min total, 4 cores)
python3 -m sim.run --exp 1 3        # selected experiments
python3 -m sim.run --all --quick    # tiny world, smoke test (~20 s)
python3 -m sim.run --exp 2 --seed 5 --out /tmp/simout --workers 2
```

Outputs (default `sim/out/`):

| file | contents |
|---|---|
| `exp1_quality.csv`, `exp1_quality_raw.csv`, `exp1_summary.md` | recommender quality and creator exposure, strategies a–f |
| `exp2_explore.csv`, `exp2_explore_raw.csv`, `exp2_summary.md` | explore-share sweep, new-creator time-to-first-view |
| `exp3_circles.csv`, `exp3_summary.md` | Circle output leakage (T3) |
| `exp4_psi.csv`, `exp4_psi_profiling.csv`, `exp4_summary.md` | PSI-cardinality preview leakage (T2) |
| `exp5_sybil.csv`, `exp5_summary.md` | Sybil reach (T7) |
| `ALL_SUMMARIES.md` | all summaries concatenated |

Approximate runtimes on 4 cores: exp1 ~60 s, exp2 ~110 s, exp3 ~50 s, exp4 ~90 s, exp5 ~90 s.

## Tests

```sh
python3 -m unittest discover -s sim/tests -t .
```

Unit tests cover the world generator (shapes, mutual matches, reproducibility),
the privacy primitives (discrete Laplace pmf/sf/DP ratio, Poisson-binomial, AUC),
feed assembly (no re-recommendation, per-creator caps, explore share), and smoke
runs of every experiment with invariants (e.g. an exact PSI preview gives AUC 1;
no attack edges means zero Sybil reach; DP caps a colluding Circle attacker).

## Layout

| module | role |
|---|---|
| `world.py` | synthetic world: communities, viewer tastes, Pareto creator popularity, creator arrivals, videos with topic vectors and noisy tags, ground-truth endorse probability `P = sigmoid(6·taste·topic + 0.6·quality − 5)`, fixed labels `Y`; follows (preferential × taste), mutual homophilous matches (k = 3–15), circles (8–30), list owners and subscriptions; `initial_state` samples a popularity-biased exposure history |
| `recs.py` | strategies a–f, on-device trust (`peer_trust`), explore slots, capped top-k |
| `metrics.py` | precision/recall@20 vs `Y`, novelty, coverage, exposure Gini, long-tail and new-creator shares, cold-start quality |
| `privacy.py` | discrete Laplace noise, Poisson-binomial distributions |
| `common.py` | CSV/markdown output, AUC, advantage, process pool |
| `exp1_quality.py` … `exp5_sybil.py` | one module per experiment; each has `run(...)` |
| `run.py` | CLI |

## Main knobs

- World size and structure: `world.WorldConfig` (viewers, creators, communities,
  match k range, circle sizes, lists, cold-start share, endorsement model).
- Feed mixing: `recs.RecParams` (list/follow weights, second-degree decay,
  per-creator cap, explore share, what counts as "new"/"under-exposed").
  The default list/follow weights (0.15/0.1) were picked on seed 7, which is not
  one of the reported seeds.
- Experiment grids are module constants (`exp2_explore.SHARES`, `exp3_circles.KS/TS/EPS`,
  `exp4_psi.MECHS/QUERIES`, `exp5_sybil.SYBILS/EDGES`).

## Caveat

All data is synthetic. The harness compares mechanisms *relative to each other*
under stated assumptions. It cannot tell you absolute quality levels, real user
behaviour (acceptance rates, how people choose matches), or real catalog
statistics. See "Limitations" in `docs/SIMULATION_RESULTS.md`.
