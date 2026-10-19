"""Smoke tests: every experiment runs on a tiny world and satisfies basic invariants."""
import math
import os
import tempfile
import unittest

import numpy as np

from sim import exp1_quality, exp2_explore, exp3_circles, exp4_psi, exp5_sybil
from sim.world import QUICK

quiet = lambda *a, **k: None


class ExperimentSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="simtest_")

    def test_exp1(self):
        r = exp1_quality.run(seeds=(0,), cfg=QUICK, out_dir=self.tmp, log=quiet)
        names = [a["variant"] for a in r["agg"]]
        self.assertIn("a_global_cf", names)
        for a in r["agg"]:
            self.assertTrue(0 <= a["precision@k"] <= 1)
            self.assertTrue(0 <= a["creator_gini"] <= 1)
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "exp1_quality.csv")))

    def test_exp2(self):
        r = exp2_explore.run(seeds=(0,), cfg=QUICK, shares=(0.0, 0.10), random_shares=(),
                             sens_shares=(), out_dir=self.tmp, log=quiet, workers=1)
        by = {a["explore_share"]: a for a in r["agg"]}
        self.assertEqual(by[0.0]["first_view_via_explore"], 0.0)
        # more explore -> new creators found at least as fast (on average)
        self.assertLessEqual(by[0.10]["ttfv_mean_capped_wk"], by[0.0]["ttfv_mean_capped_wk"])

    def test_exp3(self):
        grid = [(2, math.inf, "set", "single", "group"), (2, math.inf, "set", "collude", "group"),
                (2, 1.0, "set", "collude", "group"), (2, math.inf, "count", "diff_sticky", "group")]
        r = exp3_circles.run(cfg=QUICK, ks=(8,), n_circles=10, n_items=60, grid=grid,
                             out_dir=self.tmp, log=quiet, workers=1)
        rows = {(x["eps"], x["scenario"], x["mode"]): x for x in r["rows"]}
        coll = rows[(math.inf, "collude", "set")]
        self.assertGreaterEqual(coll["delta_auc"], rows[(math.inf, "single", "set")]["delta_auc"])
        # DP bounds a colluding attacker's confidence: with eps=1 and a ~15% prior, the
        # posterior cannot reach 0.9 from a single release
        self.assertEqual(rows[(1.0, "collude", "set")]["conf90_recall"], 0.0)
        self.assertTrue(0 <= rows[(math.inf, "single", "set")]["util_recall"] <= 1)

    def test_exp4(self):
        r = exp4_psi.run(cfg=QUICK, n_pairs=200, out_dir=self.tmp, log=quiet)
        ex = [x for x in r["rows"] if x["mechanism"] == "exact" and x["queries"] == 1][0]
        self.assertAlmostEqual(ex["auc"], 1.0)
        dp = [x for x in r["rows"] if x["mechanism"] == "dp0.5" and x["queries"] == 1
              and x["aux_known"] == 0][0]
        self.assertLess(dp["auc"], 0.95)

    def test_exp5(self):
        r = exp5_sybil.run(cfg=QUICK, sybils=(10,), edges=(0, 10), out_dir=self.tmp,
                           log=quiet, workers=1)
        for x in r["rows"]:
            if x["attack_edges"] == 0:
                self.assertEqual(x["reach_all"], 0.0)
            self.assertTrue(0 <= x["reach_all"] <= 1)


if __name__ == "__main__":
    unittest.main()
