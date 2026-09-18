import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("public_chats", Path(__file__).parents[1] / "export-public-conversations.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PublicConversationsTest(unittest.TestCase):
    def test_decoded_and_nested_credentials_are_removed(self):
        secret = "fixture-private-credential-123456"
        redactor = MODULE.Redactor([secret])
        for text in (secret, json.dumps({"text": secret}), json.dumps(json.dumps({"text": secret})),
                     "prefix " + "".join("\\u%04x" % ord(c) for c in secret)):
            self.assertNotIn(secret, redactor.text(text))
        self.assertIn("redacted", redactor.text("https://example.com/?api_key=" + secret))

    def test_duplicate_keys_fail_even_in_embedded_json(self):
        for text in ('{"password":"first","password":""}', '{"nested":"{\\"a\\":1,\\"a\\":2}"}'):
            with self.assertRaisesRegex(ValueError, "duplicate JSON key"):
                MODULE.Redactor([]).text(text)

    def test_credentials_and_private_values_are_redacted_without_removing_market_arguments(self):
        result = MODULE.Redactor([]).value({"coin": "BTC", "token": "AAVE", "limit": 10,
                                           "accessToken": "private-access-value", "walletAddress": "private-wallet",
                                           "nested": '{"password":"private-password"}'})
        self.assertEqual(result["coin"], "BTC")
        self.assertEqual(result["token"], "AAVE")
        self.assertEqual(result["limit"], 10)
        self.assertNotIn("private-", json.dumps(result))

    def test_private_accounts_keep_message_order_and_gap_flags(self):
        ref = {"rowId": "sample-low", "family": "perps", "caseId": "perps-account", "repetition": 1}
        source = {
            "visibleEvidenceSource": "native",
            "visibleMessages": [
                {"role": "user", "sequence": 1, "content": [{"type": "text", "text": "Show my account."}]},
                {"role": "assistant", "sequence": 2, "content": [{"type": "toolCall", "id": "call-1", "name": "mcp_call_tool",
                                                                  "arguments": {"tool_name": "perps.getHyperliquidAccount"}}]},
                {"role": "tool", "sequence": 3, "content": [{"type": "toolResult", "toolCallId": "call-1", "text": "private financial data"}]},
                {"role": "assistant", "sequence": 4, "content": [{"type": "text", "text": "private financial answer"}]},
            ],
            "frozenUserTurns": [{"role": "user", "content": "Show my account."}],
            "completeness": {"transcriptCaptureComplete": False, "modelObservedTruncation": True,
                             "auxiliarySourceComplete": False, "finalAnswerPresent": True, "nativeVisibleEvidenceAvailable": True},
            "gaps": [{"code": "missing-receipt", "scope": "auxiliary"}],
        }
        result = MODULE.project_chat(source, ref, "a" * 64, [])
        conversation = result["conversation"]
        self.assertEqual([m["sequence"] for m in conversation["visibleMessages"]], [1, 2, 3, 4])
        self.assertEqual(conversation["completeness"], source["completeness"])
        self.assertEqual(conversation["gaps"], source["gaps"])
        self.assertNotIn("private financial", json.dumps(result))
        self.assertIn("mcp_call_tool", json.dumps(result))
        self.assertIn("call-1", json.dumps(result))

    def test_redacted_object_keys_preserve_all_entries(self):
        data = {"0x" + "a" * 40: 1, "0x" + "b" * 40: 2}
        result = MODULE.Redactor([]).value(data)
        self.assertEqual(list(result.values()), [1, 2])
        self.assertTrue(all("redacted" in key for key in result))

    def test_public_market_text_is_not_summarized_or_truncated(self):
        text = "Public market result. " * 10000
        self.assertEqual(MODULE.Redactor([]).text(text), text)


if __name__ == "__main__":
    unittest.main()
