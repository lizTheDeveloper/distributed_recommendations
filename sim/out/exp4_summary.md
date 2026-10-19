# Experiment 4: PSI-cardinality preview leakage

3000 (target, video) pairs; targets have ≥ 20 endorsements; base rate of y_X = 0.054; the attacker's prior (population rate) has mean log-loss 0.313 bits, which is the most 'bits learned' can reach. Attacker pads probes with minted (never-watched) decoys, so the ≥20 minimum set size costs it nothing. Cells: AUC / bits learned / share of true positives inferred at ≥ 90% confidence.

## Attacker knows 0 items in the target's set

| mechanism | n=1 | n=2 | n=4 | n=8 | n=16 | n=32 |
|---|---|---|---|---|---|---|
| exact | 1.00 / 0.31 / 100% | 1.00 / 0.31 / 100% | 1.00 / 0.31 / 100% | 1.00 / 0.31 / 100% | 1.00 / 0.31 / 100% | 1.00 / 0.31 / 100% |
| floor5 | 0.59 / 0.00 / 0% | 0.58 / 0.00 / 0% | 0.58 / 0.00 / 0% | 0.57 / -0.00 / 0% | 0.58 / 0.01 / 2% | 0.57 / 0.00 / 1% |
| bucket | 0.58 / 0.00 / 0% | 0.59 / 0.00 / 0% | 0.58 / 0.00 / 0% | 0.59 / 0.00 / 0% | 0.57 / -0.00 / 0% | 0.57 / 0.00 / 1% |
| dp2 | 0.91 / 0.12 / 0% | 0.97 / 0.19 / 0% | 1.00 / 0.27 / 61% | 1.00 / 0.31 / 96% | 1.00 / 0.31 / 100% | 1.00 / 0.31 / 100% |
| dp1 | 0.76 / 0.03 / 0% | 0.85 / 0.08 / 0% | 0.90 / 0.11 / 0% | 0.99 / 0.22 / 31% | 0.99 / 0.26 / 71% | 1.00 / 0.31 / 97% |
| dp0.5 | 0.68 / 0.01 / 0% | 0.69 / 0.02 / 0% | 0.75 / 0.04 / 0% | 0.84 / 0.06 / 0% | 0.90 / 0.11 / 4% | 0.98 / 0.21 / 35% |
| floor5+dp1 | 0.58 / 0.00 / 0% | 0.61 / 0.01 / 0% | 0.65 / 0.01 / 0% | 0.69 / 0.02 / 0% | 0.67 / 0.02 / 0% | 0.74 / 0.04 / 1% |
| floor5+dp0.5 | 0.62 / 0.01 / 0% | 0.62 / 0.01 / 0% | 0.61 / 0.01 / 0% | 0.68 / 0.02 / 0% | 0.74 / 0.04 / 0% | 0.77 / 0.04 / 0% |

## Attacker knows 4 items in the target's set

| mechanism | n=1 | n=2 | n=4 | n=8 | n=16 | n=32 |
|---|---|---|---|---|---|---|
| exact | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% |
| floor5 | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% |
| bucket | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% |
| dp2 | 0.90 / 0.12 / 0% | 0.95 / 0.18 / 0% | 1.00 / 0.29 / 70% | 1.00 / 0.32 / 94% | 1.00 / 0.33 / 100% | 1.00 / 0.33 / 100% |
| dp1 | 0.79 / 0.04 / 0% | 0.83 / 0.07 / 0% | 0.93 / 0.14 / 0% | 0.98 / 0.22 / 27% | 1.00 / 0.29 / 72% | 1.00 / 0.32 / 95% |
| dp0.5 | 0.67 / 0.01 / 0% | 0.73 / 0.02 / 0% | 0.76 / 0.04 / 0% | 0.86 / 0.08 / 0% | 0.93 / 0.14 / 4% | 0.98 / 0.22 / 28% |
| floor5+dp1 | 0.74 / 0.03 / 0% | 0.83 / 0.07 / 0% | 0.90 / 0.12 / 0% | 0.97 / 0.20 / 26% | 1.00 / 0.30 / 76% | 1.00 / 0.32 / 95% |
| floor5+dp0.5 | 0.68 / 0.02 / 0% | 0.72 / 0.03 / 0% | 0.77 / 0.04 / 0% | 0.83 / 0.08 / 0% | 0.92 / 0.14 / 3% | 0.97 / 0.20 / 26% |

## Profiling: bits about the target's whole set per accepted preview (20 typical community items)

| mechanism | bits_per_preview |
|---|---|
| exact | 1.70 |
| floor5 | -0.00 |
| bucket | -0.00 |
| dp2 | 0.87 |
| dp1 | 0.32 |
| dp0.5 | 0.08 |
| floor5+dp1 | 0.01 |
| floor5+dp0.5 | 0.02 |

## Wall-clock under the design policy (1 preview / week / pair, target must accept)

Accepted previews per week = attacker accounts × acceptance rate. Weeks until ≥ 50% of the target's true positives are inferred at ≥ 90% confidence:

| mechanism | aux | accepted previews needed | 1 account, always accepted | 1 account, 10% accepted | 50 sybils, 10% accepted |
|---|---|---|---|---|---|
| exact | 0 | 1 | 1 wk | 10 wk | 1 wk |
| exact | 4 | 1 | 1 wk | 10 wk | 1 wk |
| floor5 | 0 | > 32 | > 32 wk | > 320 wk | > 7 wk |
| floor5 | 4 | 1 | 1 wk | 10 wk | 1 wk |
| bucket | 0 | > 32 | > 32 wk | > 320 wk | > 7 wk |
| bucket | 4 | 1 | 1 wk | 10 wk | 1 wk |
| dp2 | 0 | 4 | 4 wk | 40 wk | 1 wk |
| dp2 | 4 | 4 | 4 wk | 40 wk | 1 wk |
| dp1 | 0 | 16 | 16 wk | 160 wk | 4 wk |
| dp1 | 4 | 16 | 16 wk | 160 wk | 4 wk |
| dp0.5 | 0 | > 32 | > 32 wk | > 320 wk | > 7 wk |
| dp0.5 | 4 | > 32 | > 32 wk | > 320 wk | > 7 wk |
| floor5+dp1 | 0 | > 32 | > 32 wk | > 320 wk | > 7 wk |
| floor5+dp1 | 4 | 16 | 16 wk | 160 wk | 4 wk |
| floor5+dp0.5 | 0 | > 32 | > 32 wk | > 320 wk | > 7 wk |
| floor5+dp0.5 | 4 | > 32 | > 32 wk | > 320 wk | > 7 wk |

Without any policy (no acceptance, no rate limit, singleton probes allowed) a single query answers the question exactly: the 'exact' row at n = 1.
