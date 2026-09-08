import currentRaw from "../../../ai_docs/evals-handoff/planning/fixtures/synthetic-publication-correction-rev2.json?raw";
import oldRaw from "../../../ai_docs/evals-handoff/planning/fixtures/synthetic-publication-correction-rev1.json?raw";
import noticeRaw from "../../../ai_docs/evals-handoff/planning/fixtures/synthetic-publication-withdrawal-notice.json?raw";
import historyRaw from "../../../ai_docs/evals-handoff/planning/fixtures/synthetic-index.json?raw";
import { describe, expect, it } from "vitest";
import {
  assessPublicationAgainstIndex,
  parsePublicArtifact,
  publicArtifactSha256,
} from "../src/lib/public-results";

const encodeText = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer;
const encode = (value: unknown): ArrayBuffer => encodeText(JSON.stringify(value));
const publication = (bytes: ArrayBuffer) => {
  const parsed = parsePublicArtifact(bytes);
  if (parsed.kind !== "publication") throw new Error("Expected a publication fixture");
  return parsed.publication;
};
const index = (bytes: ArrayBuffer) => {
  const parsed = parsePublicArtifact(bytes);
  if (parsed.kind !== "index") throw new Error("Expected an index fixture");
  return parsed.index;
};

const currentBytes = encodeText(currentRaw);
const history = index(encodeText(historyRaw));

describe("public artifact browser boundary", () => {
  it("checks original bytes, rejecting changed content and reserialized snapshots with unchanged IDs", () => {
    const current = publication(currentBytes);
    const changedBytes = encode({ ...current, publishedAt: "2026-09-07T11:01:00Z" });
    const changed = publication(changedBytes);
    const reserializedBytes = encode(current);

    return Promise.all([
      publicArtifactSha256(currentBytes),
      publicArtifactSha256(changedBytes),
      publicArtifactSha256(reserializedBytes),
    ]).then(([currentHash, changedHash, reserializedHash]) => {
      expect(assessPublicationAgainstIndex(current, history, currentHash).status).toBe("current");
      expect(changed.revisionId).toBe(current.revisionId);
      expect(assessPublicationAgainstIndex(changed, history, changedHash).status).toBe("hidden");
      expect(assessPublicationAgainstIndex(current, history, reserializedHash).status).toBe(
        "hidden",
      );
    });
  });

  it("shows verified historical snapshots but hides result bytes after withdrawal", () => {
    const oldBytes = encodeText(oldRaw);
    const old = publication(oldBytes);
    const current = publication(currentBytes);
    const withdrawn = index(
      encode({
        ...history,
        publications: history.publications.map((entry) =>
          entry.publicationId !== current.publicationId
            ? entry
            : {
                ...entry,
                status: "withdrawn",
                summary: null,
                currentRevisionId: "synthetic-withdrawal-r3",
                revisions: [
                  ...entry.revisions.map((revision) => ({
                    ...revision,
                    state: "removed",
                    path: null,
                    sha256: null,
                  })),
                  {
                    revisionId: "synthetic-withdrawal-r3",
                    revision: 3,
                    kind: "withdrawal_notice",
                    state: "current",
                    publishedAt: history.generatedAt,
                    path: "synthetic-withdrawal-r3.json",
                    sha256: "a".repeat(64),
                  },
                ],
              },
        ),
      }),
    );
    const noticeBytes = encodeText(noticeRaw);

    return Promise.all([
      publicArtifactSha256(oldBytes),
      publicArtifactSha256(currentBytes),
      publicArtifactSha256(noticeBytes),
    ]).then(([oldHash, currentHash, noticeHash]) => {
      expect(assessPublicationAgainstIndex(old, history, oldHash).status).toBe("superseded");
      expect(assessPublicationAgainstIndex(current, withdrawn, currentHash).status).toBe("hidden");
      expect(
        assessPublicationAgainstIndex(publication(noticeBytes), history, noticeHash).status,
      ).toBe("current");
    });
  });

  it("accepts nested OpenRouter model identities in publications and current-index summaries", () => {
    const model = "openrouter/openai/gpt-5.1";
    const current = publication(currentBytes);
    if (current.content.kind !== "result") throw new Error("Expected a result publication fixture");
    const entry = history.publications[0];
    if (entry?.summary === null || entry?.summary === undefined) {
      throw new Error("Expected a current index summary fixture");
    }

    expect(
      parsePublicArtifact(
        encode({
          ...current,
          content: {
            ...current.content,
            result: {
              ...current.content.result,
              configuration: { ...current.content.result.configuration, model },
            },
          },
        }),
      ).kind,
    ).toBe("publication");
    expect(
      parsePublicArtifact(
        encode({
          ...history,
          publications: [
            { ...entry, summary: { ...entry.summary, model } },
            ...history.publications.slice(1),
          ],
        }),
      ).kind,
    ).toBe("index");
  });

  it("rejects malformed model identities without relaxing generic identifiers", () => {
    const current = publication(currentBytes);
    if (current.content.kind !== "result") throw new Error("Expected a result publication fixture");
    const entry = history.publications[0];
    if (entry?.summary === null || entry?.summary === undefined) {
      throw new Error("Expected a current index summary fixture");
    }

    const malformedModels = [
      "openrouter//gpt-5.1",
      "openrouter/../gpt-5.1",
      `openrouter/${"a".repeat(118)}`,
    ] as const;
    for (const model of malformedModels) {
      expect(
        parsePublicArtifact(
          encode({
            ...current,
            content: {
              ...current.content,
              result: {
                ...current.content.result,
                configuration: { ...current.content.result.configuration, model },
              },
            },
          }),
        ).kind,
      ).toBe("unsupported");
      expect(
        parsePublicArtifact(
          encode({
            ...history,
            publications: [
              { ...entry, summary: { ...entry.summary, model } },
              ...history.publications.slice(1),
            ],
          }),
        ).kind,
      ).toBe("unsupported");
    }

    expect(parsePublicArtifact(encode({ ...current, publicationId: "openai/gpt-5.1" })).kind).toBe(
      "unsupported",
    );
  });

  it("rejects malformed UTF-8 and BOM-prefixed JSON rather than normalizing the input", () => {
    expect(
      parsePublicArtifact(new Uint8Array([0x7b, 0x22, 0xc0, 0xaf, 0x22, 0x7d]).buffer).kind,
    ).toBe("unsupported");
    const withBom = new Uint8Array(currentBytes.byteLength + 3);
    withBom.set([0xef, 0xbb, 0xbf]);
    withBom.set(new Uint8Array(currentBytes), 3);
    expect(parsePublicArtifact(withBom.buffer).kind).toBe("unsupported");
    expect(parsePublicArtifact(currentBytes).kind).toBe("publication");
  });

  it("accepts contiguous history beyond fifty revisions but rejects a gap", () => {
    const entry = history.publications[0];
    if (entry === undefined) throw new Error("Expected indexed fixture");
    const revisions = Array.from({ length: 51 }, (_, i) => ({
      revisionId: `synthetic-rev-${i + 1}`,
      revision: i + 1,
      kind: "result",
      state: i === 50 ? "current" : "superseded",
      publishedAt: history.generatedAt,
      path: `synthetic-rev-${i + 1}.json`,
      sha256: "a".repeat(64),
    }));
    const extended = {
      ...history,
      publications: [{ ...entry, currentRevisionId: "synthetic-rev-51", revisions }],
    };
    expect(parsePublicArtifact(encode(extended)).kind).toBe("index");
    expect(
      parsePublicArtifact(
        encode({
          ...extended,
          publications: [{ ...extended.publications[0], revisions: revisions.slice(1) }],
        }),
      ).kind,
    ).toBe("unsupported");
  });
});
