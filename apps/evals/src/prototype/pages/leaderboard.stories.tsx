import type { Meta, StoryObj } from "@storybook/react-vite";

import { PrototypeLeaderboardPage } from "./leaderboard";
import "../../styles/evals.css";

const meta = {
  title: "Prototype/Leaderboard",
  component: PrototypeLeaderboardPage,
  render: (args) => (
    <PrototypeLeaderboardPage key={`${args.initialFamily}:${args.initialCohortId}`} {...args} />
  ),
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof PrototypeLeaderboardPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Spot: Story = {};

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

/** The muse_cli cohort leaves every omp_harness run outside — all dimmed. */
export const MuseSpotCohort: Story = {
  args: {
    initialCohortId:
      "ask-gina-model-spot-v1:sv1:fv1:6738637b1846:muse_cli:tools:read:r3:conformance",
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
