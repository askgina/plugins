import type { Meta, StoryObj } from "@storybook/react-vite";
import { PrototypeModelProfilePage } from "./model-profile";

const meta = {
  title: "Evals/Prototype/Model profile",
  component: PrototypeModelProfilePage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof PrototypeModelProfilePage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Sol: Story = {
  args: {
    modelId: "gpt-sol",
  },
};

export const SolDeepLink: Story = {
  args: {
    modelId: "gpt-sol",
    runId: "sol-spot-incomplete",
  },
};

export const ClaudeWithheld: Story = {
  args: {
    modelId: "claude-fable",
  },
};

export const Muse: Story = {
  args: {
    modelId: "muse-spark",
  },
};

export const OutsideCohort: Story = {
  args: {
    modelId: "synthetic-meridian",
  },
};

export const Mobile: Story = {
  args: {
    modelId: "gpt-sol",
  },
  globals: { viewport: { value: "mobile", isRotated: false } },
};
