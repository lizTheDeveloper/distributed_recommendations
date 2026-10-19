"""Small I/O and aggregation helpers (stdlib + numpy only)."""
from __future__ import annotations

import csv
import math
import os
from collections import OrderedDict

import numpy as np

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")


def out_path(name: str, out_dir: str | None = None) -> str:
    d = out_dir or OUT_DIR
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, name)


def write_csv(rows: list[dict], path: str) -> None:
    if not rows:
        return
    cols = list(OrderedDict.fromkeys(k for r in rows for k in r))
    with open(path, "w", newline="") as f:
        wr = csv.DictWriter(f, fieldnames=cols)
        wr.writeheader()
        for r in rows:
            wr.writerow({k: _fmt(r.get(k, "")) for k in cols})


def _fmt(v):
    if isinstance(v, (float, np.floating)):
        if math.isnan(v):
            return "nan"
        return f"{v:.6g}"
    return v


def aggregate(rows: list[dict], keys: list[str], metrics: list[str]) -> list[dict]:
    """Group rows by ``keys``; report mean and sample sd (over seeds) of ``metrics``."""
    groups: "OrderedDict[tuple, list[dict]]" = OrderedDict()
    for r in rows:
        groups.setdefault(tuple(r[k] for k in keys), []).append(r)
    out = []
    for key, rs in groups.items():
        row = dict(zip(keys, key))
        row["n"] = len(rs)
        for m in metrics:
            vals = np.array([float(r[m]) for r in rs], dtype=float)
            vals = vals[~np.isnan(vals)]
            row[m] = float(vals.mean()) if len(vals) else float("nan")
            row[m + "_sd"] = float(vals.std(ddof=1)) if len(vals) > 1 else 0.0
        out.append(row)
    return out


def md_table(rows: list[dict], cols: list[str], digits: int = 3, sd: bool = False,
             headers: dict | None = None) -> str:
    headers = headers or {}
    lines = ["| " + " | ".join(headers.get(c, c) for c in cols) + " |",
             "|" + "|".join("---" for _ in cols) + "|"]
    for r in rows:
        cells = []
        for c in cols:
            v = r.get(c, "")
            if isinstance(v, (float, np.floating)):
                if math.isnan(v):
                    s = "n/a"
                elif math.isinf(v):
                    s = "inf"
                else:
                    s = f"{v:.{digits}f}"
                if sd and (c + "_sd") in r and r.get("n", 1) > 1:
                    s += f" ±{r[c + '_sd']:.{digits}f}"
            else:
                s = str(v)
            cells.append(s)
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def auc(scores: np.ndarray, labels: np.ndarray) -> float:
    """ROC AUC with tie handling (Mann-Whitney U)."""
    scores = np.asarray(scores, dtype=float)
    labels = np.asarray(labels, dtype=bool)
    npos, nneg = labels.sum(), (~labels).sum()
    if npos == 0 or nneg == 0:
        return float("nan")
    order = np.argsort(scores, kind="mergesort")
    s = scores[order]
    ranks = np.empty(len(s))
    i = 0
    while i < len(s):
        j = i
        while j + 1 < len(s) and s[j + 1] == s[i]:
            j += 1
        ranks[i:j + 1] = (i + j) / 2.0 + 1
        i = j + 1
    r = np.empty(len(s))
    r[order] = ranks
    return float((r[labels].sum() - npos * (npos + 1) / 2) / (npos * nneg))


def max_advantage(scores: np.ndarray, labels: np.ndarray) -> float:
    """max over thresholds of TPR - FPR (membership-inference advantage)."""
    scores = np.asarray(scores, dtype=float)
    labels = np.asarray(labels, dtype=bool)
    npos, nneg = labels.sum(), (~labels).sum()
    if npos == 0 or nneg == 0:
        return float("nan")
    order = np.argsort(-scores, kind="mergesort")
    s, l = scores[order], labels[order]
    tp = np.cumsum(l)
    fp = np.cumsum(~l)
    last = np.r_[s[1:] != s[:-1], True]           # evaluate only at distinct thresholds
    return float(np.max(np.r_[0.0, (tp / npos - fp / nneg)[last]]))


def h2(p) -> np.ndarray:
    """Binary entropy in bits."""
    p = np.clip(np.asarray(p, dtype=float), 1e-12, 1 - 1e-12)
    return -(p * np.log2(p) + (1 - p) * np.log2(1 - p))


def parallel_map(fn, jobs: list, workers: int | None = None) -> list:
    """Order-preserving map over a process pool (stdlib). ``workers=1`` runs inline.
    Results do not depend on the number of workers: every job seeds its own RNGs."""
    if workers is None:
        workers = min(len(jobs), os.cpu_count() or 1, 4)
    if workers <= 1 or len(jobs) <= 1:
        return [fn(j) for j in jobs]
    import multiprocessing as mp
    ctx = mp.get_context("fork") if hasattr(os, "fork") else mp.get_context()
    with ctx.Pool(workers) as pool:
        return pool.map(fn, jobs, chunksize=1)
