import math
import unittest

import numpy as np

from sim.common import auc, h2, max_advantage
from sim.privacy import dlap_pmf, dlap_sample, dlap_sf, poisson_binomial


class PrivacyTests(unittest.TestCase):
    def test_dlap_pmf_sums_to_one(self):
        for eps in (0.25, 1.0, 3.0):
            z = np.arange(-400, 401)
            self.assertAlmostEqual(dlap_pmf(z, eps).sum(), 1.0, places=9)

    def test_dlap_sf_matches_pmf(self):
        for eps in (0.5, 2.0):
            z = np.arange(-300, 301)
            p = dlap_pmf(z, eps)
            for m in (-3, 0, 1, 4):
                self.assertAlmostEqual(dlap_sf(m, eps), p[z >= m].sum(), places=9)

    def test_dlap_no_noise(self):
        self.assertEqual(dlap_pmf(0, math.inf), 1.0)
        self.assertEqual(dlap_sf(1, math.inf), 0.0)
        self.assertEqual(dlap_sf(0, math.inf), 1.0)
        self.assertTrue((dlap_sample(np.random.default_rng(0), 10, math.inf) == 0).all())

    def test_dlap_sample_variance(self):
        eps = 1.0
        a = math.exp(-eps)
        z = dlap_sample(np.random.default_rng(0), 200000, eps)
        self.assertAlmostEqual(z.mean(), 0.0, delta=0.02)
        self.assertAlmostEqual(z.var(), 2 * a / (1 - a) ** 2, delta=0.05)

    def test_dp_ratio_bound(self):
        eps = 0.7
        z = np.arange(-50, 50)
        r = dlap_pmf(z, eps) / dlap_pmf(z - 1, eps)
        self.assertLessEqual(r.max(), math.exp(eps) + 1e-9)

    def test_poisson_binomial(self):
        p = np.array([[0.3] * 6, [0.1, 0.9, 0.5, 0.0, 1.0, 0.2]])
        d = poisson_binomial(p)
        binom = [math.comb(6, k) * 0.3 ** k * 0.7 ** (6 - k) for k in range(7)]
        np.testing.assert_allclose(d[0], binom, atol=1e-12)
        rng = np.random.default_rng(0)
        mc = (rng.random((200000, 6)) < p[1]).sum(1)
        np.testing.assert_allclose(d[1], np.bincount(mc, minlength=7) / 200000, atol=0.005)

    def test_auc_and_advantage(self):
        y = np.array([0, 0, 1, 1], bool)
        self.assertAlmostEqual(auc(np.array([0.1, 0.4, 0.35, 0.8]), y), 0.75)
        self.assertAlmostEqual(auc(np.ones(4), y), 0.5)
        self.assertAlmostEqual(auc(np.array([0, 0, 1, 1.0]), y), 1.0)
        self.assertAlmostEqual(max_advantage(np.array([0, 0, 1, 1.0]), y), 1.0)
        self.assertAlmostEqual(max_advantage(np.ones(4), y), 0.0)
        self.assertAlmostEqual(float(h2(0.5)), 1.0)


if __name__ == "__main__":
    unittest.main()
