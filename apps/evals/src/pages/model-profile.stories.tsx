import type { Meta, StoryObj } from "@storybook/react-vite";
import { ModelProfilePage } from "./model-profile";

const meta = {
  title: "Evals/Model profile",
  component: ModelProfilePage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ModelProfilePage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Gpt55: Story = {
  args: {
    modelId: "gpt-5.5",
  },
};

export const GptSol: Story = {
  args: {
    modelId: "gpt-sol",
  },
};

export const MuseSpark: Story = {
  args: {
    modelId: "muse-spark-1-3",
  },
};

export const ClaudeFable: Story = {
  args: {
    modelId: "claude-fable-5-1",
  },
};

export const ClaudeOpus: Story = {
  args: {
    modelId: "claude-opus-5",
  },
};

export const RunDetailExpanded: Story = {
  args: {
    modelId: "gpt-sol",
    initialRunId: "sol-perps-1",
  },
};

export const SyntheticDemonstration: Story = {
  args: {
    modelId: "synthetic-meridian",
    includeSynthetic: true,
  },
};

export const NotFound: Story = {
  args: {
    modelId: "unknown-model-xyz",
  },
};

export const Mobile: Story = {
  args: {
    modelId: "gpt-5.5",
  },
  globals: { viewport: { value: "mobile", isRotated: false } },
};
