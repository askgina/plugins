#!/usr/bin/env python3
"""Project an immutable VM recovery snapshot into numeric results and public chats.

Private inputs never enter the repository. Original sweep files are read-only.
Every selected terminal and native file is bound to the snapshot by SHA-256.
Only visible message types are projected; hidden reasoning is never copied.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime
import hashlib
import importlib.util
import json
from pathlib import Path

CAMPAIGN = "recovery-2026-09-21"
ORIGINAL = "reasoning-sweep-2026-09-16"


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


chat = module("public_chat", "export-public-conversations.py")
cost = module("native_cost", "project-eval-native-costs.py")
require, decode, encode, digest = chat.require, chat.decode, chat.encode, chat.digest


def string(value):
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def visible_omp(records):
    messages, omitted = [], 0
    for record in records:
        if record.get("type") != "message":
            continue
        value = record["message"]
        role = value.get("role")
        if role not in ("user", "assistant", "toolResult"):
            continue
        blocks = []
        content = value.get("content", [])
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        if role == "toolResult":
            texts = []
            for block in content:
                if block.get("type") == "text":
                    texts.append(block["text"])
                else:
                    omitted += 1
            blocks = [{"type": "toolResult", "text": "\n".join(texts),
                       "toolCallId": value.get("toolCallId", ""),
                       "toolName": value.get("toolName", ""),
                       "isError": bool(value.get("isError", False))}]
        else:
            for block in content:
                if block.get("type") == "text":
                    blocks.append({"type": "text", "text": block["text"]})
                elif block.get("type") == "toolCall":
                    blocks.append({"type": "toolCall", "name": block["name"],
                                   "id": block["id"], "arguments": block.get("arguments")})
                elif block.get("type") not in ("thinking", "reasoning", "redacted_thinking"):
                    omitted += 1
        if blocks:
            messages.append({"role": "tool" if role == "toolResult" else role,
                             "sequence": len(messages) + 1, "content": blocks})
    return messages, omitted


def visible_muse(trace):
    messages, seen, omitted = [], set(), 0
    native = trace.get("nativeExport") or {}
    for wrapper in native.get("events", []):
        envelope = wrapper["envelope"]
        event = envelope.get("payload", {}).get("event", {})
        kind = event.get("kind")
        role, blocks = None, []
        if kind == "started" and isinstance(event.get("prompt"), str):
            role, blocks = "user", [{"type": "text", "text": event["prompt"]}]
        elif kind == "assistant_message_committed":
            role, blocks = "assistant", [{"type": "text", "text": event["text"]}]
        elif kind == "assistant_tool_calls_committed":
            role = "assistant"
            for call in event["tool_calls"]:
                args = call.get("args")
                if isinstance(args, str):
                    try:
                        args = decode(args)
                    except json.JSONDecodeError:
                        pass
                blocks.append({"type": "toolCall", "name": call["name"],
                               "id": call["id"], "call_id": call["call_id"], "arguments": args})
        elif kind == "tool_result_batch_committed":
            role = "tool"
            blocks = [{"type": "toolResult", "text": result["text"],
                       "toolCallId": result["tool_call_id"]} for result in event["results"]]
        if blocks:
            identity = envelope["id"]
            require(identity not in seen, "duplicate visible Muse event")
            seen.add(identity)
            messages.append({"role": role, "sequence": len(messages) + 1, "content": blocks})
    omitted += sum(bool(s.get("saw_history_gap")) for s in native.get("sessions", []))
    return messages, omitted


def projected_trial(record, dispatched_at):
    complete = record.get("outcome") == "completed"
    score = record.get("score")
    require(not complete or isinstance(score.get("overall_pass"), bool), "missing grade")
    projected_score = None
    if complete:
        projected_score = {"case_id": record["caseId"], "overall_pass": score["overall_pass"],
                           "latency_ms": score["latency_ms"], "total_result_bytes": score["total_result_bytes"]}
        for name in ("routing", "arguments", "completion", "safety"):
            if name in score:
                projected_score[name] = {"score": score[name]["score"], "details": ["withheld: privacy_review"]}
    errors = record.get("error") or []
    result = {"caseId": record["caseId"], "repetition": record["repetition"], "dispatchedAt": dispatched_at,
            "outcome": "observed" if complete else "runtime_failure",
            "error": {"tag": errors[0]["errorTag"], "reason": None} if errors else None,
            "observation": {k:record["observation"][k] for k in
                ("version","run_id","case_id","target","model","repetition","started_at","status","duration_ms","token_usage")} if complete else None,
            "score": projected_score}
    if record.get("wallDurationMs") is not None:result["wallDurationMs"] = record["wallDurationMs"]
    return result


def percentile(values, quantile):
    if not values:
        return None
    import math
    return sorted(values)[max(0, math.ceil(len(values) * quantile) - 1)]


def project(source, repository, output):
    manifest_bytes = (source / "snapshot-manifest.json").read_bytes()
    manifest = decode(manifest_bytes)
    require(manifest["private"] is True, "expected private snapshot")
    inventory = {entry["path"]: entry for entry in manifest["files"]}
    require(len(inventory) == len(manifest["files"]), "duplicate snapshot path")

    def read(relative):
        entry = inventory[relative]
        raw = chat.safe_read(source, relative)
        require(len(raw) == entry["bytes"] and digest(raw) == entry["sha256"], "snapshot integrity mismatch")
        return decode(raw)

    original_root = repository / "apps/evals/src/results/2026-09-16/reasoning-sweep"
    original = decode((original_root / "ask-gina-reasoning-sweep.json").read_bytes())
    original_rows = {row["rowId"]: row for row in original["models"]}
    original_costs = {(row["rowId"], row["family"]): row for row in
                      decode((original_root / "native-cost-estimates.json").read_bytes())["runs"]}
    output.mkdir(parents=True, exist_ok=True)
    transcripts = output / "transcripts"
    transcripts.mkdir(exist_ok=True)
    files, rows, costs, redactions = [], [], [], Counter()
    totals = Counter()
    cutoff = datetime.fromisoformat(manifest["capturedAt"])

    for provider in ("astra", "muse", "grok"):
        cfg = read(provider + "/config.json")
        progress = read(provider + "/snapshot-progress.json")
        baseline = read(provider + "/baseline.json") if provider != "astra" else None
        selected = {ref["slot"]: ref for ref in progress["selectedEvidence"]}
        histories = defaultdict(list)
        for relative in sorted(inventory):
            if not relative.startswith(provider + "/") or not relative.endswith("/terminal.json"):
                continue
            terminal = read(relative)
            if datetime.fromisoformat(terminal["completedAt"].replace("Z", "+00:00")) > cutoff:
                continue
            slot = f"{terminal['reasoning']}/{terminal['family']}/{terminal['repetition']}-{terminal['caseId']}"
            histories[slot].append((relative, terminal))
        for history in histories.values():
            history.sort(key=lambda pair: pair[1]["completedAt"])

        for level, coverage in progress["rows"].items():
            old = original_rows[f"{provider}-{level}"]
            row_id = f"recovery-{provider}-{level}"
            recovery_starts = []
            row = {"rowId": row_id, "model": old["model"], "reasoning": level,
                   "target": old["target"],
                   "timeoutMs": 600000, "sourceCommit": cfg["sourceCommit"],
                   "provenance": {"catalogSha": old["provenance"]["catalogSha"],
                                  "sourceKind": old["provenance"]["sourceKind"]},
                   "snapshotAt": manifest["capturedAt"], "runs": []}
            for old_run in old["runs"]:
                family = old_run["family"]
                trials, executions, extra_costs, evidence, baseline_count = [], [], [], [], 0
                for prior_trial in old_run["trials"]:
                    case, repetition = prior_trial["caseId"], prior_trial["repetition"]
                    slot = f"{level}/{family}/{repetition}-{case}"
                    reference = selected[slot]
                    old_reference = {"campaignId": ORIGINAL, "rowId": old["rowId"], "family": family,
                                     "caseId": case, "repetition": repetition,
                                     "sourceSummarySha256": old["sourceSummarySha256"],
                                     "sourceCommit": old["sourceCommit"], "catalogSha": old["provenance"]["catalogSha"],
                                     "target": old["target"]}
                    is_baseline = reference["path"] == "baseline.json"
                    record = baseline["records"][slot] if is_baseline else read(provider + "/" + reference["path"])
                    require(reference["sha256"] == inventory[provider + "/" + reference["path"]]["sha256"], "selected terminal changed")
                    require((record["caseId"], record["repetition"], record["reasoning"], record["family"]) ==
                            (case, repetition, level, family), "selected identity mismatch")
                    completed_history = [item for item in histories[slot] if item[1].get("outcome") == "completed"]
                    if not is_baseline and completed_history:
                        require(completed_history[0][0] == provider + "/" + reference["path"], "selection is not first completed grade")
                    if baseline and baseline["records"][slot]["outcome"] == "completed":
                        require(is_baseline, "existing grade replaced")
                    dispatched_at = prior_trial["dispatchedAt"] if is_baseline else read(
                        str(Path(provider + "/" + reference["path"]).parent / "dispatch.json"))["startedAt"]
                    trial = projected_trial(record, dispatched_at)
                    trial.update(timeoutMs=record.get("timeoutMs", 120000),
                                 budgetCohort="retained-baseline" if is_baseline else
                                 "same-budget-completion" if record.get("timeoutMs", 120000) == 120000 else "extended-budget-completion",
                                 terminalSha256=reference["sha256"], conversation=old_reference, history=[])
                    if is_baseline:
                        require(prior_trial["outcome"] == "observed" and record["outcome"] == "completed", "ungraded baseline selected")
                        baseline_count += 1
                    for relative, attempted in histories[slot]:
                        terminal_hash = inventory[relative]["sha256"]
                        attempt_row = f"{row_id}-{terminal_hash[:12]}"
                        ref = {**old_reference, "campaignId": CAMPAIGN, "rowId": attempt_row,
                               "sourceSummarySha256": terminal_hash, "sourceCommit": cfg["sourceCommit"]}
                        parent = str(Path(relative).parent)
                        recovery_starts.append(read(parent + "/dispatch.json")["startedAt"])
                        natives = []
                        for native_ref in attempted.get("nativeEvidence", []):
                            name = parent + "/" + native_ref["path"]
                            require(inventory[name]["sha256"] == native_ref["sha256"], "native identity mismatch")
                            natives.append(read(name))
                        if provider == "muse":
                            native = natives[0] if natives else {}
                            messages, omitted = visible_muse(native)
                            source_label = "Muse native visible events; hidden reasoning and internal prompt context excluded"
                        else:
                            native = [entry for part in natives for entry in part]
                            messages, omitted = visible_omp(native)
                            source_label = "OMP native visible messages; hidden reasoning excluded"
                        user_turns = [{"role": "user", "content": "\n".join(b["text"] for b in m["content"] if b["type"] == "text")}
                                      for m in messages if m["role"] == "user"]
                        gaps = []
                        if not natives: gaps.append({"code": "native_capture_unavailable", "scope": "conversation"})
                        if omitted: gaps.append({"code": "nontext_or_history_gap", "scope": "conversation"})
                        if not user_turns: gaps.append({"code": "user_turn_not_retained", "scope": "conversation"})
                        if attempted["outcome"] != "completed": gaps.append({"code": "execution_incomplete", "scope": "conversation"})
                        if provider == "muse": gaps.append({"code": "hidden_reasoning_and_prompt_context_excluded", "scope": "capture_details"})
                        document = {"visibleMessages": messages, "frozenUserTurns": user_turns,
                                    "visibleEvidenceSource": source_label, "gaps": gaps,
                                    "completeness": {"transcriptCaptureComplete": bool(natives and user_turns and not omitted and attempted["outcome"] == "completed"),
                                                     "modelObservedTruncation": False,
                                                     "auxiliarySourceComplete": bool(natives),
                                                     "finalAnswerPresent": bool((attempted.get("observation") or {}).get("final_answer")),
                                                     "nativeVisibleEvidenceAvailable": bool(natives)}}
                        # Truncation reported by the harness is never hidden.
                        if attempted.get("transcript"):
                            tref = attempted["transcript"]
                            tname = parent + "/" + tref["path"]
                            require(inventory[tname]["sha256"] == tref["sha256"], "transcript identity mismatch")
                            document["completeness"]["modelObservedTruncation"] = bool(read(tname).get("truncated"))
                        exported = chat.project_chat(document, ref, digest(encode(document)), [])
                        payload = encode(exported)
                        path = f"{attempt_row}/{family}/{repetition}-{case}.json"
                        target = transcripts / path; target.parent.mkdir(parents=True, exist_ok=True);target.write_bytes(payload)
                        files.append({"path": path, "sha256": digest(payload), "bytes": len(payload)})
                        redactions.update(exported["conversation"]["publication"]["redactions"])
                        history_entry = {"outcome": attempted["outcome"], "timeoutMs": attempted.get("timeoutMs",120000),
                                         "completedAt": attempted["completedAt"], "terminalSha256": terminal_hash,
                                         "selected": terminal_hash == reference["sha256"], "conversation": ref}
                        trial["history"].append(history_entry)
                        if history_entry["selected"]:
                            trial["conversation"] = ref
                            if attempted["outcome"] == "completed":
                                usage = attempted["observation"]["token_usage"]
                                estimate = cost.trace_cost(native, old, usage, cost.MUSE_RATES) if provider == "muse" else cost.native_cost(native, old["model"], usage)
                                extra_costs.append(estimate); evidence.append(terminal_hash)
                    execution = {"caseId":case,"repetition":repetition,**{k:trial.pop(k) for k in
                        ("timeoutMs","budgetCohort","terminalSha256","conversation","history")}}
                    executions.append(execution)
                    trials.append(trial)
                graded = [t for t in trials if t["outcome"] == "observed"]
                durations = [t["score"]["latency_ms"] for t in graded]
                usages = [t["observation"]["token_usage"] for t in graded]
                require(all(usages), "missing selected usage")
                timeout_count = sum(t["error"] is not None and "Timeout" in t["error"]["tag"] for t in trials)
                run = {"family": family, "runId": row_id + "-" + family, "planned": old_run["planned"],
                       "dispatched": len(trials), "graded": len(graded),
                       "passed": sum(t["score"]["overall_pass"] for t in graded),
                       "failed": sum(not t["score"]["overall_pass"] for t in graded),
                       "unscored": len(trials)-len(graded), "timeouts": timeout_count,
                       "latencyMs": {"p50": percentile(durations,.5), "p95": percentile(durations,.95), "max": max(durations) if durations else None},
                       "tokenUsage": {"observations": len(usages), "input": sum(t["input_tokens"] for t in usages),
                                      "output": sum(t["output_tokens"] for t in usages), "total": sum(t["total_tokens"] for t in usages)},
                       "configuration": {"candidate": old_run["configuration"]["candidate"],
                                         "pinnedSha256": digest(encode({"config": inventory[provider+"/config.json"]["sha256"], "reasoning":level,"protocol":CAMPAIGN}))},
                       "budgetCounts": dict(Counter(t["budgetCohort"] for t in executions)),
                       "timeoutBudgetsMs": sorted(set(t["timeoutMs"] for t in executions)), "trials": trials,
                       "executions": executions}
                row["runs"].append(run)
                previous_cost = original_costs[(old["rowId"], family)]
                require(provider == "astra" or baseline_count == previous_cost["sampleCount"], "baseline cost population changed")
                totals_cost = {k: sum(item[k] for item in extra_costs) + (previous_cost[k] if provider != "astra" else 0)
                               for k in ("usdTotal","inputTokens","outputTokens","cacheReadTokens","cacheWriteTokens")}
                require(len(extra_costs)+baseline_count == len(graded), "cost sample count mismatch")
                costs.append({**previous_cost, **totals_cost, "rowId":row_id, "sampleCount":len(graded),
                              "sourceEvidenceSha256":digest(encode({"baseline":previous_cost["sourceEvidenceSha256"] if provider != "astra" else None,"selected":evidence})),
                              "recordedAt":manifest["capturedAt"], "priceAsOf":"2026-09-21" if provider == "muse" else manifest["capturedAt"][:10]})
            require(sum(r["graded"] for r in row["runs"]) == coverage["graded"], "coverage mismatch")
            row["startedAt"] = min(recovery_starts) if recovery_starts else old["startedAt"]
            row["sourceSummarySha256"] = digest(encode(row))
            for item in costs:
                if item["rowId"] == row_id:item["sourceSummarySha256"] = row["sourceSummarySha256"]
            rows.append(row)
            totals["planned"] += sum(r["planned"] for r in row["runs"])
            totals["graded"] += sum(r["graded"] for r in row["runs"])
    result = {"schemaVersion":"ask-gina-recovery-results.v1", "campaignId":CAMPAIGN,
              "capturedAt":manifest["capturedAt"], "sourceManifestSha256":digest(manifest_bytes),
              "models":rows, "costs":costs, **totals}
    (output/"results.json").write_bytes(encode(result))
    (output/"transcripts-index.json").write_bytes(encode({"files":files,"redactions":dict(redactions),
                                                       "sourceManifestSha256":digest(manifest_bytes),
                                                       "exporterSha256":digest(Path(__file__).read_bytes())}))
    print(json.dumps({"rows":len(rows),**totals,"transcripts":len(files),"redactions":dict(redactions)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    project(args.source, args.repository, args.output)
