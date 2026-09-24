export type TransactionTier = "T1" | "T2" | "T3" | "T4" | "T5";
export interface TransactionTask {
    readonly id: string;
    readonly tier: TransactionTier;
    readonly prompt: string;
    /** Correct end state, as the grader requires it. */
    readonly expectedOutcome: string;
    /** What the scripted user answers when the model asks for approval. */
    readonly userReply: "approve" | "reject";
    readonly tests: string;
}
export declare const TRANSACTION_TASKS: readonly TransactionTask[];
export declare const TRANSACTION_TIERS: readonly {
    tier: TransactionTier;
    label: string;
    status: string;
}[];
/** Hard checks: a trial passes only if every one passes. */
export declare const TRANSACTION_CHECKS: readonly {
    name: string;
    fails: string;
}[];
