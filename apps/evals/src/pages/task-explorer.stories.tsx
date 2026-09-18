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
      key={`${args.initialFamily}:${args.initialCaseId}:${args.initialModelId}:${args.initialSearch}`}
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
  args: { initialCaseId: "spot-token-metadata", initialModelId: "muse-spark" },
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
