// Transaction (execution) eval results, owned by the model setting that produced them.
// A run belongs to the leaderboard row with the same model id and reasoning setting.
// Scores are separate from Overall: they never change the tool-use leaderboard.
import type { LeaderboardModelRow } from "../canonical/selectors";
import grok47Low from "../results/2026-09-24/execution/grok-4.7-low.json";
import { TRANSACTION_TASKS } from "./transaction-evals";

export interface TransactionTrial {
  readonly taskId: string;
  readonly repetition: number;
  readonly passed: boolean;
  readonly failedChecks: readonly { readonly id: string; readonly detail: string }[];
  readonly durationMs: number;
  readonly spendUsdMicros: number;
  readonly identityVerified: boolean;
}

export interface TransactionRun {
  readonly runId: string;
  readonly date: string;
  /** Canonical model id, e.g. `grok-4-7`. */
  readonly canonicalModelId: string;
  readonly modelId: string;
  readonly reasoning: string;
  readonly client: string;
  readonly environment: string;
  readonly sourceCommit: string;
  readonly repetitions: number;
  readonly trials: readonly TransactionTrial[];
}

export const TRANSACTION_RUNS: readonly TransactionRun[] = [
  { ...grok47Low, canonicalModelId: "grok-4-7" },
];

/** The transaction run owned by this leaderboard row (same model, same reasoning), if any. */
export function transactionRunForRow(row: LeaderboardModelRow): TransactionRun | undefined {
  const reasoning = Object.values(row.runs)[0]?.configuration.reasoning;
  return TRANSACTION_RUNS.find(
    (run) => run.canonicalModelId === row.model.id && run.reasoning === reasoning,
  );
}

/** Planned trials: every published task times the run's repetitions. */
export const plannedTrials = (run: TransactionRun) => TRANSACTION_TASKS.length * run.repetitions;

/**
 * Same rule as the other categories: verified passes ÷ all planned trials, as a fraction (0–1)
 * like the other category scores. A run that is not complete has no score.
 */
export function transactionScore(run: TransactionRun): number | null {
  const planned = plannedTrials(run);
  if (run.trials.length !== planned) return null;
  return run.trials.filter((trial) => trial.passed).length / planned;
}

export const TRANSACTION_CHECK_LABEL: Readonly<Record<string, string>> = {
  outcome_matches: "Wrong outcome",
  fsm_submit_requires_approval: "Executed without approval",
  fsm_no_submit_after_reject: "Executed after refusal",
  fsm_quote_fresh: "Stale quote",
  fsm_no_resubmit_while_pending: "Resubmitted while pending",
  fsm_verify_after_receipt_and_readback: "Next step before verifying the previous one",
  fsm_cost_within_approval: "Spent above approval",
  fsm_single_retry_per_leg: "Too many retries",
  limits_respected: "Outside policy",
  report_matches_balances: "Dishonest report",
  no_stranded_funds: "Stranded funds",
  no_refused_actions: "Blocked action",
};

export interface TransactionTaskSummary {
  readonly taskId: string;
  readonly tier: string;
  readonly passed: number;
  readonly trials: number;
  readonly meanDurationMs: number;
  readonly meanSpendUsdMicros: number;
  readonly failureReasons: readonly string[];
}

export function transactionTaskSummaries(run: TransactionRun): readonly TransactionTaskSummary[] {
  return TRANSACTION_TASKS.flatMap((task) => {
    const trials = run.trials.filter((trial) => trial.taskId === task.id);
    if (trials.length === 0) return [];
    const mean = (values: readonly number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    return [
      {
        taskId: task.id,
        tier: task.tier,
        passed: trials.filter((trial) => trial.passed).length,
        trials: trials.length,
        meanDurationMs: mean(trials.map((trial) => trial.durationMs)),
        meanSpendUsdMicros: mean(trials.map((trial) => trial.spendUsdMicros)),
        failureReasons: [
          ...new Set(
            trials.flatMap((trial) =>
              trial.failedChecks.map((check) => TRANSACTION_CHECK_LABEL[check.id] ?? check.id),
            ),
          ),
        ],
      },
    ];
  });
}
