import type { Meta, StoryObj } from "@storybook/react-vite";
import { ModelIndexPage } from "./model-index";

const meta = {
  title: "Evals/Model index",
  component: ModelIndexPage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ModelIndexPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
