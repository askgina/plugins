import type { Meta, StoryObj } from "@storybook/react-vite";
import { ModelProfilePage } from "./model-profile";

const meta = {
  title: "Evals/Illustrative UI/Model profile",
  component: ModelProfilePage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Restored origin/main illustrative design using synthetic scores, not measured evaluation results.",
      },
    },
  },
  render: (args) => <ModelProfilePage key={`${args.modelId}:${args.initialCompareId}`} {...args} />,
} satisfies Meta<typeof ModelProfilePage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Kimi: Story = {
  args: {
    modelId: "kimi-k3",
  },
};

export const Claude: Story = {
  args: {
    modelId: "claude-4",
  },
};

export const ComparisonOpen: Story = {
  args: {
    modelId: "kimi-k3",
    initialCompareId: "gpt-5",
  },
};

export const Mobile: Story = {
  args: {
    modelId: "kimi-k3",
  },
  globals: { viewport: { value: "mobile", isRotated: false } },
};
