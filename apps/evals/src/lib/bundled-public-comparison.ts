import publicationRaw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-publication-correction-rev2.json?raw";
import indexRaw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-index.json?raw";
import { loadPublicComparisonCatalog, type PublicComparisonCatalog } from "./public-comparison";

let pendingCatalog: Promise<PublicComparisonCatalog> | undefined;

export const loadBundledPublicComparison = (): Promise<PublicComparisonCatalog> => {
  pendingCatalog ??= loadPublicComparisonCatalog({ publicationRaw, indexRaw });
  return pendingCatalog;
};
