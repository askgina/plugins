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

export const Mobile: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
