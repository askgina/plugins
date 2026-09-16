import perpsPredictionsReport from "./2026-09-11/perps-predictions/report/ask-gina-perps-predictions-evals-2026-09-11.json";
import spotComparison from "./2026-09-11/spot-comparison/comparison.json";
import spotBundleManifest from "./2026-09-11/spot-comparison/bundle-manifest.json";
import museReport from "./2026-09-14/muse-spark-1.3/report/ask-gina-muse-spark-1.3-evals-2026-09-14.json";
import claudeComparison from "./2026-09-14/claude-comparison/ask-gina-claude-comparison.json";
import reasoningSweep from "./2026-09-16/reasoning-sweep/ask-gina-reasoning-sweep.json";
import reasoningSweepClaude from "./2026-09-16/reasoning-sweep/ask-gina-reasoning-sweep-claude.json";

export {
  claudeComparison,
  museReport,
  perpsPredictionsReport,
  reasoningSweep,
  reasoningSweepClaude,
  spotBundleManifest,
  spotComparison,
};
export const measuredResultsDate = "2026-09-16";

export const reasoningSweepPublication = {
  publishedRows: reasoningSweep.models.length + reasoningSweepClaude.models.length,
  publishedSlots: reasoningSweep.planned + reasoningSweepClaude.planned,
  plannedRows: reasoningSweep.methodology.plannedRows,
  plannedSlots: reasoningSweep.methodology.plannedSlots,
};
