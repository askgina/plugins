"""Synthetic tests: no private campaign evidence is required."""
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "projector", Path(__file__).parents[1] / "project-eval-grok47.py"
)
projector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(projector)

SENTINEL = "synthetic-private-provider-content"
STAMP = "2026-09-22T00:00:00.000Z"


def record():
    return {
        "outcome": "completed", "identityVerified": True,
        "caseId": "perps-hip3-price", "repetition": 2, "overallPass": False,
        "wallDurationMs": 1200,
        "priceGrounding": {"policyId": "perps-price-evidence-v2", "score": 0, "details": [SENTINEL]},
        "score": {
            "overall_pass": True, "latency_ms": 1000, "total_result_bytes": 300,
            **{key: {"score": 1, "details": [SENTINEL]}
               for key in ("routing", "arguments", "completion", "safety")},
        },
        "observation": {
            "version": 1, "run_id": "grok47-high-perps", "case_id": "perps-hip3-price",
            "target": "omp_harness", "model": "xai-oauth/grok-4.7", "repetition": 2,
            "started_at": STAMP, "status": "completed", "duration_ms": 1000,
            "token_usage": {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30,
                            "provider_metadata": SENTINEL},
            "final_answer": SENTINEL, "tool_calls": [{"arguments": SENTINEL}],
            "thinking": SENTINEL,
        },
        "nativeEvidence": [{"content": SENTINEL}], "error": [],
    }


class ProjectionTests(unittest.TestCase):
    def test_allowlist_withholds_prose_and_preserves_effective_price_failure(self):
        result = projector.projected_trial(record(), STAMP)
        self.assertNotIn(SENTINEL, json.dumps(result))
        self.assertFalse(result["score"]["overall_pass"])
        self.assertEqual(result["score"]["routing"]["score"], 1)
        self.assertEqual(result["observation"]["token_usage"]["total_tokens"], 30)

    def test_inconsistent_effective_verdict_is_rejected(self):
        source = record()
        source["overallPass"] = True
        with self.assertRaisesRegex(ValueError, "effective verdict mismatch"):
            projector.projected_trial(source, STAMP)

    def test_unverified_or_different_model_is_rejected(self):
        for field in ("identity", "model"):
            source = record()
            if field == "identity":
                source["identityVerified"] = False
            else:
                source["observation"]["model"] = "xai-oauth/grok-4.6"
            with self.assertRaises(ValueError):
                projector.projected_trial(source, STAMP)

    def test_execution_failures_are_ungraded_and_error_prose_is_withheld(self):
        for tag in ("PluginEvalOmpHarnessTimeoutError", "PluginEvalOmpHarnessProcessError"):
            source = record()
            source.update(outcome="runtime_failure", score=None, priceGrounding=None,
                          error=[{"errorTag": tag, "reason": SENTINEL}])
            result = projector.projected_trial(source, STAMP)
            self.assertIsNone(result["score"])
            self.assertIsNone(result["observation"])
            self.assertEqual(result["error"], {"tag": tag, "reason": None})
            self.assertNotIn(SENTINEL, json.dumps(result))

    def test_execution_failure_cannot_carry_a_grade(self):
        source = record()
        source["outcome"] = "runtime_failure"
        with self.assertRaisesRegex(ValueError, "execution failure carries a grade"):
            projector.projected_trial(source, STAMP)


if __name__ == "__main__":
    unittest.main()
