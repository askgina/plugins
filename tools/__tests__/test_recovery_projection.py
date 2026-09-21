import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("recovery", Path(__file__).parents[1] / "project-eval-recovery.py")
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class RecoveryProjectionTest(unittest.TestCase):
    def test_native_omp_keeps_visible_order_and_excludes_hidden_reasoning(self):
        records = [
            {"type":"message","message":{"role":"user","content":"Get price"}},
            {"type":"message","message":{"role":"assistant","content":[
                {"type":"thinking","thinking":"PRIVATE REASONING"},
                {"type":"text","text":"Checking"},
                {"type":"toolCall","id":"call1","name":"price","arguments":{"coin":"BTC"}}]}},
            {"type":"message","message":{"role":"toolResult","toolCallId":"call1","toolName":"price","content":[{"type":"text","text":"123"}]}},
        ]
        messages, omitted = recovery.visible_omp(records)
        self.assertEqual([m["role"] for m in messages],["user","assistant","tool"])
        self.assertEqual(omitted,0)
        self.assertNotIn("PRIVATE REASONING",str(messages))
        self.assertEqual(messages[1]["content"][1]["arguments"],{"coin":"BTC"})

    def test_muse_committed_events_keep_tools_and_reject_duplicates(self):
        def event(identity, body):
            return {"envelope":{"id":identity,"payload":{"event":body}}}
        events = [event("1",{"kind":"started","prompt":"Read price"}),
                  event("2",{"kind":"assistant_tool_calls_committed","tool_calls":[{"id":"x","call_id":"x","name":"price","args":"{\"coin\":\"BTC\"}"}]}),
                  event("3",{"kind":"tool_result_batch_committed","results":[{"tool_call_id":"x","text":"123"}]}),
                  event("4",{"kind":"assistant_message_committed","text":"Price is 123"})]
        trace={"nativeExport":{"events":events,"sessions":[]}}
        messages, omitted=recovery.visible_muse(trace)
        self.assertEqual([m["role"] for m in messages],["user","assistant","tool","assistant"])
        self.assertEqual(omitted,0)
        events.append(events[0])
        with self.assertRaisesRegex(ValueError,"duplicate"):
            recovery.visible_muse(trace)

    def test_execution_failure_is_ungraded_and_private_error_details_are_not_exported(self):
        trial=recovery.projected_trial({"caseId":"case","repetition":1,"outcome":"runtime_failure",
            "error":[{"errorTag":"PluginEvalOmpHarnessTimeoutError","reason":"PRIVATE"}],"score":None}, "2026-09-20T00:00:00Z")
        self.assertIsNone(trial["score"])
        self.assertIsNone(trial["observation"])
        self.assertNotIn("PRIVATE",str(trial))


if __name__ == "__main__":
    unittest.main()
