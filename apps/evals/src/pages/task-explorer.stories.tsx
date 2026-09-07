import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskExplorerPage } from "./task-explorer";
import "../styles/evals.css";

const meta = {
  title: "Evals/Task explorer",
  component: TaskExplorerPage,
  render: (args) => (
    <TaskExplorerPage
      key={`${args.initialFamily}:${args.initialSample}:${args.initialTrace}`}
      {...args}
    />
  ),
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof TaskExplorerPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Portfolio: Story = {
  args: {
    initialFamily: "Portfolio",
  },
};

export const Predictions: Story = {
  args: {
    initialFamily: "Predictions",
  },
};

export const TraceOpen: Story = {
  args: {
    initialFamily: "Portfolio",
    initialSample: 1,
    initialTrace: "kimi",
  },
};

export const Mobile: Story = {
  args: {
    initialFamily: "Portfolio",
  },
  globals: { viewport: { value: "mobile", isRotated: false } },
};
