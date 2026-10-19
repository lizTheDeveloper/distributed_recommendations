"""Privacy primitives for experiments 3 and 4: discrete Laplace noise and
Poisson-binomial count distributions."""
from __future__ import annotations

import math

import numpy as np


def dlap_alpha(eps: float) -> float:
    return 0.0 if math.isinf(eps) else math.exp(-eps)


def dlap_pmf(z, eps: float) -> np.ndarray:
    """Two-sided geometric (discrete Laplace) pmf, P(Z=z) ∝ exp(-eps|z|).
    Adding it to a count gives eps-DP for that count (sensitivity 1)."""
    z = np.asarray(z)
    a = dlap_alpha(eps)
    if a == 0.0:
        return (z == 0).astype(float)
    return (1 - a) / (1 + a) * a ** np.abs(z)


def dlap_sf(m, eps: float) -> np.ndarray:
    """P(Z >= m)."""
    m = np.asarray(m, dtype=float)
    a = dlap_alpha(eps)
    if a == 0.0:
        return (m <= 0).astype(float)
    pos = a ** np.maximum(m, 0) / (1 + a)               # m >= 1
    neg = 1 - a ** np.maximum(1 - m, 0) / (1 + a)       # m <= 0
    return np.where(m >= 1, pos, neg)


def dlap_sample(rng: np.random.Generator, shape, eps: float) -> np.ndarray:
    a = dlap_alpha(eps)
    if a == 0.0:
        return np.zeros(shape, dtype=np.int64)
    g1 = rng.geometric(1 - a, size=shape) - 1
    g2 = rng.geometric(1 - a, size=shape) - 1
    return (g1 - g2).astype(np.int64)


def dlap_support(eps: float, tail: float = 1e-9) -> int:
    """Half-width beyond which discrete-Laplace mass is below ``tail``."""
    a = dlap_alpha(eps)
    if a == 0.0:
        return 0
    return int(math.ceil(math.log(tail) / math.log(a)))


def poisson_binomial(p: np.ndarray, size: int | None = None) -> np.ndarray:
    """Row-wise distribution of the sum of independent Bernoulli(p[:, j]).
    Returns shape (n, size) with size >= m+1 (zero padded)."""
    p = np.atleast_2d(np.asarray(p, dtype=float))
    n, m = p.shape
    size = m + 1 if size is None else size
    d = np.zeros((n, max(size, m + 1)))
    d[:, 0] = 1.0
    for j in range(m):
        pj = p[:, j:j + 1]
        d[:, 1:] = d[:, 1:] * (1 - pj) + d[:, :-1] * pj
        d[:, 0] *= (1 - pj[:, 0])
    return d[:, :size]
