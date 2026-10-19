import unittest

import numpy as np

from sim.recs import Context, RecParams, make_feeds, peer_trust, select_topk
from sim.world import QUICK, build_world, initial_state


class RecTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = build_world(QUICK)
        cls.s = initial_state(cls.w)
        cls.ctx = Context(cls.w, cls.s, RecParams())

    def test_select_topk_cap_and_allowed(self):
        rng = np.random.default_rng(0)
        sc = rng.random((4, 30)).astype(np.float32)
        allowed = np.ones((4, 30), bool)
        allowed[:, :5] = False
        creator = np.repeat(np.arange(10), 3)
        out = select_topk(sc, allowed, 8, creator, cap=1)
        for row in out:
            row = row[row >= 0]
            self.assertTrue((row >= 5).all())
            self.assertEqual(len(np.unique(creator[row])), len(row))
        out2 = select_topk(sc, allowed, 3, creator, cap=None)
        best = np.argsort(-np.where(allowed, sc, -np.inf), axis=1)[:, :3]
        self.assertTrue((np.sort(out2, 1) == np.sort(best, 1)).all())

    def test_feeds_valid_for_all_strategies(self):
        for strat in "abcdef":
            f, ex = make_feeds(self.ctx, strat, np.random.default_rng(1))
            self.assertEqual(f.shape, (self.w.N, 20))
            valid = f >= 0
            rows = np.broadcast_to(np.arange(self.w.N)[:, None], f.shape)
            self.assertFalse(self.s.exposed[rows[valid], f[valid]].any(), strat)
            for r in f:                                   # no duplicates in a feed
                r = r[r >= 0]
                self.assertEqual(len(np.unique(r)), len(r))
            if strat in "def":
                # per-creator cap (2) applies to the non-explore part of the feed
                cr = self.w.video_creator[np.where(valid, f, 0)]
                for c_row, keep in zip(cr, valid & ~ex):
                    _, cnt = np.unique(c_row[keep], return_counts=True)
                    self.assertLessEqual(cnt.max(initial=0), 2, strat)

    def test_explore_share(self):
        _, ex = make_feeds(self.ctx, "f", np.random.default_rng(2), explore_share=0.10)
        self.assertAlmostEqual(ex.mean(), 0.10, delta=0.03)
        _, ex0 = make_feeds(self.ctx, "f", np.random.default_rng(2), explore_share=0.0)
        self.assertEqual(ex0.sum(), 0)

    def test_peer_trust_rows(self):
        T1 = peer_trust(self.w.adj, self.s.E, self.w.optin, 0.3, False)
        deg = self.w.adj.sum(1)
        np.testing.assert_allclose(T1.sum(1)[deg > 0], 1.0, atol=1e-5)
        self.assertTrue((T1[~self.w.adj] == 0).all())
        T2 = peer_trust(self.w.adj, self.s.E, self.w.optin, 0.3, True)
        self.assertTrue((T2 >= T1 - 1e-7).all())
        self.assertTrue(np.allclose(np.diag(T2), 0))


if __name__ == "__main__":
    unittest.main()
