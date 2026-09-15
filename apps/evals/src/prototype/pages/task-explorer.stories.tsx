import type { Meta, StoryObj } from "@storybook/react-vite";
import { PrototypeTaskExplorerPage } from "./task-explorer";
import "../../styles/evals.css";
import "../../pages/leaderboard.css";

const meta = {
  title: "Evals/Prototype/TaskExplorer",
  component: PrototypeTaskExplorerPage,
  render: (args) => <PrototypeTaskExplorerPage key={args.family ?? "default"} {...args} />,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof PrototypeTaskExplorerPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Spot: Story = {};

export const Perps: Story = {
  args: {
    family: "Perps",
  },
};

export const Predictions: Story = {
  args: {
    family: "Predictions",
  },
};

export const PortfolioNoEvidence: Story = {
  args: {
    family: "Portfolio",
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
