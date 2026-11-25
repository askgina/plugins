import { useId, useState } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { SCORED_FAMILIES, type LeaderboardModelRow } from "../canonical/selectors";
import { useLeaderboard, type LeaderboardController } from "../lib/leaderboard-state";
import {
  columns,
  CompactScore,
  followModelRow,
  rowKey,
  rowLabel,
  rowMetricValue,
  RowIdentity,
} from "./leaderboard-results";
import { InfoPopover } from "./results-ui";
import { LeaderboardEvidence } from "./leaderboard-evidence";
import { TransactionResult } from "./transaction-results";

/** Standalone entry point for previews; the app supplies its shared controller. */
export function LeaderboardMobile({
  rows,
  initialSearch = "",
}: {
  rows: readonly LeaderboardModelRow[];
  initialSearch?: string;
}) {
  const controller = useLeaderboard(rows, initialSearch);
  return <LeaderboardMobileView controller={controller} />;
}

export function LeaderboardMobileView({ controller }: { controller: LeaderboardController }) {
  const { state, shown, clear } = controller;
  const [selected, setSelected] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const id = useId();
  const groups = new Map<string, LeaderboardModelRow[]>();
  shown.forEach((row) => groups.set(row.model.id, [...(groups.get(row.model.id) ?? []), row]));
  const efficiency = state.efficiency;
  function renderRow(row: LeaderboardModelRow, index: number) {
    const key = rowKey(row);
    const open = selected === key;
    return (
      <li key={key} data-mobile-configuration={key}>
        <div
          className="lb-mobile-row"
          data-selected={open}
          onClick={(event) => followModelRow(event, row)}
        >
          <span className="lb-mobile-position" aria-hidden="true">
            {rowMetricValue(row, state.metric) === null ? "·" : index + 1}
          </span>
          <RowIdentity row={row} compact />
          <div className="lb-mobile-value">
            <CompactScore row={row} />
            <small>
              <CompactScore row={row} metric={efficiency} />
            </small>
          </div>
          <button
            type="button"
            className="lb-evidence-trigger"
            aria-label={`Evidence and sources for ${rowLabel(row)}`}
            aria-expanded={open}
            aria-controls={`${id}-evidence-${key}`}
            onClick={() => setSelected(open ? null : key)}
          >
            <MoreHorizontal size={17} />
          </button>
          <div className="lb-mobile-category-strip">
            {SCORED_FAMILIES.map((family) => (
              <span key={family}>
                {family} <CompactScore row={row} metric={family} />
              </span>
            ))}
            <TransactionResult row={row} compact />
          </div>
        </div>
        {open && (
          <div id={`${id}-evidence-${key}`}>
            <LeaderboardEvidence row={row} />
          </div>
        )}
      </li>
    );
  }
  return (
    <section className="leaderboard-mobile" aria-label="Mobile leaderboard results">
      <div className="lb-mobile-list-heading">
        <span>{`${shown.length} ${state.campaign === "all" ? "records" : "settings"}`}</span>
        <span>Overall</span>
        <InfoPopover label="About Overall">
          <p>{columns.find((column) => column.metric === "overall")?.explanation}</p>
        </InfoPopover>
      </div>
      {state.group === "models" ? (
        <div className="lb-mobile-groups">
          <p className="lb-mobile-group-note">No settings are combined into a model score.</p>
          {[...groups].map(([modelId, settings]) => (
            <section key={modelId}>
              <button
                type="button"
                className="lb-mobile-group-trigger"
                aria-expanded={openGroups.has(modelId)}
                aria-controls={`${id}-group-${modelId}`}
                onClick={() =>
                  setOpenGroups((current) => {
                    const next = new Set(current);
                    if (next.has(modelId)) next.delete(modelId);
                    else next.add(modelId);
                    return next;
                  })
                }
              >
                {settings[0]?.model.name}
                <span>{settings.length} settings</span>
                <ChevronDown size={16} />
              </button>
              <ul
                className="lb-mobile-results"
                id={`${id}-group-${modelId}`}
                hidden={!openGroups.has(modelId)}
              >
                {settings.map((row) => renderRow(row, shown.indexOf(row)))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ol className="lb-mobile-results">{shown.map(renderRow)}</ol>
      )}
      {!shown.length && (
        <div className="results-empty" role="status">
          <h2>No matching results</h2>
          <p>Try another model, campaign, or grading filter.</p>
          <button onClick={clear}>Clear filters</button>
        </div>
      )}
    </section>
  );
}
