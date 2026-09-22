"""Selection regressions; private observations are never required by these tests."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("low_projector", Path(__file__).parents[1]/"project-eval-grok47-low-recovery.py")
projector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(projector)


class LowSelectionTests(unittest.TestCase):
    def test_existing_pass_or_failure_cannot_be_replaced(self):
        for verdict in [True, False]:
            parent = {"outcome":"completed", "score":{"overall_pass":verdict}}
            with self.assertRaisesRegex(ValueError,"cannot replace"):
                projector.select_record(parent, {"outcome":"completed", "timeoutMs":720000,"attempt":1})
            self.assertIs(projector.select_record(parent,None),parent)

    def test_failed_retry_is_retained_as_ungraded_not_dropped(self):
        parent = {"outcome":"runtime_failure","score":None}
        retry = {"outcome":"runtime_failure","score":None,"timeoutMs":720000,"attempt":1}
        self.assertIs(projector.select_record(parent,retry),retry)
        self.assertIsNone(retry["score"])

    def test_unfinished_or_unapproved_retry_is_rejected(self):
        parent = {"outcome":"runtime_failure","score":None}
        for retry in [
            {"outcome":"grading_pending","timeoutMs":720000,"attempt":1},
            {"outcome":"completed","timeoutMs":120000,"attempt":1},
            {"outcome":"completed","timeoutMs":720000,"attempt":2},
        ]:
            with self.assertRaises(ValueError):projector.select_record(parent,retry)


if __name__ == "__main__":unittest.main()
