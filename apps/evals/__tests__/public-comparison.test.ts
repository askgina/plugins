import publicationRaw from "../../../ai_docs/evals-handoff/planning/fixtures/synthetic-publication-correction-rev2.json?raw";
import indexRaw from "../../../ai_docs/evals-handoff/planning/fixtures/synthetic-index.json?raw";
import { describe, expect, it } from "vitest";
import {
  buildPublicComparisonCatalog,
  loadPublicComparisonCatalog,
} from "../src/lib/public-comparison";
import { parsePublicArtifact } from "../src/lib/public-results";

const encoded = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer;

describe("public comparison adapter", () => {
  it("verifies the canonical publication and preserves public metric availability", () =>
    loadPublicComparisonCatalog({ publicationRaw, indexRaw }).then((catalog) => {
      const row = catalog.cohorts[0]?.rows[0];

      expect(catalog.cohorts).toHaveLength(1);
      expect(catalog.withdrawnCount).toBe(1);
      expect(row?.metrics.passRate).toMatchObject({
        availability: "available",
        value: 0.875,
        numerator: 7,
        denominator: 8,
      });
      expect(row?.metrics.latencyP50).toMatchObject({ availability: "available", value: 1200 });
      expect(row?.metrics.tokenUsage).toMatchObject({ availability: "available", value: 9280 });
      expect(row?.metrics.answerAccuracy).toEqual({
        availability: "not_evaluated",
        reason: "no_declared_method",
        unit: "unavailable",
      });
      expect(row?.unrankedReasons).toEqual(["pilot", "synthetic"]);
    }));

  it("rejects publication bytes that no longer match the index", () => {
    const changed = publicationRaw.replace(
      "synthetic-reasoning-medium",
      "synthetic-reasoning-high",
    );
    return expect(
      loadPublicComparisonCatalog({ publicationRaw: changed, indexRaw }),
    ).rejects.toThrow("SHA-256");
  });

  it("separates publications whose declared benchmark conditions differ", () => {
    const publicationArtifact = parsePublicArtifact(encoded(publicationRaw));
    const indexArtifact = parsePublicArtifact(encoded(indexRaw));
    if (publicationArtifact.kind !== "publication" || indexArtifact.kind !== "index") {
      throw new Error("Expected canonical public fixtures");
    }
    if (publicationArtifact.publication.content.kind !== "result") {
      throw new Error("Expected a result publication");
    }
    const second = {
      ...publicationArtifact.publication,
      publicationId: "synthetic-publication-other-target",
      revisionId: "synthetic-publication-other-target-rev1",
      revision: 1,
      supersedes: null,
      content: {
        kind: "result" as const,
        result: {
          ...publicationArtifact.publication.content.result,
          resultId: "synthetic-result-other-target",
          benchmark: {
            ...publicationArtifact.publication.content.result.benchmark,
            target: "synthetic-target-other",
          },
        },
      },
    };

    const catalog = buildPublicComparisonCatalog(
      [publicationArtifact.publication, second],
      indexArtifact.index,
    );
    expect(catalog.cohorts).toHaveLength(2);
    expect(catalog.cohorts.map((cohort) => cohort.conditions.target)).toEqual([
      "synthetic-target-gina-mcp",
      "synthetic-target-other",
    ]);
  });
});
