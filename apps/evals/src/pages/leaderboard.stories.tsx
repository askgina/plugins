import type { Meta, StoryObj } from "@storybook/react-vite";
import { LeaderboardPage } from "./leaderboard";
import {
  emptyPublicCatalog,
  incompleteCoverageCatalog,
  verifiedSyntheticCatalog,
} from "../stories/public-comparison-fixtures";
import "../styles/evals.css";

const meta = {
  title: "Evals/Leaderboard",
  component: LeaderboardPage,
  render: (args) => <LeaderboardPage key={args.initialSearch} {...args} />,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof LeaderboardPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const VerifiedSyntheticPublication: Story = {
  args: { catalog: verifiedSyntheticCatalog },
};

export const IncompleteCoverage: Story = {
  args: { catalog: incompleteCoverageCatalog },
};

export const EmptyIndex: Story = {
  args: { catalog: emptyPublicCatalog },
};

export const EmptySearch: Story = {
  args: {
    initialSearch: "zzzz",
  },
};

export const Mobile: Story = {
  args: { catalog: verifiedSyntheticCatalog },
  globals: { viewport: { value: "mobile", isRotated: false } },
};
