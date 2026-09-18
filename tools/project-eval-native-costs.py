#!/usr/bin/env python3
"""Project numeric native cost estimates; never copy native message content.

The source root is the retained publication's derived/ directory. Costs are
client estimates, not billing receipts. Only observed, graded attempts enter
the completed-attempt population, including graded failures. Incomplete or
inconsistent evidence aborts the projection instead of becoming a zero price.
"""

import argparse
import hashlib
import json
import math
import re
from pathlib import Path


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
    return json.loads(text, object_pairs_hook=unique_object)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def numeric(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


# Meta's first-party standard-tier rate card, checked 2026-09-18.
# https://dev.meta.ai/docs/pricing-rate-limits
MUSE_RATES = {"inputUsdPerMillion": 1.25, "cachedInputUsdPerMillion": .15,
              "outputUsdPerMillion": 4.25}


def token_cost(input_tokens, output_tokens, cached_tokens, rates):
    require(all(type(v) is int and v >= 0 for v in (input_tokens, output_tokens, cached_tokens)),
            "invalid native usage")
    require(cached_tokens <= input_tokens, "cached usage exceeds inclusive input")
    uncached = input_tokens - cached_tokens
    return {
        "usdTotal": (uncached * rates["inputUsdPerMillion"] +
                     cached_tokens * rates["cachedInputUsdPerMillion"] +
                     output_tokens * rates["outputUsdPerMillion"]) / 1_000_000,
        "inputTokens": uncached, "outputTokens": output_tokens,
        "cacheReadTokens": cached_tokens, "cacheWriteTokens": 0,
    }


def devin_rates(catalogue, row):
    variant = catalogue["variant"]
    require(catalogue["selectedModel"] == row["nativeModel"] == variant["model_uid"],
            "catalogue model mismatch")
    if variant.get("cost_tier") == "Free":
        return dict.fromkeys(MUSE_RATES, 0), "catalogue_free_tier"
    match = re.fullmatch(r"\$(\d+(?:\.\d+)?) / 1M Input · \$(\d+(?:\.\d+)?) / 1M Cached input · \$(\d+(?:\.\d+)?) / 1M Output",
                         variant.get("cost_summary", ""))
    require(match is not None, "unsupported catalogue pricing")
    return dict(zip(MUSE_RATES, map(float, match.groups()))), "catalogue_token_rates"


def trace_cost(trace, row, observed_usage, rates, variant=None):
    require(observed_usage is not None, "no observed token usage")
    if row["route"] == "devin":
        native = trace["native"]
        require(trace["requestedModel"] == row["nativeModel"], "trace model mismatch")
        require(native["agent"]["model_name"] == variant["label"], "native model mismatch")
        usage = native["final_metrics"]
        inputs, outputs, cached = (usage["total_prompt_tokens"], usage["total_completion_tokens"],
                                   usage["total_cached_tokens"])
    else:
        require(trace["requestedModel"] == row["nativeModel"] == "muse-spark-1.3",
                "Muse model mismatch")
        inputs, outputs, cached = 0, 0, 0
        seen = set()
        for wrapper in trace["nativeExport"]["events"]:
            envelope = wrapper["envelope"]
            event = envelope.get("payload", {}).get("event", {})
            if event.get("kind") != "model_completed":
                continue
            require(envelope["id"] not in seen, "duplicate model completion")
            seen.add(envelope["id"])
            require(event["model"] == row["nativeModel"], "native model mismatch")
            usage = event["usage"]
            require(usage["cache_write_tokens"] == 0, "unpriced cache write")
            require(usage["cached_tokens"] == usage["cache_read_tokens"], "cache count mismatch")
            token_cost(usage["input_tokens"], usage["output_tokens"], usage["cached_tokens"], rates)
            inputs += usage["input_tokens"]
            outputs += usage["output_tokens"]
            cached += usage["cached_tokens"]
        require(len(seen) > 0, "no model usage")
    require(inputs == observed_usage["input_tokens"] and outputs == observed_usage["output_tokens"],
            "observed usage mismatch")
    return token_cost(inputs, outputs, cached, rates)


def native_cost(records, model, observed_usage):
    """Validate every assistant call and reconcile against the public attempt."""
    totals = dict.fromkeys(("input", "output", "cacheRead", "cacheWrite"), 0)
    usd = 0.0
    seen = set()
    calls = 0
    for record in records:
        if record.get("type") != "message":
            continue
        message = record["message"]
        if message.get("role") != "assistant":
            continue
        identity = record.get("id")
        require(isinstance(identity, str) and identity not in seen, "duplicate/missing message ID")
        seen.add(identity)
        require(f"{message.get('provider')}/{message.get('model')}" == model, "model mismatch")
        usage = message.get("usage", {})
        cost = usage.get("cost", {})
        for key in totals:
            value = usage.get(key)
            require(type(value) is int and value >= 0, "missing/invalid token count")
            require(numeric(cost.get(key)), "missing/invalid cost component")
            require(value == 0 or cost[key] > 0, "zero price for nonzero usage")
            totals[key] += value
        require(numeric(cost.get("total")), "missing/invalid total cost")
        require(math.isclose(sum(cost[k] for k in totals), cost["total"], abs_tol=1e-9),
                "cost components do not reconcile")
        require(usage.get("totalTokens") == sum(usage[k] for k in totals),
                "native token counts do not reconcile")
        usd += cost["total"]
        calls += 1
    require(calls > 0 and usd > 0, "no recorded cost estimate")
    require(observed_usage is not None, "no observed token usage")
    require(totals["input"] == observed_usage["input_tokens"] and
            totals["output"] == observed_usage["output_tokens"], "observed usage mismatch")
    return {"usdTotal": usd, "inputTokens": totals["input"], "outputTokens": totals["output"],
            "cacheReadTokens": totals["cacheRead"], "cacheWriteTokens": totals["cacheWrite"]}


def project(source_root, public_root):
    projected = []
    for name in ("ask-gina-reasoning-sweep.json", "ask-gina-reasoning-sweep-claude.json"):
        report = decode((public_root / name).read_text())
        for row in report["models"]:
            row_root = source_root / row["rowId"]
            require(sha256((row_root / "summary.json").read_bytes()) == row["sourceSummarySha256"],
                    "source summary hash mismatch")
            rates, catalogue = None, None
            method, rate_source, rate_hash = "recorded_client_estimate", "omp_native_usage", None
            price_date = row["startedAt"][:10]
            if row["route"] == "muse":
                rates, method = MUSE_RATES, "published_api_rates"
                rate_source, price_date = "https://dev.meta.ai/docs/pricing-rate-limits", "2026-09-18"
            elif row["route"] == "devin":
                catalogue_bytes = (row_root / "model-catalogue-1.json").read_bytes()
                catalogue = decode(catalogue_bytes)
                rates, method = devin_rates(catalogue, row)
                rate_source, rate_hash = "devin_models_catalogue", sha256(catalogue_bytes)
                price_date = catalogue["fetchedAt"][:10]
            else:
                require(row["route"] == "omp", "unsupported client")
            for run in row["runs"]:
                samples, evidence = [], []
                seen = set()
                for trial in run["trials"]:
                    if trial["outcome"] != "observed" or trial["score"] is None:
                        continue
                    identity = f"{trial['repetition']}-{trial['caseId']}"
                    require(identity not in seen, "duplicate attempt")
                    seen.add(identity)
                    directory = row_root / run["family"] / identity
                    require(directory.resolve().is_relative_to(source_root.resolve()), "invalid path")
                    terminal_bytes = (directory / "terminal.json").read_bytes()
                    terminal = decode(terminal_bytes)
                    for key in ("caseId", "repetition", "outcome"):
                        require(terminal[key] == trial[key], "terminal identity mismatch")
                    observation = trial["observation"]
                    require(observation is not None, "missing observation")
                    for key in ("run_id", "case_id", "repetition", "model", "target", "token_usage"):
                        require(terminal["observation"][key] == observation[key], "terminal observation mismatch")
                    require(terminal["score"]["overall_pass"] == trial["score"]["overall_pass"],
                            "terminal grade mismatch")
                    require(observation["model"] in (row["nativeModel"], row["model"]), "observation model mismatch")
                    if row["route"] == "omp":
                        files = list(directory.glob("native-session-*.jsonl"))
                        require(len(files) == 1, "expected one native session per attempt")
                        raw = files[0].read_bytes()
                        records = [decode(line) for line in raw.splitlines() if line.strip()]
                        samples.append(native_cost(records, row["nativeModel"], observation["token_usage"]))
                    else:
                        raw = (directory / "trace.json").read_bytes()
                        samples.append(trace_cost(decode(raw), row, observation["token_usage"], rates,
                                                  catalogue["variant"] if catalogue else None))
                    evidence.append([identity, sha256(terminal_bytes), sha256(raw)])
                require(len(samples) == run["graded"], "completed population mismatch")
                totals = {key: sum(sample[key] for sample in samples) for key in
                          ("usdTotal", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens")}
                projected.append({
                    "rowId": row["rowId"], "family": run["family"], "model": row["model"],
                    "target": row["target"], "method": method, "rateCard": rates,
                    "rateSource": rate_source, "rateSourceSha256": rate_hash, "priceAsOf": price_date,
                    "sourceSummarySha256": row["sourceSummarySha256"],
                    "sourceEvidenceSha256": sha256(json.dumps(sorted(evidence), separators=(",", ":")).encode()),
                    "sampleCount": len(samples), "population": "completed", "recordedAt": row["startedAt"][:10],
                    **totals,
                })
    return {"schemaVersion": "ask-gina-native-cost-estimates.v1", "source": "native_usage_and_price_sources",
            "billingReceipt": False, "includesCache": True, "runs": projected}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    public_root = Path(__file__).resolve().parents[1] / "apps/evals/src/results/2026-09-16/reasoning-sweep"
    result = project(args.source_root, public_root)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    print(f"Projected {len(result['runs'])} runs / {sum(r['sampleCount'] for r in result['runs'])} attempts")
