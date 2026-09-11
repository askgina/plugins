import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  productionAggregateOnlyState,
  productionEmptyState,
  productionErrorState,
  productionIncompleteState,
  productionLabelsOnlyState,
  productionLoadingState,
  productionMissingMetricsState,
  productionPrimaryPublicationId,
  productionReadyState,
  productionSecondaryPublicationId,
  productionWithheldState,
} from "../../stories/production-fixtures";
import { RunPage } from "./run";

const SYNTHETIC_NOTE =
  "Synthetic preview data. Nothing here is a measured evaluation result; the fixtures only exercise public v1 catalog shapes.";

const meta = {
  title: "Evals/Production UI/Run detail",
  component: RunPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: `Run detail for one current public publication: revision, conformance versus accuracy, coverage, configuration pin, unavailable metrics with reasons, retained evidence, and the two-way comparison dialog. ${SYNTHETIC_NOTE}`,
      },
    },
  },
  args: {
    state: productionReadyState,
    publicationId: productionPrimaryPublicationId,
  },
  render: (args) => (
    <RunPage key={JSON.stringify([args.publicationId, args.comparePublicationId])} {...args} />
  ),
} satisfies Meta<typeof RunPage>;

export default meta;

type Story = StoryObj<typeof meta>;

function describe(text: string): Story["parameters"] {
  return { docs: { description: { story: `${text} ${SYNTHETIC_NOTE}` } } };
}

export const Default: Story = {
  parameters: describe("Primary publication from the default ready cohort."),
};

export const ComparisonOpen: Story = {
  args: {
    publicationId: productionPrimaryPublicationId,
    comparePublicationId: productionSecondaryPublicationId,
  },
  parameters: describe(
    "Primary publication with the comparison dialog already open against the secondary publication in the same cohort.",
  ),
};

export const AggregateOnly: Story = {
  args: {
    state: productionAggregateOnlyState,
    publicationId: undefined,
  },
  parameters: describe(
    "Aggregate-only publication: totals without per-case or per-attempt detail.",
  ),
};

export const Incomplete: Story = {
  args: {
    state: productionIncompleteState,
    publicationId: undefined,
  },
  parameters: describe(
    "Incomplete coverage, so the headline pass rate stays unavailable rather than recomputed.",
  ),
};

export const Withheld: Story = {
  args: {
    state: productionWithheldState,
    publicationId: undefined,
  },
  parameters: describe("Preview of unavailable or withheld public evidence."),
};

export const LabelsOnly: Story = {
  args: {
    state: productionLabelsOnlyState,
    publicationId: undefined,
  },
  parameters: describe("Preview of the labels-only publication state."),
};

export const MissingMetrics: Story = {
  args: {
    state: productionMissingMetricsState,
    publicationId: undefined,
  },
  parameters: describe("Preview of missing metrics without substituting zeros."),
};

export const MissingRun: Story = {
  args: {
    publicationId: "publication-does-not-exist",
  },
  parameters: describe("Unknown publication id in the route, exercising the not-found state."),
};

export const Empty: Story = {
  args: {
    state: productionEmptyState,
    publicationId: undefined,
  },
  parameters: describe("Ready catalog with no current publications."),
};

export const Loading: Story = {
  args: {
    state: productionLoadingState,
    publicationId: undefined,
  },
  parameters: describe("Catalog still loading."),
};

export const Error: Story = {
  args: {
    state: productionErrorState,
    publicationId: undefined,
  },
  parameters: describe("Catalog load failed; the page shows the verification error state."),
};

export const Mobile: Story = {
  args: {
    publicationId: undefined,
  },
  globals: { viewport: { value: "mobile", isRotated: false } },
  parameters: describe("First available run at the 375px mobile preview."),
};
