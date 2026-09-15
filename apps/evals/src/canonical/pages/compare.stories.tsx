import type { Meta, StoryObj } from "@storybook/react-vite";
import { ComparePage } from "./compare";
import "../../styles/evals.css";

const meta = {
  title: "Evals/Compare",
  component: ComparePage,
  render: (args) => <ComparePage key={`${args.left}:${args.right}`} {...args} />,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ComparePage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

// sol-spot-2 is a synthetic run — needs includeSynthetic to appear in pickers.
export const SameModelEligible: Story = {
  args: { left: "sol-spot-1", right: "sol-spot-2", includeSynthetic: true },
};

export const CrossModelEligible: Story = {
  args: { left: "gpt55-spot-1", right: "fable-spot-1" },
};

// sol-spot-labels-only is synthetic — Storybook-only blocked-state demo.
export const BlockedLabelsOnly: Story = {
  args: { left: "sol-spot-1", right: "sol-spot-labels-only", includeSynthetic: true },
};

export const BlockedCrossCohort: Story = {
  args: { left: "muse-spot-1", right: "fable-spot-1" },
};

// meridian-spot-1 is synthetic — Storybook-only blocked-state demo.
export const BlockedEvidenceCategory: Story = {
  args: { left: "sol-spot-1", right: "meridian-spot-1", includeSynthetic: true },
};

// sol-spot-incomplete is synthetic — Storybook-only blocked-state demo.
export const BlockedIncompleteCoverage: Story = {
  args: { left: "sol-spot-1", right: "sol-spot-incomplete", includeSynthetic: true },
};
