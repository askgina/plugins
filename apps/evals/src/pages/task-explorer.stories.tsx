import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskExplorerPage } from "./task-explorer";
import { canonicalRuns } from "../canonical/canonical";
import { sortLeaderboardRows, unifiedLeaderboardRows } from "../canonical/selectors";
import "../styles/evals.css";

const meta = {
  title: "Evals/Task explorer",
  component: TaskExplorerPage,
  render: (args) => (
    <TaskExplorerPage
      key={`${args.initialFamily}:${args.initialCaseId}:${args.initialModelId}:${args.initialRunId}:${args.initialAttempt}:${args.initialView}:${args.initialSearch}`}
      {...args}
    />
  ),
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TaskExplorerPage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Perps: Story = { args: { initialFamily: "Perps" } };
export const Predictions: Story = { args: { initialFamily: "Predictions" } };
export const PortfolioNoEvidence: Story = { args: { initialFamily: "Portfolio" } };
export const Expanded: Story = {
  args: {
    initialCaseId: "spot-token-metadata",
    initialModelId: "astra",
    initialRunId: "astra-high-spot-1",
  },
};
export const RecordedAttempt: Story = {
  args: {
    initialCaseId: "perps-account",
    initialModelId: "astra",
    initialRunId: "astra-max-perps-1",
    initialAttempt: 3,
    initialView: "checks",
  },
};
export const ManyModels: Story = {
  decorators: [
    (Story) => (
      <>
        <p className="eval-demo-label">Synthetic preview: 60 models</p>
        <Story />
      </>
    ),
  ],
  args: {
    rows: Array.from({ length: 60 }, (_, index) => {
      const row = unifiedLeaderboardRows()[0]!;
      return {
        ...row,
        model: {
          ...row.model,
          id: `preview-${index}`,
          name: `Preview model ${String(index + 1).padStart(2, "0")}`,
          origin: "synthetic" as const,
        },
        runs: {},
      };
    }),
  },
};
export const UnavailableTiming: Story = {
  args: { initialCaseId: "predictions-multi-series-no-render", initialModelId: "gpt-sol" },
};
export const EmptySearch: Story = { args: { initialSearch: "zzzz" } };
export const PartialCoverage: Story = {
  decorators: [
    (Story) => (
      <>
        <p className="eval-demo-label">Synthetic preview: incomplete coverage</p>
        <Story />
      </>
    ),
  ],
  args: {
    initialCaseId: "spot-token-metadata",
    initialModelId: "gpt-sol",
    rows: sortLeaderboardRows(
      unifiedLeaderboardRows(
        canonicalRuns.map((run) =>
          run.runId === "sol-spot-1" ? { ...run, dispatchCoverage: "incomplete" as const } : run,
        ),
      ),
    ),
  },
};
export const Mobile: Story = { globals: { viewport: { value: "mobile", isRotated: false } } };
