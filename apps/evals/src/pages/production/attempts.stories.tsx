import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PublicEvalAttemptSummary } from "@askgina/contracts";
import type { PublicComparisonState } from "../../lib/use-public-comparison";
import {
  productionAggregateOnlyState,
  productionEmptyState,
  productionErrorState,
  productionIncompleteState,
  productionLabelsOnlyState,
  productionLoadingState,
  productionMultipleCohortsState,
  productionPrimaryPublicationId,
  productionReadyState,
  productionWithdrawnState,
  productionWithheldState,
} from "../../stories/production-fixtures";
import { AttemptExplorerPage } from "./attempts";

const SYNTHETIC_NOTE =
  "Synthetic preview data. Nothing here is a measured evaluation result; the fixtures only exercise public v1 catalog shapes.";

/** Select only attempt summaries retained in the fixture catalog. */
function findAttempt(
  state: PublicComparisonState,
  predicate: (attempt: PublicEvalAttemptSummary) => boolean,
  description: string,
): { publicationId: string; attempt: PublicEvalAttemptSummary } {
  if (state.status === "ready") {
    for (const cohort of state.catalog.cohorts) {
      for (const row of cohort.rows) {
        if (row.result.evidence.attemptDetail !== "available") continue;
        const attempt = row.result.attempts?.find(predicate);
        if (attempt !== undefined) return { publicationId: row.publicationId, attempt };
      }
    }
  }
  throw new globalThis.Error(
    `production-fixtures: the default ready state retains no ${description}`,
  );
}

/**
 * The multiple-cohort fixture repeats one candidate under a distinct publication id. Pick that
 * repeated publication outside its first cohort so the run selector shows cohort grouping in use.
 */
function repeatedCandidatePublicationId(state: PublicComparisonState): string {
  if (state.status !== "ready") {
    throw new globalThis.Error("production-fixtures: multiple-cohort state must be ready");
  }
  const firstCohort = new Map<string, string>();
  for (const cohort of state.catalog.cohorts) {
    for (const row of cohort.rows) {
      const seenIn = firstCohort.get(row.id);
      if (seenIn === undefined) firstCohort.set(row.id, cohort.id);
      else if (seenIn !== cohort.id) return row.publicationId;
    }
  }
  throw new globalThis.Error("production-fixtures: no candidate repeats across cohorts");
}

const failure = findAttempt(
  productionReadyState,
  (attempt) => attempt.verdict === "fail",
  "failed attempt",
);
const missingUsage = findAttempt(
  productionReadyState,
  (attempt) => attempt.tokenUsage === null,
  "attempt with a null token sample",
);
const repeatedPublicationId = repeatedCandidatePublicationId(productionMultipleCohortsState);

const meta = {
  title: "Evals/Production UI/Attempt explorer",
  component: AttemptExplorerPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: `Per-attempt verdicts, check outcomes, durations and retained token usage for one current public publication, with verdict, case and search filters and a detail panel that stacks under the table on narrow screens. ${SYNTHETIC_NOTE}`,
      },
    },
  },
  args: {
    state: productionReadyState,
    publicationId: productionPrimaryPublicationId,
    initialVerdict: "all",
    initialCaseId: undefined,
    initialAttemptId: undefined,
  },
  argTypes: {
    initialVerdict: {
      control: "inline-radio",
      options: ["all", "pass", "fail"],
    },
  },
  render: (args) => (
    <AttemptExplorerPage
      key={JSON.stringify([
        args.publicationId,
        args.initialVerdict,
        args.initialCaseId,
        args.initialAttemptId,
      ])}
      {...args}
    />
  ),
} satisfies Meta<typeof AttemptExplorerPage>;

export default meta;

type Story = StoryObj<typeof meta>;

function describe(text: string): Story["parameters"] {
  return { docs: { description: { story: `${text} ${SYNTHETIC_NOTE}` } } };
}

export const Available: Story = {
  parameters: describe(
    "Primary publication with every retained attempt listed and no filter or selection applied.",
  ),
};

export const FailuresOnly: Story = {
  args: {
    publicationId: failure.publicationId,
    initialVerdict: "fail",
  },
  parameters: describe("Verdict filter pre-set to a publication with retained failed attempts."),
};

export const SelectedFailure: Story = {
  args: {
    publicationId: failure.publicationId,
    initialVerdict: "fail",
    initialAttemptId: failure.attempt.id,
  },
  parameters: describe(
    "A failed attempt found in the ready catalog is pre-selected, so the detail panel opens on its check outcomes and public failure categories.",
  ),
};

export const MissingUsage: Story = {
  args: {
    publicationId: missingUsage.publicationId,
    initialAttemptId: missingUsage.attempt.id,
  },
  parameters: describe(
    "An attempt whose token usage was not retained is pre-selected; the token cell and detail must say so rather than show zero.",
  ),
};

export const EmptyCase: Story = {
  args: {
    initialCaseId: "case-does-not-exist",
  },
  parameters: describe(
    "Case filter pre-set to an id absent from the run, leaving the table with no matching attempts.",
  ),
};

export const IncompleteCoverage: Story = {
  args: {
    state: productionIncompleteState,
    publicationId: undefined,
  },
  parameters: describe(
    "Observed counts show incomplete coverage; attempt detail is not retained and headline pass rate stays unavailable.",
  ),
};

export const AggregateOnly: Story = {
  args: {
    state: productionAggregateOnlyState,
    publicationId: undefined,
  },
  parameters: describe(
    "Aggregate-only publication with no per-attempt evidence retained; the page explains why instead of rendering an empty table.",
  ),
};

export const Withheld: Story = {
  args: {
    state: productionWithheldState,
    publicationId: undefined,
  },
  parameters: describe("Publication whose attempt evidence is withheld, with the stated reason."),
};

export const LabelsOnly: Story = {
  args: {
    state: productionLabelsOnlyState,
    publicationId: undefined,
  },
  parameters: describe(
    "Labels-only configuration metadata with retained attempt evidence but no configuration pin.",
  ),
};

export const MultipleCohorts: Story = {
  args: {
    state: productionMultipleCohortsState,
    publicationId: repeatedPublicationId,
  },
  parameters: describe(
    "Catalog with more than one cohort; the selected run is the candidate repeated under a distinct publication id in another cohort, so the run selector is grouped by benchmark condition.",
  ),
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

export const Withdrawn: Story = {
  args: {
    state: productionWithdrawnState,
    publicationId: undefined,
  },
  parameters: describe(
    "Catalog carrying a withdrawn count; withdrawn publications never appear as runs and only their count is shown.",
  ),
};

export const Loading: Story = {
  args: {
    state: productionLoadingState,
    publicationId: undefined,
  },
  parameters: describe("Catalog still loading."),
};

export const ErrorState: Story = {
  name: "Error",
  args: {
    state: productionErrorState,
    publicationId: undefined,
  },
  parameters: describe(
    "Catalog load failed; the page shows a generic public verification failure notice.",
  ),
};

export const Mobile: Story = {
  args: {
    publicationId: failure.publicationId,
    initialAttemptId: failure.attempt.id,
  },
  globals: { viewport: { value: "mobile", isRotated: false } },
  parameters: describe("Selected attempt at the configured 375px mobile viewport."),
};
