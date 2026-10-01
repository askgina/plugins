#!/usr/bin/env python3
"""Project native OMP sessions of a transaction (execution) eval run into public chats.

Inputs stay outside the repository: the native session files copied from the run host.
Each trial is bound to exactly one native session by the run's native-identity record;
the session must carry the task prompt and one user turn per scripted reply. Only
visible message types are projected (hidden reasoning is never copied) and every
document goes through the same redactor as the other public transcripts.

Transaction trials run against a simulated ledger whose accounts and balances are task
fixtures, not user accounts, so the private-account key rule (which would blank every
`balances` field, the evidence these chats exist to show) is disabled here. Credential,
address, email, local-path and private-host scrubbing still apply.

Writes `<output>/transcripts/<rowId>/spot/<rep>-<task>.json` and a merged
`<output>/transcripts/index.json` (existing public index plus the new files).
"""
import argparse
import importlib.util
import json
import subprocess
from collections import Counter
from pathlib import Path

CAMPAIGN = "transactions-2026-09-25"
FAMILY = "spot"
TARGET = "omp_harness"
SOURCE_LABEL = "OMP native visible messages; hidden reasoning excluded"


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


chat = module("public_chat", "export-public-conversations.py")
recovery = module("recovery_chat", "project-eval-recovery.py")
require, decode, encode, digest = chat.require, chat.decode, chat.encode, chat.digest
# Simulated-ledger fixtures only; see the module docstring.
chat.PRIVATE_KEYS = frozenset()


def git_show(repository, commit, path):
    return subprocess.run(["git", "show", f"{commit}:{path}"], cwd=repository,
                          check=True, capture_output=True).stdout


def project(run_file, identity_file, sessions, repository, row_id, source_commit, output):
    run_bytes = run_file.read_bytes()
    records = [decode(line) for line in run_bytes.decode().splitlines() if line.strip()]
    identity = decode(identity_file.read_text())
    require(identity["all_trials_verified"] is True, "native identity not verified")
    session_of = {(t["task_id"], t["repetition"]): t["session_id"] for t in identity["trials"]}
    require(len(session_of) == len(records), "trial/session count mismatch")

    tasks_dir = "packages/evals/src/execution/tasks"
    listing = subprocess.run(["git", "ls-tree", "--name-only", source_commit, f"{tasks_dir}/"],
                             cwd=repository, check=True, capture_output=True, text=True).stdout.split()
    task_bytes = {Path(p).stem: git_show(repository, source_commit, p) for p in listing}
    catalog_sha = digest(encode({task: digest(raw) for task, raw in sorted(task_bytes.items())}))
    prompts = {}
    for task, raw in task_bytes.items():
        text = raw.decode()
        start = text.index("prompt: >-\n") + len("prompt: >-\n")
        lines = []
        for line in text[start:].splitlines():
            if not line.startswith("  "):
                break
            lines.append(line.strip())
        prompts[task] = " ".join(lines)

    transcripts = output / "transcripts"
    files, redactions = [], Counter()
    for record in records:
        task, repetition = record["task_id"], record["repetition"]
        session_id = session_of[(task, repetition)]
        native_bytes = (sessions / f"{session_id}.jsonl").read_bytes()
        native = [decode(line) for line in native_bytes.decode().splitlines() if line.strip()]
        require(any(r.get("type") == "session" and r.get("id") == session_id for r in native),
                "native session id mismatch")
        messages, omitted = recovery.visible_omp(native)
        user_turns = [{"role": "user", "content": "\n".join(b["text"] for b in m["content"] if b["type"] == "text")}
                      for m in messages if m["role"] == "user"]
        replies = [e for e in record["events"] if e["type"] == "user_reply"]
        require(user_turns and user_turns[0]["content"] == prompts[task], f"prompt mismatch {task}#{repetition}")
        require(len(user_turns) == 1 + len(replies), f"user turn count mismatch {task}#{repetition}")
        require([t["content"] for t in user_turns[1:]] == [e["text"] for e in replies],
                f"scripted reply mismatch {task}#{repetition}")
        final_text = any(b["type"] == "text" and b["text"] for b in messages[-1]["content"]) \
            if messages and messages[-1]["role"] == "assistant" else False
        gaps = [{"code": "content_or_history_gap", "scope": "conversation"}] if omitted else []
        document = {
            "visibleMessages": messages,
            "frozenUserTurns": user_turns,
            "visibleEvidenceSource": SOURCE_LABEL,
            "gaps": gaps,
            "completeness": {"transcriptCaptureComplete": not omitted, "modelObservedTruncation": False,
                             "auxiliarySourceComplete": True, "finalAnswerPresent": bool(final_text),
                             "nativeVisibleEvidenceAvailable": True},
        }
        reference = {"campaignId": CAMPAIGN, "rowId": row_id, "family": FAMILY, "caseId": task,
                     "repetition": repetition, "sourceSummarySha256": digest(run_bytes),
                     "sourceCommit": source_commit, "catalogSha": catalog_sha, "target": TARGET}
        exported = chat.project_chat(document, reference, digest(native_bytes), [])
        payload = encode(exported)
        path = f"{row_id}/{FAMILY}/{repetition}-{task}.json"
        target = transcripts / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        files.append({"path": path, "sha256": digest(payload), "bytes": len(payload)})
        redactions.update(exported["conversation"]["publication"]["redactions"])

    public_index = repository / "apps/evals/public/transcripts/index.json"
    index = decode(public_index.read_text())
    existing = {f["path"] for f in index["files"]}
    require(not existing & {f["path"] for f in files}, "transcript path already published")
    merged_redactions = Counter(index["redactions"])
    merged_redactions.update(redactions)
    index["files"] = index["files"] + files
    index["conversationCount"] = len(index["files"])
    index["redactions"] = dict(sorted(merged_redactions.items()))
    index_bytes = encode(index)
    (transcripts / "index.json").write_bytes(index_bytes)
    print(json.dumps({"campaignId": CAMPAIGN, "rowId": row_id, "catalogSha": catalog_sha,
                      "sourceSummarySha256": digest(run_bytes), "transcripts": len(files),
                      "redactions": dict(redactions), "indexSha256": digest(index_bytes),
                      "conversationCount": index["conversationCount"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True, help="published run JSONL")
    parser.add_argument("--identity", type=Path, required=True, help="published native-identity.json")
    parser.add_argument("--sessions", type=Path, required=True, help="dir of <session_id>.jsonl (private)")
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--row-id", required=True)
    parser.add_argument("--source-commit", required=True, help="full commit the run was executed from")
    parser.add_argument("--output", type=Path, required=True, help="staging dir outside the repository")
    args = parser.parse_args()
    require(not args.output.resolve().is_relative_to(args.repository.resolve()), "output must be outside repository")
    project(args.run, args.identity, args.sessions, args.repository, args.row_id, args.source_commit, args.output)
