import type { Meta, StoryObj } from "@storybook/react-vite";
import { ModelProfilePage } from "./model-profile";
import "../styles/evals.css";

const meta = {
  title: "Evals/Model profile",
  component: ModelProfilePage,
  render: (args) => (
    <ModelProfilePage
      key={`${args.modelId}:${args.initialRunId}:${args.includeSynthetic}`}
      {...args}
    />
  ),
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
    modelId: "muse-spark",
  },
};

export const ClaudeFable: Story = {
  args: {
    modelId: "claude-fable",
  },
};

export const ClaudeOpus: Story = {
  args: {
    modelId: "claude-opus",
  },
};

/** Run detail expanded on the measured Perps run. */
export const RunDetailExpanded: Story = {
  args: {
    modelId: "gpt-sol",
    initialRunId: "sol-perps-1",
  },
};

/** Run detail expanded on the corrected Spot publication (revision 2). */
export const SpotCorrectionExpanded: Story = {
  args: {
    modelId: "gpt-sol",
    initialRunId: "sol-spot-1",
  },
};

/** Synthetic withdrawn run (sol-spot-withdrawn) visible in run history. */
export const WithdrawnHistory: Story = {
  args: {
    modelId: "gpt-sol",
    includeSynthetic: true,
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
