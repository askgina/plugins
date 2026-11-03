#!/usr/bin/env python3
"""Patch only the pinned recovery worker; never alter the original campaign."""
import argparse
import hashlib
from pathlib import Path

BASELINE_SHA256 = "cdb9d4fa1cd3ea561664ca517b8052787a34c5989ee616218536d5907eb7e984"


def patch_worker(source: bytes) -> str:
    assert hashlib.sha256(source).hexdigest() == BASELINE_SHA256, "unexpected worker baseline"
    code = source.decode()
    replacements = [
        ("import fs from 'node:fs';", "import fs from 'node:fs';\nimport { isCompletedModelArgumentFailure, MODEL_ARGUMENT_FAILURE_POLICY } from './grok47-model-error-classification.ts';"),
        ("for (const [file, digest] of Object.entries(config.hashes)) {", "assert.equal(hash(fs.readFileSync(path.join(base, 'grok47-model-error-classification.ts'))), policy.codeHashes['grok47-model-error-classification.ts'], 'classifier hash mismatch');\nfor (const [file, digest] of Object.entries(config.hashes)) {"),
        ("    const priceGrounding=priceGroundingFor(evalCase,records);", "    if(observation.status!=='completed') assert.ok(checkpoint.failureClassification===MODEL_ARGUMENT_FAILURE_POLICY && isCompletedModelArgumentFailure(observation,records,score), 'checkpoint classification mismatch');\n    const priceGrounding=priceGroundingFor(evalCase,records);"),
        ("    if(observation.status!=='completed'||nativeErrors.length){", "    const candidateScore=observation.status!=='completed'&&!nativeErrors.length ? yield* evals.gradePluginEvalObservation(evalCase,observation) : null;\n    const modelArgumentFailure=candidateScore!==null && isCompletedModelArgumentFailure(observation,allRecords,candidateScore);\n    const classification=modelArgumentFailure?{failureClassification:MODEL_ARGUMENT_FAILURE_POLICY}:{};\n    if((observation.status!=='completed'&&!modelArgumentFailure)||nativeErrors.length){"),
        ("outcome:'grading_pending',observation,identityVerified:true,", "outcome:'grading_pending',observation,identityVerified:true,...classification,"),
        ("    const score=yield* evals.gradePluginEvalObservation(evalCase,observation);\n    const priceGrounding=priceGroundingFor(evalCase,allRecords);", "    const score=candidateScore ?? (yield* evals.gradePluginEvalObservation(evalCase,observation));\n    const priceGrounding=priceGroundingFor(evalCase,allRecords);"),
        ("terminal={outcome:'completed',observation,score,priceGrounding,", "terminal={outcome:'completed',observation,score,...classification,priceGrounding,"),
    ]
    for before, after in replacements:
        assert code.count(before) == 1, f"patch context mismatch: {before[:80]}"
        code = code.replace(before, after)
    return code


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    assert args.source.resolve() != args.output.resolve(), "write a candidate, not the live worker"
    candidate = patch_worker(args.source.read_bytes())
    with args.output.open("x") as target:
        target.write(candidate)
