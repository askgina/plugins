import type { Meta, StoryObj } from "@storybook/react-vite";
import { MethodologyPage } from "./methodology";

const meta = {
  title: "Evals/Methodology",
  component: MethodologyPage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof MethodologyPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
