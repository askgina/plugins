#!/usr/bin/env python3
"""Export identity-bound, redacted visible conversations; never export native files.

The known-literal file is read only in memory and is never inventoried or copied.
All input JSON, including JSON encoded inside strings, rejects duplicate keys.
Private account conversations retain every message/block position, with sensitive
answer/result/argument contents explicitly replaced instead of silently omitted.
"""

import argparse
import base64
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import quote

CAMPAIGN = "reasoning-sweep-2026-09-16"
SCHEMA = "ask-gina-public-conversation.v1"
IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9-]{0,150}$")
PRIVATE_TOOLS = (
    "getaccountaddresses", "getcrosschainportfolio", "listscheduledprompts",
    "fetchswaphistory", "gethyperliquidaccount", "gethyperliquidpositions",
    "gethyperliquidopenorders", "gethyperliquidportfolio",
    "getpolymarketpositions", "getpolymarketorderhistory",
)
SECRET_KEY = re.compile(
    r"(?:apikey|accesskey|authorization|credential|password|privatekey|clientsecret|"
    r"refreshtoken|accesstoken|authtoken|sessiontoken|cookie|secret)", re.I)
PRIVATE_KEYS = {
    "walletaddress", "email", "userid", "accountid", "sessionid", "accountvalue",
    "accountvaluehistory", "spotbalances", "spotcollateralbalances", "positions",
    "openpositions", "closedpositions", "balances", "totalpositions",
}
PATTERNS = [
    ("credential", re.compile(r"-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----|$)")),
    ("credential", re.compile(r"\b(?:sk-(?:(?:proj|ant-api\d+)-)?[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|AIza[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[\w]{20,}|xox[bpars]-[\w-]{16,}|(?:AKIA|ASIA)[A-Z0-9]{16}|glpat-[\w-]{20,}|hf_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,})\b")),
    ("credential", re.compile(r"\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b")),
    ("credential", re.compile(r"\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}", re.I)),
    ("credential", re.compile(r"\b(?:authorization|proxy[-_]authorization|cookie|set[-_]cookie)[\"']?\s*[:=]\s*[\"']?[^\r\n\"']+", re.I)),
    ("credential", re.compile(r"\b(?:[a-z][a-z0-9]*[_-])*(?:api[_-]?key|access[_-]?key|secret|password|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|private[_-]?key)[\"']?\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,}\]]+)", re.I)),
    ("credential", re.compile(r"\b[a-z][a-z0-9+.-]*://[^\s/?#@]+@", re.I)),
    ("address", re.compile(r"\b0x[a-fA-F0-9]{40,64}\b")),
    ("address", re.compile(r"\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}\b")),
    ("address", re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")),
    ("personal_identifier", re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)),
    ("local_path", re.compile(r"(?<![\w/])(?:file://)?/(?:Users|home|root|private|tmp|var|etc|Volumes|workspace|workspaces|app|mnt)(?:/[^\s\"'<>`;,)}\]]*)?")),
    ("local_path", re.compile(r"\b[A-Za-z]:[\\/][^\s\"'<>`]+")),
    ("private_host", re.compile(r"\b(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?\b", re.I)),
]


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON key")
        result[key] = value
    return result


def decode(text):
    return json.loads(text, object_pairs_hook=unique_object,
                      parse_constant=lambda _: require(False, "non-finite JSON number"))


def encode(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_read(root, relative):
    path = root / relative
    require(not path.is_symlink() and path.resolve().is_relative_to(root.resolve()), "unsafe input path")
    return path.read_bytes()


class Redactor:
    def __init__(self, literals):
        require(isinstance(literals, list) and all(isinstance(s, str) and len(s) >= 8 for s in literals),
                "invalid known-literal input")
        variants = set()
        for literal in literals:
            variants.update((literal, quote(literal, safe=""), base64.b64encode(literal.encode()).decode(),
                             json.dumps(literal)[1:-1], literal.replace("/", "\\/")))
        self.literals = sorted(variants, key=len, reverse=True)
        self.counts = Counter()

    def mark(self, category):
        self.counts[category] += 1
        return f"[redacted:{category}]"

    def text(self, value, depth=0):
        require(isinstance(value, str), "invalid transcript text")
        if depth > 64:
            return self.mark("encoded_content")
        # Decode embedded JSON before inspecting it; never last-value-wins.
        stripped = value.strip()
        if stripped.startswith(("{", "[", '"')):
            try:
                parsed = decode(stripped)
            except json.JSONDecodeError:
                pass
            else:
                return json.dumps(self.value(parsed, depth + 1), ensure_ascii=False, separators=(",", ":"))
        # Also expose unicode escapes embedded in prose / nested serialized data.
        restored = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m[1], 16)), value)
        if restored != value:
            return self.text(restored, depth + 1)
        for literal in self.literals:
            if literal in value:
                self.counts["known_credential"] += value.count(literal)
                value = value.replace(literal, "[redacted:known_credential]")
        for category, pattern in PATTERNS:
            value = pattern.sub(lambda _: self.mark(category), value)
        return value

    def value(self, value, depth=0):
        if depth > 64:
            return self.mark("encoded_content")
        if isinstance(value, str):
            return self.text(value, depth)
        if isinstance(value, list):
            return [self.value(v, depth + 1) for v in value]
        if isinstance(value, dict):
            result = {}
            for key, child in value.items():
                clean_key = self.text(key, depth + 1)
                normal = re.sub(r"[^a-z0-9]", "", key.lower())
                if SECRET_KEY.search(normal) or (normal in ("token", "oauthtoken", "auth") and
                                                  not (isinstance(child, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,12}", child))):
                    child = self.mark("credential")
                elif normal in PRIVATE_KEYS:
                    child = self.mark("private_account")
                else:
                    child = self.value(child, depth + 1)
                # Different private keys can redact to the same label. Keep every
                # entry with an ordinal suffix instead of dropping its value.
                base_key = clean_key
                ordinal = 1
                while clean_key in result:
                    ordinal += 1
                    clean_key = f"{base_key} ({ordinal})"
                result[clean_key] = child
            return result
        require(value is None or type(value) in (int, float, bool), "unsupported JSON value")
        return value


def project_chat(document, reference, source_hash, literals):
    redactor = Redactor(literals)
    messages = document["visibleMessages"]
    calls = [b for m in messages for b in m["content"] if b["type"] == "toolCall"]
    def private_call(call):
        name = call.get("name", "")
        args = call.get("arguments")
        if isinstance(args, dict):
            name += " " + str(args.get("tool_name", ""))
        return any(tool in name.lower() for tool in PRIVATE_TOOLS)
    private_account = any(private_call(call) for call in calls)
    projected_messages = []
    for message in messages:
        require(message["role"] in ("user", "assistant", "tool"), "unsupported visible role")
        blocks = []
        for block in message["content"]:
            kind = block["type"]
            require(kind in ("text", "toolCall", "toolResult"), "unsupported content block")
            if kind == "toolCall":
                projected = {"type": kind, "name": redactor.text(block["name"]),
                             "arguments": redactor.mark("private_account") if private_account
                             else redactor.value(block.get("arguments"))}
                for key in ("id", "call_id"):
                    if key in block:
                        projected[key] = redactor.text(block[key])
            else:
                text = block.get("text", "")
                projected = {"type": kind, "text": redactor.mark("private_account")
                             if private_account and message["role"] != "user" and text
                             else redactor.text(text)}
                for key in ("toolCallId", "toolName"):
                    if key in block:
                        projected[key] = redactor.text(block[key])
                if "isError" in block:
                    require(type(block["isError"]) is bool, "invalid error marker")
                    projected["isError"] = block["isError"]
            blocks.append(projected)
        projected_messages.append({"role": message["role"], "sequence": message["sequence"], "content": blocks})
    completeness_keys = ("transcriptCaptureComplete", "modelObservedTruncation", "auxiliarySourceComplete",
                         "finalAnswerPresent", "nativeVisibleEvidenceAvailable")
    completeness = {k: document["completeness"][k] for k in completeness_keys}
    require(all(type(v) is bool for v in completeness.values()), "invalid capture completeness")
    conversation = {
        **{k: reference[k] for k in ("rowId", "family", "caseId", "repetition")},
        "visibleEvidenceSource": redactor.text(document["visibleEvidenceSource"]),
        "frozenUserTurns": [{"role": "user", "content": redactor.text(t["content"])}
                            for t in document["frozenUserTurns"]],
        "visibleMessages": projected_messages,
        "completeness": completeness,
        "gaps": [{"code": redactor.text(g["code"]), "scope": redactor.text(g["scope"])} for g in document["gaps"]],
        "publication": {"kind": "public_redacted", "sourceConversationSha256": source_hash,
                        "redactions": dict(sorted(redactor.counts.items()))},
    }
    return {"schemaVersion": SCHEMA, "reference": reference, "conversation": conversation}


def export(source, public_results, output, literal_file):
    literals = decode(literal_file.read_text())
    manifest_bytes = safe_read(source, "manifest.json")
    manifest = decode(manifest_bytes)
    require(manifest["private"] is True, "expected retained private bundle")
    entries = {e["path"]: e for e in manifest["outputs"] if e["path"].startswith("chats/")}
    require(len(entries) == sum(e["path"].startswith("chats/") for e in manifest["outputs"]), "duplicate chat entry")
    source_rows = {r["rowId"]: r for r in manifest["rows"]}
    expected = []
    for name in ("ask-gina-reasoning-sweep.json", "ask-gina-reasoning-sweep-claude.json"):
        for row in decode((public_results / name).read_bytes())["models"]:
            retained = source_rows[row["rowId"]]
            require(any(f["path"] == f"results/{row['rowId']}/summary.json" and f["sha256"] == row["sourceSummarySha256"]
                        for f in retained["sourceFiles"]), "public summary does not match private evidence")
            for run in row["runs"]:
                for trial in run["trials"]:
                    expected.append({"campaignId": CAMPAIGN, "rowId": row["rowId"], "family": run["family"],
                                     "caseId": trial["caseId"], "repetition": trial["repetition"],
                                     "sourceSummarySha256": row["sourceSummarySha256"], "sourceCommit": row["sourceCommit"],
                                     "catalogSha": row["provenance"]["catalogSha"], "target": row["target"]})
    output.mkdir(parents=True, exist_ok=True)
    files, totals = [], Counter()
    for ref in expected:
        require(all(IDENTIFIER.fullmatch(ref[k]) for k in ("rowId", "family", "caseId")), "invalid identity")
        rel = f"{ref['rowId']}/{ref['family']}/{ref['repetition']}-{ref['caseId']}.json"
        entry = entries[f"chats/{rel}"]
        raw = safe_read(source, entry["path"])
        require(digest(raw) == entry["sha256"] and len(raw) == entry["bytes"], "source chat integrity mismatch")
        doc = decode(raw)
        require(all(doc[k] == ref[k] for k in ("rowId", "family", "caseId", "repetition")), "source chat identity mismatch")
        rp = doc["rowProvenance"]
        require(rp["sourceCommit"] == ref["sourceCommit"] and rp["target"] == ref["target"] and
                rp["provenance"]["catalogSha"] == ref["catalogSha"], "source chat provenance mismatch")
        exported = project_chat(doc, ref, entry["sha256"], literals)
        payload = encode(exported)
        # Re-inspect the serialized and decoded projected values for every known literal.
        scanner = Redactor(literals)
        for literal in scanner.literals:
            require(literal.encode() not in payload, "known credential survived public projection")
        target = output / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        files.append({"path": rel, "sha256": digest(payload), "bytes": len(payload)})
        totals.update(exported["conversation"]["publication"]["redactions"])
    require(len(files) == len(entries) == len({f["path"] for f in files}), "public attempt coverage mismatch")
    index = {"schemaVersion": "ask-gina-public-conversations.v1", "campaignId": CAMPAIGN,
             "sourceManifestSha256": digest(manifest_bytes), "exporterSha256": digest(Path(__file__).read_bytes()),
             "conversationCount": len(files), "redactions": dict(sorted(totals.items())), "files": sorted(files, key=lambda f: f["path"])}
    index_bytes = encode(index)
    (output / "index.json").write_bytes(index_bytes)
    print(json.dumps({"conversations": len(files), "bytes": sum(f["bytes"] for f in files),
                      "indexSha256": digest(index_bytes), "redactions": index["redactions"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--public-results", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--secret-file", type=Path, required=True)
    args = parser.parse_args()
    export(args.source, args.public_results, args.output, args.secret_file)
