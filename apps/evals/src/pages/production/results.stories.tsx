import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  productionAggregateOnlyState,
  productionEmptyState,
  productionErrorState,
  productionIncompleteState,
  productionLabelsOnlyState,
  productionLoadingState,
  productionMissingMetricsState,
  productionMultipleCohortsState,
  productionPrimaryPublicationId,
  productionReadyState,
  productionSecondaryPublicationId,
  productionWithdrawnState,
  productionWithheldState,
} from "../../stories/production-fixtures";
import "../../styles/evals.css";
import { ResultsPage } from "./results";

const SYNTHETIC_NOTE = "Synthetic fixtures, not measured model results.";

const NO_MATCH_SEARCH = "zz-no-such-candidate";

const meta = {
  title: "Evals/Production UI/Results",
  component: ResultsPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: `Task-family navigation above a model-first results table. Each model expands into configuration variants and their runs; comparing two runs in one cohort is a secondary action. Unavailable family breakdowns are explicit. ${SYNTHETIC_NOTE}`,
      },
    },
  },
  args: {
    state: productionReadyState,
    initialFamily: "All tasks",
    initialCohortId: undefined,
    initialSearch: "",
    initialCompareIds: [],
  },
  render: (args) => (
    <ResultsPage
      key={JSON.stringify([
        args.initialFamily,
        args.initialCohortId,
        args.initialSearch,
        args.initialCompareIds,
      ])}
      {...args}
    />
  ),
} satisfies Meta<typeof ResultsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

function describe(text: string): Story["parameters"] {
  return { docs: { description: { story: `${text} ${SYNTHETIC_NOTE}` } } };
}

export const Ready: Story = {
  parameters: describe(
    "Default All tasks view: five synthetic models, each with a newest run summary and an expandable run list, including a failing run, a null token sample and not-applicable checks.",
  ),
};

export const Portfolio: Story = {
  args: { initialFamily: "Portfolio" },
  parameters: describe(
    "Portfolio selected. No family breakdown is published yet, so overall scores are not presented as Portfolio results.",
  ),
};

export const ReadyEmpty: Story = {
  args: { state: productionEmptyState },
  parameters: describe(
    "Ready catalog with no current publications, so the table has nothing to list.",
  ),
};

export const EmptySearch: Story = {
  args: { initialSearch: NO_MATCH_SEARCH },
  parameters: describe(
    "Ready cohort with a search term that matches no row; clearing the search restores the table.",
  ),
};

export const Incomplete: Story = {
  args: { state: productionIncompleteState },
  parameters: describe(
    "Six of ten planned attempts were observed. Headline pass rate stays unavailable rather than recalculated from counts.",
  ),
};

export const MissingMetrics: Story = {
  args: { state: productionMissingMetricsState },
  parameters: describe(
    "Latency is available but token usage was not captured. The token total stays unavailable rather than zero.",
  ),
};

export const MultipleCohorts: Story = {
  args: { state: productionMultipleCohortsState },
  parameters: describe(
    "Two models have runs in two benchmark cohorts. Each run appears under its own exact-pin variant within the same model, and comparison stays scoped to the selected cohort.",
  ),
};

export const AggregateOnly: Story = {
  args: { state: productionAggregateOnlyState },
  parameters: describe("Publications that publish aggregates without per-case evidence."),
};

export const Withheld: Story = {
  args: { state: productionWithheldState },
  parameters: describe(
    "Attempt detail and latency are withheld after privacy review, with their availability stated explicitly.",
  ),
};

export const LabelsOnly: Story = {
  args: { state: productionLabelsOnlyState },
  parameters: describe(
    "Configuration labels are public, but there is no configuration pin. Metrics keep their declared availability.",
  ),
};

export const Withdrawn: Story = {
  args: { state: productionWithdrawnState },
  parameters: describe(
    "Only a withdrawal notice remains. There are no table rows; the exclusion count appears without identities or old results.",
  ),
};

export const Loading: Story = {
  args: { state: productionLoadingState },
  parameters: describe("Catalog request still in flight."),
};

export const Error: Story = {
  args: { state: productionErrorState },
  parameters: describe(
    "Catalog request failed; the shell and hero stay visible with the error state.",
  ),
};

export const ComparisonOpen: Story = {
  args: {
    initialCompareIds: [productionPrimaryPublicationId, productionSecondaryPublicationId],
  },
  parameters: describe(
    "Primary and secondary publications preselected from the default cohort, with the comparison dialog already open.",
  ),
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
  parameters: describe("Default ready cohort at the 375px mobile preview."),
};

export const MobileComparisonOpen: Story = {
  args: ComparisonOpen.args,
  globals: { viewport: { value: "mobile", isRotated: false } },
  parameters: describe("Comparison dialog open at the 375px mobile preview."),
};
