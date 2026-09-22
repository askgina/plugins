#!/usr/bin/env python3
"""Project the finished Grok 4.7 VM campaign into public numeric evidence only.

Run on the VM beside the private evidence. No transcript, tool payload, free-form
grader detail, credential, host path, or provider error text leaves the machine.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path

CAMPAIGN = "grok47-20260921"
LEVELS = ("low", "medium", "high", "xhigh")
FAMILIES = {"spot": 4, "perps": 18, "predictions": 13}
PRICE_CASES = {"perps-asset-price", "perps-market-prices", "perps-hip3-price"}
WITHHELD = "withheld: privacy_review"


def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def require(value, reason):
    if not value:
        raise ValueError(reason)


def projected_trial(record, dispatched_at):
    completed = record["outcome"] == "completed"
    score = record.get("score")
    ground = record.get("priceGrounding")
    if completed:
        require(record.get("identityVerified") is True, "completed identity unverified")
        require(isinstance(score["overall_pass"], bool), "missing native verdict")
        expected = score["overall_pass"] and (ground is None or ground["score"] == 1)
        require(record["overallPass"] == expected, "effective verdict mismatch")
        public_score = {"case_id": record["caseId"], "overall_pass": expected,
                        "latency_ms": score["latency_ms"], "total_result_bytes": score["total_result_bytes"]}
        for key in ("routing", "arguments", "completion", "safety"):
            if key in score:
                public_score[key] = {"score": score[key]["score"], "details": [WITHHELD]}
        observation = {key: record["observation"][key] for key in (
            "version", "run_id", "case_id", "target", "model", "repetition", "started_at",
            "status", "duration_ms", "token_usage")}
        require(observation["model"] == "xai-oauth/grok-4.7", "wrong observed model")
        if observation["token_usage"] is not None:
            observation["token_usage"] = {key: observation["token_usage"][key]
                for key in ("input_tokens", "output_tokens", "total_tokens")}
    else:
        require(record["outcome"] == "runtime_failure", "unexpected terminal outcome")
        require(score is None, "execution failure carries a grade")
        observation, public_score = None, None
    errors = record.get("error") or []
    require(completed or len(errors) == 1, "missing or ambiguous execution failure")
    if errors:
        require(errors[0]["errorTag"] in ("PluginEvalOmpHarnessTimeoutError", "PluginEvalOmpHarnessProcessError"), "unexpected execution failure")
    return {"caseId": record["caseId"], "repetition": record["repetition"], "dispatchedAt": dispatched_at,
            "outcome": "observed" if completed else "runtime_failure", "observation": observation,
            "score": public_score, "error": {"tag": errors[0]["errorTag"], "reason": None} if errors else None,
            "wallDurationMs": record["wallDurationMs"]}


def project(source, output):
    inventory = {}

    def read(relative, expected=None):
        p = source / relative
        require(p.resolve().is_relative_to(source.resolve()) and not p.is_symlink(), "unsafe evidence path")
        raw = p.read_bytes()
        sha = digest(raw)
        require(expected is None or sha == expected, "evidence hash mismatch")
        inventory[relative] = {"path": relative, "sha256": sha, "bytes": len(raw)}
        return json.loads(raw)

    cfg, policy, plan = (read(name) for name in ("config.json", "policy.json", "plan.json"))
    progress = read("results/run/progress.json")
    require(cfg["campaign"] == CAMPAIGN and cfg["model"] == "grok-4.7" and cfg["provider"] == "xai-oauth", "wrong campaign")
    require(cfg["reasoning"] == list(LEVELS) and cfg["timeoutMs"] == 120000, "unexpected settings")
    require(progress["state"] == "finished" and progress["pending"] == 0, "campaign not finished")
    require(inventory["config.json"]["sha256"] == policy["configSha256"], "configuration changed")
    for name, sha in policy["codeHashes"].items():
        require(digest((source / name).read_bytes()) == sha, "frozen campaign code changed")
    for path, sha in cfg["hashes"].items():
        require(digest(Path(path).read_bytes()) == sha, "evaluator source changed")
    require(len(plan) == len({item["slot"] for item in plan}) == 420, "invalid plan coverage")
    manifest = read("results/run/manifest.json")
    require(manifest["plan"] == plan and manifest["configSha256"] == policy["configSha256"], "manifest mismatch")
    require(manifest["policySha256"] == inventory["policy.json"]["sha256"], "policy changed")
    for name in ("supervision-policy-v2.json", "resume-review-001.json", "handoff-v2-complete.json"):
        read(name)
    terminal_paths = {str(p.relative_to(source)) for p in (source/"results/run").rglob("terminal.json")}
    require(terminal_paths == {"results/run/"+item["slot"]+"/terminal.json" for item in plan}, "unexpected terminal coverage")
    grouped, catalog_shas = {}, set()
    for item in plan:
        parent = "results/run/"+item["slot"]
        record = read(parent+"/terminal.json")
        request, dispatch = read(parent+"/request.json"), read(parent+"/dispatch.json")
        for value in (record, request, dispatch):
            require(all(value[key] == item[key] for key in item), "trial identity mismatch")
            require(value["attempt"] == 1 and value["timeoutMs"] == 120000, "trial budget changed")
        catalog_shas.add(dispatch["catalogSha"])
        natives = []
        for ref in record["nativeEvidence"]:
            natives.extend(read(parent+"/"+ref["path"], ref["sha256"]))
        if record["outcome"] == "completed":
            require({r["model"] for r in natives if r.get("type") == "model_change"} == {"xai-oauth/grok-4.7"}, "native model mismatch")
            require({r["thinkingLevel"] for r in natives if r.get("type") == "thinking_level_change"} == {item["reasoning"]}, "native effort mismatch")
            require(not any(r.get("resolvedModelIsFallback") for r in natives), "model fallback recorded")
            messages = [r["message"] for r in natives if r.get("type") == "message" and r["message"].get("role") == "assistant"]
            require(messages and all(m.get("model") == "grok-4.7" and m.get("provider") == "xai-oauth" for m in messages), "assistant identity mismatch")
        ref = record.get("transcript")
        if ref:
            read(parent+"/"+ref["path"], ref["sha256"])
        trial = projected_trial(record, dispatch["startedAt"])
        grouped.setdefault((item["reasoning"], item["family"]), []).append((trial, record))
    require(len(catalog_shas) == 1, "mixed tool catalogs")

    rows, all_counts = [], Counter()
    for level in LEVELS:
        row = {"rowId": "grok47-"+level, "model": "xai-oauth/grok-4.7", "reasoning": level,
               "target": "omp_harness", "timeoutMs": 120000, "sourceCommit": cfg["sourceCommit"],
               "provenance": {"catalogSha": next(iter(catalog_shas)), "sourceKind": "git_checkout"}, "runs": []}
        counts = Counter()
        for family, case_count in FAMILIES.items():
            pairs = grouped[(level, family)]
            trials = [t for t, _ in pairs]
            require(len(trials) == case_count*3 and len({t["caseId"] for t in trials}) == case_count, "family plan mismatch")
            graded = [t for t in trials if t["score"] is not None]
            durations = sorted(t["score"]["latency_ms"] for t in graded)
            usages = [t["observation"]["token_usage"] for t in graded if t["observation"]["token_usage"] is not None]
            price_checks = [{"caseId":r["caseId"], "repetition":r["repetition"],
                "policyId":r["priceGrounding"]["policyId"], "outcome":"pass" if r["priceGrounding"]["score"] == 1 else "fail",
                "nativeVerdict":"pass" if r["score"]["overall_pass"] else "fail"} for _,r in pairs if r.get("priceGrounding") is not None]
            passed = sum(t["score"]["overall_pass"] for t in graded)
            run = {"family":family, "runId":row["rowId"]+"-"+family, "planned":len(trials), "dispatched":len(trials),
                "graded":len(graded), "passed":passed, "failed":len(graded)-passed, "unscored":len(trials)-len(graded),
                "timeouts":sum(t["error"] is not None and t["error"]["tag"] == "PluginEvalOmpHarnessTimeoutError" for t in trials),
                "latencyMs":{k:durations[max(0,math.ceil(len(durations)*q)-1)] if durations else None for k,q in (("p50",.5),("p95",.95),("max",1))},
                "tokenUsage":{"observations":len(usages), **{k:sum(u[v] for u in usages) if usages else None for k,v in (("input","input_tokens"),("output","output_tokens"),("total","total_tokens"))}},
                "configuration":{"candidate":"grok-4.7", "pinnedSha256":digest(encode({"configSha256":policy["configSha256"],"reasoning":level}))},
                "trials":trials, "priceChecks":price_checks}
            row["runs"].append(run)
            for key in ("planned","graded","passed","failed","unscored","timeouts"):
                counts[key] += run[key]
        expected = progress["rows"][level]
        require(all(counts[k] == expected[k] for k in ("planned","graded","passed","failed")) and counts["unscored"] == expected["ungraded"], "snapshot counts mismatch")
        row["startedAt"] = min(t["dispatchedAt"] for r in row["runs"] for t in r["trials"])
        row["sourceSummarySha256"] = digest(encode(row))
        rows.append(row);all_counts.update(counts)

    snapshot = {"schemaVersion":"ask-gina-fresh-eval-snapshot.v1", "campaignId":CAMPAIGN,
        "finishedAt":progress["finishedAt"], "sourceCommit":cfg["sourceCommit"], "rows":progress["rows"],
        "files":[inventory[key] for key in sorted(inventory)], "exporterSha256":digest(Path(__file__).read_bytes())}
    result = {"schemaVersion":"ask-gina-fresh-results.v1", "campaignId":CAMPAIGN, "generatedAt":progress["finishedAt"],
        "sourceManifestSha256":digest(encode(snapshot)), "sourcePlanSha256":inventory["plan.json"]["sha256"],
        "sourceStatusSha256":inventory["results/run/progress.json"]["sha256"], "sourceCommit":cfg["sourceCommit"],
        "methodology":{"repetitions":3,"timeoutMs":120000,"ompVersion":cfg["methodology"]["ompVersion"],
            "maxDispatchesPerSlot":1,"pricingAvailability":"unknown","transcriptAvailability":"withheld",
            "priceGradingPolicy":"perps-price-evidence-v2"}, "models":rows, **dict(all_counts)}
    output.mkdir(parents=True, exist_ok=False)
    for name, value in (("results.json", result), ("snapshot.json", snapshot)):
        (output/name).write_bytes(encode(value))
    print(json.dumps(dict(all_counts)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    project(args.source, args.output)
