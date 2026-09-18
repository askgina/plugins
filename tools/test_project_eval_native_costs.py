import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "native_costs", Path(__file__).with_name("project-eval-native-costs.py"))
native_costs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native_costs)


class NativeCostProjectionTests(unittest.TestCase):
    def setUp(self):
        self.records = [{"type": "message", "id": "one", "message": {
            "role": "assistant", "provider": "test", "model": "model",
            "content": "private content must not appear in the projection",
            "usage": {"input": 2, "output": 3, "cacheRead": 5, "cacheWrite": 7,
                      "totalTokens": 17, "cost": {
                          "input": .002, "output": .03, "cacheRead": .005,
                          "cacheWrite": .07, "total": .107}},
        }}]
        self.observed = {"input_tokens": 2, "output_tokens": 3, "total_tokens": 5}

    def project(self):
        return native_costs.native_cost(self.records, "test/model", self.observed)

    def test_includes_cache_cost_without_treating_cache_as_uncached_input(self):
        result = self.project()
        self.assertAlmostEqual(result["usdTotal"], .107)
        self.assertEqual(result["inputTokens"], 2)
        self.assertEqual(result["cacheReadTokens"], 5)
        self.assertEqual(result["cacheWriteTokens"], 7)
        self.assertTrue(all(type(value) in (int, float) for value in result.values()))

    def test_rejects_wrong_model_or_observation(self):
        self.observed["input_tokens"] += 1
        with self.assertRaisesRegex(ValueError, "usage mismatch"):
            self.project()
        self.observed["input_tokens"] -= 1
        self.records[0]["message"]["model"] = "other"
        with self.assertRaisesRegex(ValueError, "model mismatch"):
            self.project()

    def test_rejects_duplicate_messages(self):
        self.records.append(copy.deepcopy(self.records[0]))
        with self.assertRaisesRegex(ValueError, "message ID"):
            self.project()

    def test_rejects_unknown_zero_prices_and_invalid_costs(self):
        cost = self.records[0]["message"]["usage"]["cost"]
        for value in (0, -1, float("inf"), float("nan"), None):
            with self.subTest(value=value):
                cost["cacheRead"] = value
                with self.assertRaises(ValueError):
                    self.project()

    def test_rejects_missing_cost_on_any_call(self):
        second = copy.deepcopy(self.records[0])
        second["id"] = "two"
        del second["message"]["usage"]["cost"]
        self.records.append(second)
        with self.assertRaisesRegex(ValueError, "cost component"):
            self.project()

    def test_rejects_inconsistent_total(self):
        self.records[0]["message"]["usage"]["cost"]["total"] = 1
        with self.assertRaisesRegex(ValueError, "reconcile"):
            self.project()

    def test_rejects_duplicate_json_keys(self):
        with self.assertRaisesRegex(ValueError, "duplicate JSON key"):
            native_costs.decode('{"cost":1,"cost":0}')

    def test_prices_inclusive_input_with_cache_discount_once(self):
        estimate = native_costs.token_cost(1000000, 1000000, 800000, native_costs.MUSE_RATES)
        self.assertAlmostEqual(estimate["usdTotal"], .25 + .12 + 4.25)
        self.assertEqual(estimate["inputTokens"], 200000)
        with self.assertRaisesRegex(ValueError, "exceeds"):
            native_costs.token_cost(1, 2, 3, native_costs.MUSE_RATES)

    def test_requires_explicit_catalogue_free_tier(self):
        row = {"nativeModel": "test-model"}
        catalogue = {"selectedModel": "test-model", "variant": {"model_uid": "test-model", "cost_tier": "Free"}}
        rates, method = native_costs.devin_rates(catalogue, row)
        self.assertEqual(method, "catalogue_free_tier")
        self.assertEqual(native_costs.token_cost(100, 200, 50, rates)["usdTotal"], 0)
        del catalogue["variant"]["cost_tier"]
        with self.assertRaisesRegex(ValueError, "pricing"):
            native_costs.devin_rates(catalogue, row)


if __name__ == "__main__":
    unittest.main()
