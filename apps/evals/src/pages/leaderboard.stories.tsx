import type { Meta, StoryObj } from "@storybook/react-vite";
import { LeaderboardPage } from "./leaderboard";
import { cohortsForFamily } from "../canonical/selectors";
import "../styles/evals.css";

const museSpotCohort = cohortsForFamily("Spot").find(
  (cohort) => cohort.target === "muse_cli",
)?.cohortId;

const meta = {
  title: "Evals/Leaderboard",
  component: LeaderboardPage,
  render: (args) => (
    <LeaderboardPage
      key={`${args.initialFamily}:${args.initialSearch}:${args.initialCohort}`}
      {...args}
    />
  ),
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof LeaderboardPage>;

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

export const SingleCohort: Story = {
  args: {
    initialCohort: museSpotCohort,
  },
};

export const EmptySearch: Story = {
  args: {
    initialSearch: "zzzz",
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
