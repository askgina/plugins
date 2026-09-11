import { ArrowUpRight } from "lucide-react";
import { Panel } from "../../components/eval-ui";
import type { PublicComparisonCatalog } from "../../lib/public-comparison";
import { ProductionHero, ProductionShell } from "./shared";

export function ProductionMethodologyPage({ catalog }: { catalog?: PublicComparisonCatalog }) {
  return (
    <ProductionShell active="methodology" catalog={catalog}>
      <div className="eval-container eval-methodology">
        <ProductionHero
          eyebrow="The method / Public evaluation results"
          title="Open to inspection"
          description="What a result measures, which comparisons are valid, and what the public record can tell you."
        />
        <div className="eval-method-grid">
          <Panel title="What pass rate means">
            <div className="eval-method-body">
              <p>
                A passed attempt satisfies its declared conformance checks: routing, arguments,
                safety, completion, and skill activation where applicable. Conformance does not
                prove that the final answer is correct or that a financial decision was sound.
              </p>
              <p>
                Pass rate is passed attempts divided by observed attempts. It is published only when
                every planned case and attempt is covered. Incomplete runs still show their observed
                counts, but never an inferred headline score.
              </p>
            </div>
          </Panel>
          <Panel title="Compare like for like">
            <div className="eval-method-body">
              <p>
                Results share a comparison group only when their suite, suite version, fixture
                version, tool catalog, target, account class, clean-chat setting, and repetitions
                match. Switching groups clears the comparison selection.
              </p>
              <p>
                Sorting a table changes display order, not eligibility or rank. Public v1 runs
                remain unranked. A configuration pin identifies declared configuration bytes; labels
                alone do not establish reproducibility.
              </p>
            </div>
          </Panel>
          <Panel title="Latency and token usage">
            <div className="eval-method-body">
              <p>
                Latency shows the published p50, p95, and maximum duration in milliseconds or
                seconds. Percentiles use nearest-rank observations. The interface does not estimate
                missing percentiles from other values.
              </p>
              <p>
                Tokens are totals over attempts whose usage was retained. Sample coverage appears
                beside those totals. Missing token usage is unavailable, not zero, and token counts
                are not a dollar-cost estimate.
              </p>
            </div>
          </Panel>
          <Panel title="Unavailable is a result state">
            <div className="eval-method-body">
              <p>
                Answer accuracy, USD cost, and uncertainty have no numeric values in public v1. They
                require declared grading, pricing, and statistical methods before publication.
              </p>
              <p>
                Not evaluated, not retained, not applicable, and withheld describe different limits.
                Each stays visible with its reason. Synthetic previews demonstrate the interface and
                must not be read as measured model comparisons.
              </p>
            </div>
          </Panel>
          <Panel title="What attempt detail contains">
            <div className="eval-method-body">
              <p>
                Retained summaries identify the run, case, and repetition. They include the verdict,
                five check outcomes, approved failure categories, elapsed duration, and available
                token counts.
              </p>
              <p>
                Public summaries do not contain prompts, final answers, raw tool arguments, tool
                responses, accounts, or transcripts. An aggregate-only result cannot be expanded
                into an invented trace or reconstructed case verdicts.
              </p>
            </div>
          </Panel>
          <Panel title="A current, reviewed publication">
            <div className="eval-method-body">
              <p>
                The public index identifies exact publication bytes and their current revision. The
                loader checks the snapshot against that index before admitting it to the comparison
                view. Measured publications carry a manual review record.
              </p>
              <p>
                A correction creates a linked revision rather than overwriting an old result.
                Withdrawn publications leave no comparable result row. Their safe notice may remain,
                but removed results must not be restored from stale data.
              </p>
              <a
                className="eval-text-link"
                href="https://github.com/askgina/plugins/blob/main/ai_docs/evals-handoff/planning/PUBLIC_CONTRACT.md"
                target="_blank"
                rel="noreferrer"
              >
                Read the public data contract <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </div>
          </Panel>
        </div>
        <p className="eval-method-note">
          This interface reads public evaluation records. It does not execute evaluations, connect
          wallets, or place trades.
        </p>
      </div>
    </ProductionShell>
  );
}
