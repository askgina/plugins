import type { Meta, StoryObj } from "@storybook/react-vite";
import { LeaderboardPage } from "./leaderboard";
import "../styles/evals.css";

const meta = {
  title: "Evals/Leaderboard",
  component: LeaderboardPage,
  render: (args) => (
    <LeaderboardPage key={`${args.initialFamily}:${args.initialSearch}`} {...args} />
  ),
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof LeaderboardPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Portfolio: Story = {
  args: {
    initialFamily: "Portfolio",
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
