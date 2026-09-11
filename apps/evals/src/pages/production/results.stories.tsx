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
        component: `Public results table for current, publicly verified publications: cohort switcher, search, coverage filter, display-order sorting, unavailable reserved metrics with reasons, withdrawn count without identities, and a two-way comparison dialog scoped to one cohort. ${SYNTHETIC_NOTE}`,
      },
    },
  },
  args: {
    state: productionReadyState,
    initialCohortId: undefined,
    initialSearch: "",
    initialCompareIds: [],
  },
  render: (args) => (
    <ResultsPage
      key={JSON.stringify([args.initialCohortId, args.initialSearch, args.initialCompareIds])}
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
    "Default ready cohort of five synthetic publications, including a failing run, a null token sample and not-applicable checks.",
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
    "Several benchmark cohorts, one of which repeats a candidate under a distinct publication id. Switching cohorts resets the selection.",
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
