import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskExplorerPage } from "./task-explorer";
import "../styles/evals.css";

const meta = {
  title: "Evals/Task explorer",
  component: TaskExplorerPage,
  render: (args) => (
    <TaskExplorerPage
      key={`${args.initialFamily}:${args.initialCaseId}:${args.initialInspectCaseId}:${args.initialEvidenceSection}`}
      {...args}
    />
  ),
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof TaskExplorerPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Perps: Story = {
  args: {
    initialFamily: "Perps",
  },
};

export const Predictions: Story = {
  args: {
    initialFamily: "Predictions",
  },
};

/** Portfolio has published case definitions but no measured runs — the explicit
 * no-evidence state. */
export const PortfolioNoEvidence: Story = {
  args: {
    initialFamily: "Portfolio",
  },
};

/** Attempt drilldown open on a Spot case — full evidence (native checks,
 * durations, tokens) for the September 11 runs, withheld fields for Claude. */
export const InspectAttempts: Story = {
  args: {
    initialFamily: "Spot",
    initialInspectCaseId: "spot-token-metadata",
  },
};

/** Evidence modal on the expected-tool section for a selected case. */
export const EvidenceOpen: Story = {
  args: {
    initialFamily: "Spot",
    initialCaseId: "spot-simple-price",
    initialEvidenceSection: "tools",
  },
};

/** Evidence modal on the case-definition section — objective, expected
 * behavior, and category for the selected case. */
export const EvidenceDefinition: Story = {
  args: {
    initialFamily: "Spot",
    initialCaseId: "spot-simple-price",
    initialEvidenceSection: "definition",
  },
};

/** Evidence modal on the grading-criteria section — the rubric list a
 * measured attempt is scored against. */
export const EvidenceRubric: Story = {
  args: {
    initialFamily: "Spot",
    initialCaseId: "spot-simple-price",
    initialEvidenceSection: "rubric",
  },
};

/** Evidence modal on the dataset section — the prompt and expected call the
 * case was authored with. */
export const EvidenceDataset: Story = {
  args: {
    initialFamily: "Spot",
    initialCaseId: "spot-simple-price",
    initialEvidenceSection: "dataset",
  },
};

/** Attempt drilldown on a Perps confusion-pair case — different run set and
 * forbidden-tool context than the Spot inspect story. */
export const PerpsInspect: Story = {
  args: {
    initialFamily: "Perps",
    initialInspectCaseId: "perps-account",
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
