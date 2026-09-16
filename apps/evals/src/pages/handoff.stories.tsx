import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PublicEvalIndex, PublicEvalPublication } from "@askgina/contracts";
import { HandoffPage, type LoadState } from "./handoff";
import { parsePublicArtifact } from "../lib/public-results";
import currentRaw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-publication-correction-rev2.json?raw";
import oldRaw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-publication-correction-rev1.json?raw";
import noticeRaw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-publication-withdrawal-notice.json?raw";
import historyRaw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-index.json?raw";

const encodeText = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer;

const publication = (bytes: ArrayBuffer): PublicEvalPublication => {
  const parsed = parsePublicArtifact(bytes);
  if (parsed.kind !== "publication") throw new Error("Expected a publication fixture");
  return parsed.publication;
};

const index = (bytes: ArrayBuffer): PublicEvalIndex => {
  const parsed = parsePublicArtifact(bytes);
  if (parsed.kind !== "index") throw new Error("Expected an index fixture");
  return parsed.index;
};

const currentBytes = encodeText(currentRaw);
const oldBytes = encodeText(oldRaw);
const noticeBytes = encodeText(noticeRaw);
const syntheticIndex = index(encodeText(historyRaw));
const currentPublication = publication(currentBytes);
const oldPublication = publication(oldBytes);
const noticePublication = publication(noticeBytes);

// File-byte SHA-256 of the synthetic publication fixtures; matches the
// index-recorded revision hashes so assessment is current vs superseded.
const CURRENT_SHA256 = "ae928c1e244d5f0fddc2b2b66848cd23ddd74cec03895cf7e94e486a3c542b5f";
const OLD_SHA256 = "a830e60b30f69b2d96cc945a6de49deaca97de986aeeab12ef07d102af831270";
const NOTICE_SHA256 = "f6fc8441979a958892853d140425825418d52b5f079634ab77bba9581635d58d";

const withdrawnIndex: PublicEvalIndex = {
  ...syntheticIndex,
  publications: syntheticIndex.publications.map((entry) =>
    entry.publicationId !== currentPublication.publicationId
      ? entry
      : {
          ...entry,
          status: "withdrawn",
          summary: null,
          currentRevisionId: "synthetic-withdrawal-r3",
          revisions: [
            ...entry.revisions.map((revision) => ({
              ...revision,
              state: "removed" as const,
              path: null,
              sha256: null,
            })),
            {
              revisionId: "synthetic-withdrawal-r3",
              revision: 3,
              kind: "withdrawal_notice",
              state: "current",
              publishedAt: syntheticIndex.generatedAt,
              path: "synthetic-withdrawal-r3.json",
              sha256: "a".repeat(64),
            },
          ],
        },
  ),
};

const loaded = (
  publicationValue: PublicEvalPublication | null,
  indexValue: PublicEvalIndex | null,
  publicationSha256: string | null,
): LoadState => ({
  status: "loaded",
  publication: publicationValue,
  index: indexValue,
  publicationSha256,
});

const meta = {
  title: "Evals/Handoff",
  component: HandoffPage,
  render: (args) => (
    <HandoffPage key={JSON.stringify(args.initialState)} initialState={args.initialState} />
  ),
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof HandoffPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  args: {
    initialState: { status: "loading" },
  },
};

export const LoadError: Story = {
  args: {
    initialState: {
      status: "error",
      message: "Each public JSON file must be no larger than 5 MiB.",
    },
  },
};

export const LoadedSyntheticPublication: Story = {
  args: {
    initialState: loaded(currentPublication, null, null),
  },
};

export const LoadedSyntheticIndex: Story = {
  args: {
    initialState: loaded(null, syntheticIndex, null),
  },
};

export const LoadedSyntheticPair: Story = {
  args: {
    initialState: loaded(currentPublication, syntheticIndex, CURRENT_SHA256),
  },
};

export const LoadedSyntheticSuperseded: Story = {
  args: {
    initialState: loaded(oldPublication, syntheticIndex, OLD_SHA256),
  },
};

export const LoadedSyntheticWithdrawalNotice: Story = {
  args: {
    initialState: loaded(noticePublication, syntheticIndex, NOTICE_SHA256),
  },
};

export const LoadedSyntheticWithdrawn: Story = {
  args: {
    initialState: loaded(currentPublication, withdrawnIndex, CURRENT_SHA256),
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
