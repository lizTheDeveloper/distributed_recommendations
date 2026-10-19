import unittest

import numpy as np

from sim.world import QUICK, build_world, gini, gumbel_topk_mask, initial_state, list_items


class WorldTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = build_world(QUICK)
        cls.s = initial_state(cls.w)

    def test_shapes_and_ranges(self):
        w = self.w
        self.assertEqual(w.P.shape, (w.N, w.V))
        self.assertTrue(((w.P > 0) & (w.P < 1)).all())
        self.assertEqual(w.Y.dtype, bool)
        self.assertTrue(0.01 < w.P.mean() < 0.2)

    def test_matches_mutual_bounded(self):
        a = self.w.adj
        self.assertTrue((a == a.T).all())
        self.assertFalse(a.diagonal().any())
        self.assertLessEqual(a.sum(1).max(), QUICK.match_k_max)

    def test_circles_sizes(self):
        for c in self.w.circles:
            self.assertTrue(QUICK.circle_min <= len(c) <= QUICK.circle_max)
            self.assertEqual(len(np.unique(c)), len(c))

    def test_reproducible(self):
        w2 = build_world(QUICK)
        self.assertTrue((w2.Y == self.w.Y).all())
        self.assertTrue((w2.adj == self.w.adj).all())
        w3 = build_world(QUICK.scaled(seed=1))
        self.assertFalse(np.array_equal(w3.taste, self.w.taste))

    def test_state_consistency(self):
        s = self.s
        self.assertTrue((s.E <= s.exposed).all())          # endorse only what you saw
        self.assertTrue((s.E <= self.w.Y).all())           # and only if you'd endorse it
        self.assertTrue(s.exposed[self.w.cold].sum(1).max() <= 8)

    def test_list_items(self):
        L = list_items(self.w, self.s)
        self.assertLessEqual(L.sum(1).max(), QUICK.list_len)
        owners = self.w.list_owner
        self.assertTrue((L <= self.s.E[owners]).all())

    def test_gumbel_topk_counts(self):
        rng = np.random.default_rng(0)
        logw = np.zeros((5, 50), dtype=np.float32)
        logw[:, :10] = -np.inf
        k = np.array([0, 1, 5, 40, 45])
        m = gumbel_topk_mask(logw, k, rng)
        self.assertEqual(m.sum(1).tolist(), [0, 1, 5, 40, 40])
        self.assertFalse(m[:, :10].any())

    def test_gini(self):
        self.assertAlmostEqual(gini(np.ones(10)), 0.0)
        self.assertAlmostEqual(gini(np.r_[np.zeros(99), 1.0]), 0.99, places=6)


if __name__ == "__main__":
    unittest.main()
