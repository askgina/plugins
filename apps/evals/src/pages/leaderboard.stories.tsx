import type { Meta, StoryObj } from "@storybook/react-vite";
import { LeaderboardPage } from "./leaderboard";
import { canonicalRuns } from "../canonical/canonical";
import { unifiedLeaderboardRows } from "../canonical/selectors";
import "../styles/evals.css";

const meta = {
  title: "Evals/Leaderboard",
  component: LeaderboardPage,
  render: (args) => (
    <LeaderboardPage key={`${args.initialSearch}:${args.initialExpandedModel}`} {...args} />
  ),
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LeaderboardPage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Expanded: Story = { args: { initialExpandedModel: "muse-spark" } };
export const UnavailableTiming: Story = { args: { initialExpandedModel: "gpt-sol" } };
export const SpotOnly: Story = {
  args: { initialSearch: "GPT-5.5", initialExpandedModel: "gpt-5.5" },
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
    rows: unifiedLeaderboardRows(
      canonicalRuns.map((run) =>
        run.runId === "sol-perps-1" ? { ...run, dispatchCoverage: "incomplete" as const } : run,
      ),
    ),
    initialExpandedModel: "gpt-sol",
  },
};
export const Mobile: Story = { globals: { viewport: { value: "mobile", isRotated: false } } };
