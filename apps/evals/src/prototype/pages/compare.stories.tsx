import type { Meta, StoryObj } from "@storybook/react-vite";
import { PrototypeComparePage } from "./compare";
import "../../styles/evals.css";

const meta = {
  title: "Evals/Prototype/Compare",
  component: PrototypeComparePage,
  render: (args) => <PrototypeComparePage key={`${args.left}:${args.right}`} {...args} />,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof PrototypeComparePage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const SameModelEligible: Story = {
  args: { left: "sol-spot-1", right: "sol-spot-2" },
};

export const CrossModelEligible: Story = {
  args: { left: "gpt55-spot-1", right: "fable-spot-1" },
};

export const BlockedLabelsOnly: Story = {
  args: { left: "sol-spot-1", right: "sol-spot-labels-only" },
};

export const BlockedCrossCohort: Story = {
  args: { left: "muse-spot-1", right: "fable-spot-1" },
};

export const BlockedEvidenceCategory: Story = {
  args: { left: "sol-spot-1", right: "meridian-spot-1" },
};

export const BlockedIncompleteCoverage: Story = {
  args: { left: "sol-spot-1", right: "sol-spot-incomplete" },
};
