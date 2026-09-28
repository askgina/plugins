#!/usr/bin/env python3
"""Project the finished Claude Opus 5.5 VM campaign into public numeric evidence only.

Run on the VM beside the private evidence. No transcript, tool payload, free-form
grader detail, credential, host path, or provider error text leaves the machine.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path

CAMPAIGN = "opus55-20260922"
LEVELS = ("low", "medium", "high", "xhigh", "max")
FAMILIES = {"spot": 4, "perps": 18, "predictions": 13}
PRICE_CASES = {"perps-single-price", "perps-multiple-prices", "perps-hip3-price"}
WITHHELD = "withheld: privacy_review"


def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def require(value, reason):
    if not value:
        raise ValueError(reason)


def quota_rejected(events):
    return any((e.get("type") == "assistant" and e.get("error") == "rate_limit") or
               (e.get("type") == "rate_limit_event" and e.get("rate_limit_info", {}).get("status") == "rejected")
               for e in events)


def verify_native(events):
    require(not quota_rejected(events), "selected quota rejection")
    require({e.get("model") for e in events if e.get("type") == "system" and e.get("subtype") == "init"} == {"claude-opus-5-5"}, "native model mismatch")
    models = [e.get("message", {}).get("model") for e in events if e.get("type") == "assistant"]
    require(models and all(m == "claude-opus-5-5" for m in models), "assistant identity mismatch")
    require(all(m == "claude-opus-5-5" for e in events if e.get("type") == "result" for m in e.get("modelUsage", {})), "model fallback recorded")


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
            "status", "duration_ms")}
        observation["token_usage"] = record["observation"].get("token_usage")
        require(observation["target"] == "claude_cli", "wrong observed client")
        require(observation["case_id"] == record["caseId"] and observation["repetition"] == record["repetition"], "observation identity mismatch")
        require(observation["model"] == "claude-opus-5-5", "wrong observed model")
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
        require(errors[0]["errorTag"] in ("PluginEvalClaudeCliTimeoutError", "PluginEvalClaudeCliProcessError"), "unexpected execution failure")
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
    require(cfg["campaign"] == CAMPAIGN and cfg["model"] == "claude-opus-5-5" and cfg["provider"] == "claude-oauth", "wrong campaign")
    require(cfg["reasoning"] == list(LEVELS) and cfg["timeoutMs"] == 720000, "unexpected settings")
    require(cfg["clientVersion"] == "2.1.280 (Claude Code)" and cfg["maxTurns"] == 32 and cfg["repetitions"] == 3, "unexpected client settings")
    require(progress["state"] == "finished" and progress["pending"] == 0, "campaign not finished")
    require(inventory["config.json"]["sha256"] == policy["configSha256"], "configuration changed")
    for name, sha in policy["codeHashes"].items():
        require(digest((source / name).read_bytes()) == sha, "frozen campaign code changed")
    for path, sha in cfg["hashes"].items():
        require(digest(Path(path).read_bytes()) == sha, "evaluator source changed")
    require(len(plan) == len({item["slot"] for item in plan}) == 525, "invalid plan coverage")
    manifest = read("results/run/manifest.json")
    require(manifest["plan"] == plan and manifest["configSha256"] == policy["configSha256"], "manifest mismatch")
    require(manifest["policySha256"] == inventory["policy.json"]["sha256"], "policy changed")
    provenance = read("source-provenance.json")
    require(provenance == cfg["provenance"], "source provenance mismatch")
    quota_policy, quota_state = read("quota-recovery-policy.json"), read("quota-recovery-state.json")
    for name, sha in quota_policy["codeHashes"].items():
        require(digest((source / name).read_bytes()) == sha, "quota control code changed")
    quota_receipts = sorted((source / "quota-rejections").rglob("quota-recovery-receipt.json"))
    require(len(quota_receipts) == quota_state["retainedRejections"], "quota retention mismatch")
    planned_slots = {item["slot"] for item in plan}
    for receipt_path in quota_receipts:
        receipt = read(str(receipt_path.relative_to(source)))
        require(receipt["slot"] in planned_slots and receipt["reason"] == "native-Claude-quota-rejection", "invalid quota receipt")
        original = read(str((receipt_path.parent / "terminal.json").relative_to(source)))
        require(original["outcome"] == "runtime_failure" and original.get("score") is None, "graded trial was retried")
        rejected = read(str((receipt_path.parent / original["attemptEvidence"] / "native.json").relative_to(source)))
        events = [json.loads(line) for line in rejected["stdout"].splitlines() if line.strip()]
        require(quota_rejected(events), "retained attempt was not quota rejected")
    terminal_paths = {str(p.relative_to(source)) for p in (source/"results/run").glob("*/*/*/terminal.json")}
    require(terminal_paths == {"results/run/"+item["slot"]+"/terminal.json" for item in plan}, "unexpected terminal coverage")
    grouped, catalog_shas = {}, set()
    for item in plan:
        parent = "results/run/"+item["slot"]
        record = read(parent+"/terminal.json")
        require(record["selectedAttempt"] == 1 and record["attemptEvidence"] == "attempt-1", "unexpected selected attempt")
        evidence = parent + "/" + record["attemptEvidence"]
        request, dispatch = read(evidence+"/request.json"), read(evidence+"/dispatch.json")
        original = read(evidence+"/terminal.json")
        require(all(record.get(k) == v for k, v in original.items()), "selected terminal differs from original")
        for value in (record, request, dispatch):
            require(all(value[key] == item[key] for key in item), "trial identity mismatch")
            require(value["attempt"] == 1 and value["timeoutMs"] == 720000, "trial budget changed")
        require(dispatch["requestedModel"] == cfg["model"] and dispatch["requestedEffort"] == item["reasoning"], "requested identity mismatch")
        require(not record.get("providerGate"), "selected provider rejection")
        catalog_shas.add(dispatch["catalogSha"])
        if record["outcome"] == "completed":
            native = read(evidence+"/native.json", record["nativeSha256"])
            execution = read(evidence+"/execution.json")
            require(execution["nativeSha256"] == record["nativeSha256"] and execution["observation"] == record["observation"], "grading checkpoint mismatch")
            require(native["exitCode"] == 0 and not native["stdoutTruncated"] and not native["stderrTruncated"], "incomplete native evidence")
            events = [json.loads(line) for line in native["stdout"].splitlines() if line.strip()]
            verify_native(events)
        trial = projected_trial(record, dispatch["startedAt"])
        grouped.setdefault((item["reasoning"], item["family"]), []).append((trial, record))
    require(len(catalog_shas) == 1, "mixed tool catalogs")

    rows, all_counts = [], Counter()
    for level in LEVELS:
        row = {"rowId": "opus55-"+level, "model": "claude-opus-5-5", "reasoning": level,
               "target": "claude_cli", "timeoutMs": 720000, "sourceCommit": cfg["provenance"]["baseCommit"],
               "provenance": {"catalogSha": next(iter(catalog_shas)), "sourceKind": "extracted_snapshot"}, "runs": []}
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
                "timeouts":sum(t["error"] is not None and t["error"]["tag"] == "PluginEvalClaudeCliTimeoutError" for t in trials),
                "latencyMs":{k:durations[max(0,math.ceil(len(durations)*q)-1)] if durations else None for k,q in (("p50",.5),("p95",.95),("max",1))},
                "tokenUsage":{"observations":len(usages), **{k:sum(u[v] for u in usages) if usages else None for k,v in (("input","input_tokens"),("output","output_tokens"),("total","total_tokens"))}},
                "configuration":{"candidate":"claude-opus-5-5", "pinnedSha256":digest(encode({"configSha256":policy["configSha256"],"reasoning":level}))},
                "trials":trials, "priceChecks":price_checks}
            row["runs"].append(run)
            for key in ("planned","graded","passed","failed","unscored","timeouts"):
                counts[key] += run[key]
        expected = progress["rows"][level]
        require(all(counts[k] == expected[k] for k in ("planned","graded","passed","failed")) and counts["unscored"] == expected["ungraded"], "snapshot counts mismatch")
        row["startedAt"] = min(t["dispatchedAt"] for r in row["runs"] for t in r["trials"])
        row["sourceSummarySha256"] = digest(encode(row))
        rows.append(row);all_counts.update(counts)

    original_counts = dict(all_counts)
    revision_path = "price-envelope-revision-r5/price-envelope-revision.json"
    revision = read(revision_path)
    require(revision["campaignId"] == CAMPAIGN and revision["policyId"] == "perps-price-evidence-v2-claude-envelope-v1", "unexpected grading revision")
    require(revision["modelReruns"] == 0 and revision["rawEvidenceUnchanged"] is True, "invalid revision scope")
    for name, key in (("perps-price.ts", "correctedGraderSha256"), ("price-claims.ts", "priceClaimsSha256"), ("regrade-opus55-price-envelopes.mjs", "exporterSha256")):
        require(digest((source / "price-envelope-revision-code" / name).read_bytes()) == revision[key], "revision code changed")
    require(digest((source / "source/packages/evals/src/perps-price.ts").read_bytes()) == revision["originalGraderSha256"], "original grader changed")
    require(digest((source / "source/packages/evals/src/price-claims.ts").read_bytes()) == revision["priceClaimsSha256"], "price assertion rules changed")
    entries = revision["entries"]
    require(len(entries) == 45 and len({(e["reasoning"], e["caseId"], e["repetition"]) for e in entries}) == 45, "revision coverage mismatch")
    public_entries = []
    for e in entries:
        require(e["reasoning"] in LEVELS and e["caseId"] in PRICE_CASES and e["repetition"] in (1,2,3), "revision identity mismatch")
        row = next(r for r in rows if r["reasoning"] == e["reasoning"])
        run = next(r for r in row["runs"] if r["family"] == "perps")
        trial = next(t for t in run["trials"] if t["caseId"] == e["caseId"] and t["repetition"] == e["repetition"])
        check = next(c for c in run["priceChecks"] if c["caseId"] == e["caseId"] and c["repetition"] == e["repetition"])
        terminal_path = "results/run/" + e["reasoning"] + "/perps/" + str(e["repetition"]) + "-" + e["caseId"] + "/terminal.json"
        require(inventory[terminal_path]["sha256"] == e["terminalSha256"], "revision terminal changed")
        require(inventory[terminal_path.removesuffix("terminal.json") + "attempt-1/native.json"]["sha256"] == e["nativeSha256"], "revision native evidence changed")
        require(e["originalPriceScore"] in (0,1) and e["correctedPriceScore"] in (0,1), "invalid revised score")
        require(check["outcome"] == ("pass" if e["originalPriceScore"] else "fail") and (check["nativeVerdict"] == "pass") == e["nativePass"], "original grade mismatch")
        require(trial["score"]["overall_pass"] == e["originalPass"] and e["correctedPass"] == (e["nativePass"] and e["correctedPriceScore"] == 1), "revision verdict mismatch")
        delta = int(e["correctedPass"]) - int(e["originalPass"])
        run["passed"] += delta; run["failed"] -= delta
        all_counts["passed"] += delta; all_counts["failed"] -= delta
        trial["score"]["overall_pass"] = e["correctedPass"]
        check.update(originalOutcome=check["outcome"], outcome="pass" if e["correctedPriceScore"] else "fail", policyId=revision["policyId"], revisionId=revision["policyId"])
        public_entries.append({key:e[key] for key in ("caseId","reasoning","repetition","terminalSha256","nativeSha256","originalPriceScore","correctedPriceScore","nativePass","originalPass","correctedPass")})
    for row in rows:
        del row["sourceSummarySha256"]
        row["sourceSummarySha256"] = digest(encode(row))
    public_revision = {key:revision[key] for key in ("schemaVersion","policyId","campaignId","scope","modelReruns","rawEvidenceUnchanged","originalGraderSha256","correctedGraderSha256","priceClaimsSha256","exporterSha256")}
    public_revision["entries"] = public_entries

    snapshot = {"schemaVersion":"ask-gina-fresh-eval-snapshot.v1", "campaignId":CAMPAIGN,
        "finishedAt":progress["finishedAt"], "sourceCommit":cfg["provenance"]["baseCommit"], "rows":{level:{key:progress["rows"][level][key] for key in ("planned","graded","passed","failed","ungraded","pending")} for level in LEVELS},
        "files":[inventory[key] for key in sorted(inventory)], "exporterSha256":digest(Path(__file__).read_bytes())}
    result = {"schemaVersion":"ask-gina-fresh-results.v1", "campaignId":CAMPAIGN, "generatedAt":progress["finishedAt"],
        "sourceManifestSha256":digest(encode(snapshot)), "sourcePlanSha256":inventory["plan.json"]["sha256"],
        "sourceStatusSha256":inventory["results/run/progress.json"]["sha256"], "sourceCommit":cfg["provenance"]["baseCommit"],
        "methodology":{"repetitions":3,"timeoutMs":720000,"clientVersion": "2.1.280", "maxTurns":32,
            "quotaRejectionsRetained":len(quota_receipts), "completedGradesRetried":0,
            "subscriptionAccountChanges":1, "trialsBeforeAccountChange":71,
            "sourcePatchSha256":provenance["patchSha256"],
            "sourceArchiveSha256":provenance["sourceArchiveSha256"],"pricingAvailability":"unknown","transcriptAvailability":"withheld",
            "priceGradingPolicy":revision["policyId"]}, "gradingRevision":public_revision, "originalCounts":original_counts, "models":rows, **dict(all_counts)}
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
