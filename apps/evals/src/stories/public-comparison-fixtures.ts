import publicationRaw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-publication-correction-rev2.json?raw";
import indexRaw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-index.json?raw";
import {
  buildPublicComparisonCatalog,
  type PublicComparisonCatalog,
  type PublicComparisonRow,
} from "../lib/public-comparison";
import { parsePublicArtifact } from "../lib/public-results";

const encoded = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer;
const publicationArtifact = parsePublicArtifact(encoded(publicationRaw));
const indexArtifact = parsePublicArtifact(encoded(indexRaw));

if (publicationArtifact.kind !== "publication" || indexArtifact.kind !== "index") {
  throw new Error("Canonical public comparison fixtures are invalid");
}

export const verifiedSyntheticCatalog = buildPublicComparisonCatalog(
  [publicationArtifact.publication],
  indexArtifact.index,
);

const replaceOnlyRow = (
  catalog: PublicComparisonCatalog,
  update: (row: PublicComparisonRow) => PublicComparisonRow,
): PublicComparisonCatalog => ({
  ...catalog,
  cohorts: catalog.cohorts.map((cohort, index) =>
    index === 0 ? { ...cohort, rows: cohort.rows.map(update) } : cohort,
  ),
});

export const incompleteCoverageCatalog = replaceOnlyRow(verifiedSyntheticCatalog, (row) => ({
  ...row,
  coverage: { ...row.coverage, status: "incomplete" },
  metrics: {
    ...row.metrics,
    passRate: {
      availability: "withheld",
      reason: "incomplete_coverage",
      unit: "unavailable",
    },
  },
  unrankedReasons: ["pilot", "synthetic", "incomplete_coverage"],
}));

export const aggregateOnlyCatalog = replaceOnlyRow(verifiedSyntheticCatalog, (row) => ({
  ...row,
  evidence: "aggregate_only",
}));

export const emptyPublicCatalog: PublicComparisonCatalog = {
  ...verifiedSyntheticCatalog,
  cohorts: [],
};
