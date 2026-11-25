import { Fragment, useId, useState } from "react";
import type { LeaderboardModelRow } from "../canonical/selectors";
import { SCORED_FAMILIES } from "../canonical/selectors";
import { rowLabel, CoverageNote, RecordedResult } from "./leaderboard-results";
import { LeaderboardConversations } from "./leaderboard-conversations";
import { RunDetails } from "./results-ui";
import { TransactionDetails } from "./transaction-results";

export function LeaderboardEvidence({ row }: { row: LeaderboardModelRow }) {
  const [chatOpen, setChatOpen] = useState(false);
  const id = useId();
  return (
    <section className="lb-evidence" aria-label={`Evidence for ${rowLabel(row)}`}>
      <div className="lb-evidence-heading">
        <h3>
          {row.model.name} <span>{row.configurationLabel}</span>
        </h3>
        <p>{row.overallReason}</p>
      </div>
      <div className="lb-evidence-summary">
        <RecordedResult
          runs={Object.values(row.runs)}
          score={row.overall}
          overall
          reason={row.overallReason}
        />
        <div>
          <CoverageNote label="Average time" metric={row.averageTime} />
          <CoverageNote label="Estimated cost" metric={row.estimatedCost} />
        </div>
      </div>
      <LeaderboardConversations
        panelId={`lb-conversations-${id}`}
        row={row}
        open={chatOpen}
        onOpenChange={setChatOpen}
      />
      {SCORED_FAMILIES.map((family) =>
        row.runs[family] ? (
          <Fragment key={family}>
            <RunDetails run={row.runs[family]} />
            <a
              className="results-score-link"
              href={`#/tasks?category=${family}&model=${row.model.id}&run=${encodeURIComponent(row.runs[family]!.runId)}`}
            >
              View {family} tasks and conversations ↗
            </a>
          </Fragment>
        ) : null,
      )}
      <TransactionDetails row={row} />
    </section>
  );
}
