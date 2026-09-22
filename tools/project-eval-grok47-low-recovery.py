#!/usr/bin/env python3
"""Publish the completed Low recovery as numeric evidence; run beside private VM data."""
import argparse
from collections import Counter
import importlib.util
import json
import math
from pathlib import Path

spec = importlib.util.spec_from_file_location("fresh_grok", Path(__file__).with_name("project-eval-grok47.py"))
fresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fresh)
require, encode, digest = fresh.require, fresh.encode, fresh.digest
CAMPAIGN = "grok47-low-recovery-20260922"
PROTOCOL = "grok47-failed-step-recovery-120-720-v1"
BASELINE_SHA = "88d508cc4fa4b0a0c74e725bbabed8c50744ccd1ee91465666e845fca9cf91ef"


def select_record(parent, retry):
    if retry is None:
        return parent
    require(parent["outcome"] == "runtime_failure" and parent.get("score") is None,
            "cannot replace an existing grade")
    require(retry["outcome"] in ("completed", "runtime_failure"), "retry not terminal")
    require(retry["timeoutMs"] == 720000 and retry["attempt"] == 1, "recovery budget changed")
    return retry


def project(parent, recovery, baseline_file, output):
    roots = {"parent": parent, "recovery": recovery}
    inventory = {}

    def read(which, relative, expected=None):
        root = roots[which]
        p = root / relative
        require(p.resolve().is_relative_to(root.resolve()) and not p.is_symlink(), "unsafe evidence path")
        raw = p.read_bytes()
        sha = digest(raw)
        require(expected is None or sha == expected, "evidence hash mismatch")
        key = which + "/" + relative
        inventory[key] = {"path": key, "sha256": sha, "bytes": len(raw)}
        return json.loads(raw)

    baseline_raw = baseline_file.read_bytes()
    require(digest(baseline_raw) == BASELINE_SHA, "public baseline changed")
    baseline = json.loads(baseline_raw)
    old = next(row for row in baseline["models"] if row["reasoning"] == "low")
    configs, policies, plans = {}, {}, {}
    for which in roots:
        cfg, policy, plan = (read(which, name) for name in ("config.json", "policy.json", "plan.json"))
        require(cfg["provider"] == "xai-oauth" and cfg["model"] == "grok-4.7", "model mismatch")
        require(inventory[which+"/config.json"]["sha256"] == policy["configSha256"], "config mismatch")
        for name, sha in policy["codeHashes"].items():
            require(digest((roots[which]/name).read_bytes()) == sha, "campaign code changed")
        for name, sha in cfg["hashes"].items():
            require(digest(Path(name).read_bytes()) == sha, "evaluator source changed")
        manifest = read(which, "results/run/manifest.json")
        require(manifest["plan"] == plan and manifest["configSha256"] == policy["configSha256"], "manifest mismatch")
        require(manifest["policySha256"] == inventory[which+"/policy.json"]["sha256"], "policy mismatch")
        configs[which], policies[which], plans[which] = cfg, policy, plan
    require(configs["parent"]["campaign"] == "grok47-20260921", "wrong parent")
    require(configs["recovery"]["campaign"] == "grok47-recovery-20260922", "wrong recovery")
    require(configs["parent"]["sourceCommit"] == configs["recovery"]["sourceCommit"] == baseline["sourceCommit"], "source mismatch")
    require(configs["parent"]["timeoutMs"] == 120000 and configs["recovery"]["timeoutMs"] == 720000, "unexpected budget")
    progress = read("recovery", "results/run/progress.json")
    require(progress["rows"]["low"] == {"planned": 9, "graded": 5, "passed": 2, "failed": 3, "ungraded": 4, "pending": 0}, "Low recovery not complete or changed")
    bindings = read("recovery", "parent-bindings.json")
    parent_hashes = {entry["slot"]: entry["terminalSha256"] for entry in bindings["terminals"]}
    require(len(parent_hashes) == len(plans["parent"]) == 420, "parent coverage mismatch")
    for item in plans["parent"]:
        require(digest((parent/"results/run"/item["slot"]/"terminal.json").read_bytes()) == parent_hashes[item["slot"]], "parent terminal changed")
    for name in ("timeout-change-720s.json", "classification-change-v1.json", "low-first-20260922.json", "supervision-policy-v2.json"):
        read("recovery", name)
    recovery_plan = {item["slot"]: item for item in plans["recovery"] if item["reasoning"] == "low"}
    require(len(recovery_plan) == 9, "unexpected Low recovery selection")
    parent_plan = [item for item in plans["parent"] if item["reasoning"] == "low"]
    require(len(parent_plan) == 105 and len({item["slot"] for item in parent_plan}) == 105, "invalid Low plan")

    def trial_record(which, item):
        prefix = "results/run/" + item["slot"]
        terminal = read(which, prefix+"/terminal.json", parent_hashes[item["slot"]] if which == "parent" else None)
        request, dispatch = (read(which, prefix+"/"+name) for name in ("request.json", "dispatch.json"))
        for value in (terminal, request, dispatch):
            require(all(value.get(key) == item[key] for key in item), "trial identity mismatch")
            require(value["attempt"] == 1 and value["timeoutMs"] == (120000 if which == "parent" else 720000), "trial budget mismatch")
        require(dispatch["catalogSha"] == old["provenance"]["catalogSha"], "catalog changed")
        natives = []
        for ref in terminal["nativeEvidence"]:
            natives.extend(read(which, prefix+"/"+ref["path"], ref["sha256"]))
        if terminal.get("transcript"):
            ref = terminal["transcript"]
            read(which, prefix+"/"+ref["path"], ref["sha256"])
        if terminal["outcome"] == "completed":
            require({r["model"] for r in natives if r.get("type") == "model_change"} == {"xai-oauth/grok-4.7"}, "native model mismatch")
            require({r["thinkingLevel"] for r in natives if r.get("type") == "thinking_level_change"} == {"low"}, "native effort mismatch")
            require(not any(r.get("resolvedModelIsFallback") for r in natives), "fallback model")
            messages = [r["message"] for r in natives if r.get("type") == "message" and r["message"].get("role") == "assistant"]
            require(messages and all(m.get("model") == "grok-4.7" and m.get("provider") == "xai-oauth" for m in messages), "assistant identity mismatch")
            require(not any(m.get("stopReason") == "error" or m.get("errorMessage") for m in messages), "graded native error")
            require(messages[-1].get("stopReason") == "stop", "unfinished graded response")
        return terminal, dispatch["startedAt"], inventory[which+"/"+prefix+"/terminal.json"]["sha256"]

    grouped = {}
    finished = []
    for item in parent_plan:
        previous, old_start, old_sha = trial_record("parent", item)
        retry = None
        history = [{"outcome": previous["outcome"], "timeoutMs": 120000,
                    "completedAt": previous["completedAt"], "terminalSha256": old_sha, "selected": item["slot"] not in recovery_plan}]
        start, terminal_sha = old_start, old_sha
        if item["slot"] in recovery_plan:
            retry_item = recovery_plan[item["slot"]]
            require(retry_item["parentTerminalSha256"] == old_sha, "retry parent mismatch")
            retry, start, terminal_sha = trial_record("recovery", retry_item)
            history.append({"outcome": retry["outcome"], "timeoutMs": 720000,
                            "completedAt": retry["completedAt"], "terminalSha256": terminal_sha, "selected": True})
            finished.append(retry["completedAt"])
        selected = select_record(previous, retry)
        trial = fresh.projected_trial(selected, start)
        prior_public = next(t for run in old["runs"] for t in run["trials"] if t["caseId"] == item["caseId"] and t["repetition"] == item["repetition"])
        require(fresh.projected_trial(previous, old_start) == prior_public, "baseline projection mismatch")
        execution = {"caseId": item["caseId"], "repetition": item["repetition"],
                     "timeoutMs": selected["timeoutMs"], "terminalSha256": terminal_sha,
                     "budgetCohort": "extended-budget-completion" if retry else "retained-baseline", "history": history}
        grouped.setdefault(item["family"], []).append((trial, execution, selected))

    captured_at = max(finished)
    row = {"rowId": "grok47-recovery-low", "model": old["model"], "reasoning": "low", "target": old["target"],
           "timeoutMs": 720000, "sourceCommit": old["sourceCommit"], "provenance": old["provenance"],
           "startedAt": min(t["dispatchedAt"] for pairs in grouped.values() for t, e, r in pairs if e["timeoutMs"] == 720000), "runs": []}
    counts = Counter()
    for family, pairs in grouped.items():
        trials = [t for t, _, _ in pairs]
        executions = [e for _, e, _ in pairs]
        graded = [t for t in trials if t["score"] is not None]
        durations = sorted(t["score"]["latency_ms"] for t in graded)
        usages = [t["observation"]["token_usage"] for t in graded if t["observation"]["token_usage"] is not None]
        price_checks = [{"caseId":r["caseId"], "repetition":r["repetition"], "policyId":r["priceGrounding"]["policyId"],
                         "outcome":"pass" if r["priceGrounding"]["score"] == 1 else "fail",
                         "nativeVerdict":"pass" if r["score"]["overall_pass"] else "fail"} for _, _, r in pairs if r.get("priceGrounding") is not None]
        passed = sum(t["score"]["overall_pass"] for t in graded)
        run = {"family":family, "runId":row["rowId"]+"-"+family, "planned":len(trials), "dispatched":len(trials),
               "graded":len(graded), "passed":passed, "failed":len(graded)-passed, "unscored":len(trials)-len(graded),
               "timeouts":sum(t["error"] is not None and t["error"]["tag"] == "PluginEvalOmpHarnessTimeoutError" for t in trials),
               "latencyMs":{k:durations[max(0,math.ceil(len(durations)*q)-1)] if durations else None for k,q in (("p50",.5),("p95",.95),("max",1))},
               "tokenUsage":{"observations":len(usages), **{k:sum(u[v] for u in usages) if usages else None for k,v in (("input","input_tokens"),("output","output_tokens"),("total","total_tokens"))}},
               "configuration":{"candidate":"grok-4.7", "pinnedSha256":digest(encode({"configSha256":policies["recovery"]["configSha256"],"reasoning":"low","protocol":PROTOCOL}))},
               "timeoutBudgetsMs": sorted({e["timeoutMs"] for e in executions}), "budgetCounts":dict(Counter(e["budgetCohort"] for e in executions)),
               "trials":trials, "executions":executions, "priceChecks":price_checks}
        row["runs"].append(run)
        for key in ("planned", "graded", "passed", "failed", "unscored", "timeouts"):
            counts[key] += run[key]
    require(all(counts[k] == v for k,v in {"planned":105,"graded":92,"passed":70,"failed":22,"unscored":13}.items()), "unexpected aggregate")
    row["sourceSummarySha256"] = digest(encode(row))
    snapshot = {"schemaVersion":"ask-gina-grok47-recovery-snapshot.v1", "campaignId":CAMPAIGN,
                "capturedAt":captured_at, "sourceCommit":baseline["sourceCommit"], "baselineResultsSha256":BASELINE_SHA,
                "selectedLevel":"low", "recoveryCounts":progress["rows"]["low"],
                "files":[inventory[k] for k in sorted(inventory)], "exporterSha256":digest(Path(__file__).read_bytes()),
                "projectionHelperSha256":digest(Path(fresh.__file__).read_bytes())}
    result = {"schemaVersion":"ask-gina-grok47-recovery-results.v1", "campaignId":CAMPAIGN,
              "capturedAt":captured_at, "sourceCommit":baseline["sourceCommit"], "sourceManifestSha256":digest(encode(snapshot)),
              "sourcePlanSha256":inventory["recovery/plan.json"]["sha256"], "sourceStatusSha256":inventory["recovery/results/run/progress.json"]["sha256"],
              "methodology":{"recoveryProtocol":PROTOCOL,"repetitions":3,"timeoutBudgetsMs":[120000,720000],
                             "parentCampaignId":baseline["campaignId"],"baselineResultsSha256":BASELINE_SHA,
                             "retainedBaselineSlots":96,"recoverySlots":9,"newGrades":5,"recoveryExecutionErrors":4,
                             "transcriptAvailability":"withheld","pricingAvailability":"unknown","priceGradingPolicy":"perps-price-evidence-v2"},
              "models":[row], **dict(counts)}
    output.mkdir(parents=True, exist_ok=False)
    (output/"low-recovery.json").write_bytes(encode(result))
    (output/"low-recovery-snapshot.json").write_bytes(encode(snapshot))
    print(json.dumps(dict(counts)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("parent", "recovery", "baseline", "output"):
        parser.add_argument("--"+name, type=Path, required=True)
    args = parser.parse_args()
    project(args.parent, args.recovery, args.baseline, args.output)
