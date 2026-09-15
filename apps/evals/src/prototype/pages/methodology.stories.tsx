import type { Meta, StoryObj } from "@storybook/react-vite";
import { PrototypeMethodologyPage } from "./methodology";
import "../../styles/evals.css";

const meta = {
  title: "Evals/Prototype/Methodology",
  component: PrototypeMethodologyPage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof PrototypeMethodologyPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Mobile: Story = {
  globals: {
    viewport: { value: "mobile", isRotated: false },
  },
};
