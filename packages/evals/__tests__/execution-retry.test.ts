import { assert, describe, it } from "@effect/vitest";

import type { ExecutionEvent, ExecutionGrade } from "../src/execution/contracts";
import { isRetryableTrial } from "../src/execution/retry";

const ungraded: ExecutionGrade = { status: "ungraded", reason: "infra_error from model_session" };
const infra: ExecutionEvent = {
  at_ms: 0,
  type: "infra_error",
  source: "model_session",
  message: "PluginEvalOmpHarnessProcessError",
};
const quote: ExecutionEvent = {
  at_ms: 0,
  type: "quote_received",
  leg: "base-swap-eth-usdc",
  quote_id: "q_1",
  amount_in: "200000000000000000",
  amount_out: "599700000",
  cost_usd_micros: 360000,
  expires_at_ms: 60000,
};

describe("isRetryableTrial", () => {
  it("retries a session that never opened", () => {
    assert.isTrue(isRetryableTrial({ grade: ungraded, events: [] }));
  });

  it("retries an infrastructure failure before the model acted", () => {
    assert.isTrue(isRetryableTrial({ grade: ungraded, events: [infra] }));
  });

  it("keeps the slot ungraded once the model has acted", () => {
    assert.isFalse(isRetryableTrial({ grade: ungraded, events: [quote, infra] }));
  });

  it("never retries a graded trial", () => {
    const graded: ExecutionGrade = {
      status: "graded",
      passed: false,
      checks: [],
      total_cost_usd_micros: 0,
      duration_ms: 0,
      submits: 0,
    };
    assert.isFalse(isRetryableTrial({ grade: graded, events: [] }));
  });
});
