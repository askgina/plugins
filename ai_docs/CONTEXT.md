# Spot LP

This glossary distinguishes liquidity-position actions and their financial outcomes from an agent's LP task grade. Definitions describe public contracts and confirmed evaluation terminology, not demonstrated execution or campaign approval.

## Language

**LP position**:
A protocol-specific liquidity holding: concentrated liquidity on Uniswap v3/v4 or Raydium CLMM, or a full-range pool share represented by LP tokens on Raydium CPMM. An inactive or out-of-range position is not necessarily asset-free. [Source](https://github.com/askgina/plugins/blob/486bb0cbfa78200f8689cd7fbd6bf6d8b9d4104b/docs/product-guide/liquidity-positions.mdx#L16-L34)

**LP lifecycle**:
The protocol-specific actions for managing and exiting an LP position: open, increase, decrease, collect, recenter and close for concentrated liquidity; deposit and withdraw for CPMM. Close is not a universal full exit: Raydium CLMM close requires an empty position. [Source](https://github.com/askgina/plugins/blob/486bb0cbfa78200f8689cd7fbd6bf6d8b9d4104b/docs/spot-mcp/liquidity-positions.mdx#L30-L37)
_Avoid_: Universal close sequence

**LP intent**:
The intended LP action identified by `intentId`, which can be retained when refreshing an unexecuted quote. [Source](https://github.com/askgina/plugins/blob/486bb0cbfa78200f8689cd7fbd6bf6d8b9d4104b/docs/spot-mcp/liquidity-positions.mdx#L165-L169)

**LP quote**:
The current proposed LP plan identified by `quoteId` and bound by `planHash`, with material terms and expiry to review; a refreshed quote supersedes its predecessor. Quoting signs and sends nothing and is not execution authorization. [Source](https://github.com/askgina/plugins/blob/486bb0cbfa78200f8689cd7fbd6bf6d8b9d4104b/docs/spot-mcp/liquidity-positions.mdx#L165-L169)
_Avoid_: Execution approval

**LP operation**:
A tracked LP action whose returned `operationId` identifies it for status lookup and reconciliation. An operation handle does not establish settlement. [Source](https://github.com/askgina/plugins/blob/486bb0cbfa78200f8689cd7fbd6bf6d8b9d4104b/docs/spot-mcp/liquidity-positions.mdx#L173-L185)

**Financial outcome**:
The evidenced financial and position-state result of an LP action, including pending, partial or settled facts. It is distinct from an agent's task grade and does not by itself establish profitability. [Sources](https://github.com/askgina/plugins/issues/154#issuecomment-5915159678), [grading policy](https://github.com/askgina/plugins/issues/72#issuecomment-5600247605)
_Avoid_: Blended LP-success score

**LP task grade**:
Assessment of an agent's pursuit of the declared LP user goal through a permitted, valid route, with grounded reporting, safety and required cleanup assessed separately. Honest pending reporting can be grounded while completion remains unproven; task correctness is not trading profitability. [Source](https://github.com/askgina/plugins/issues/72#issuecomment-5600247605)
_Avoid_: Financial outcome, exact-tool-sequence compliance

**Write confirmation**:
The owner's explicit authorization of the exact financial action/quote and its material terms, including preparation and cleanup actions. Viewing or storing a quote and reconciling operation status do not themselves authorize a financial action. [Source](https://github.com/askgina/plugins/issues/154#issuecomment-5915159678)
_Avoid_: Connection approval, implicit consent

**Settlement evidence**:
Action-linked venue or chain state or receipts establishing the financial stage actually attained. Submission, a successful tool return and an agent's narration do not by themselves establish settlement. [Source](https://github.com/askgina/plugins/issues/72#issuecomment-5600247605)
_Avoid_: Success message, transaction submitted

**Composite write confirmation**:
One owner decision covering every financial leg of a complete, exact reviewed quote or plan. It does not cover changed plans, hidden legs or later separately quoted actions. [Source](https://github.com/askgina/plugins/issues/152#issuecomment-5920642654)
_Avoid_: Blanket permission

**Cleanup unit**:
The interval of trial-created exposure covered by one final cleanup obligation. It may span explicitly approved chained lifecycle steps while each step retains its own financial evidence. [Source](https://github.com/askgina/plugins/issues/152#issuecomment-5920642654)
_Avoid_: Tool call

**Wallet withdrawal**:
Position assets actually delivered to the declared receiving wallet, evidenced separately from balances owed inside the position. Reducing liquidity or crediting an owed balance is not itself wallet delivery. [Source](https://github.com/askgina/plugins/issues/152#issuecomment-5920642654)
_Avoid_: Decrease-to-owed credit

**Financial exit**:
An exit with no remaining position liquidity or share, collectible principal/fee/reward balance or unresolved leg, and with attributable proceeds. An empty position NFT may remain under the explicitly chosen exit goal. [Source](https://github.com/askgina/plugins/issues/152#issuecomment-5920642654)
_Avoid_: NFT burn
