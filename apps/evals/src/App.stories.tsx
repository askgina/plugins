import type { Meta, StoryObj } from "@storybook/react-vite";
import App, { MethodologyPage } from "./App";
import { syntheticFieldCatalog } from "./stories/public-comparison-fixtures";

const meta = {
  title: "Evals/Public pages",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const RoutedApp: Story = {
  render: () => <App catalog={syntheticFieldCatalog} />,
};

export const Methodology: Story = {
  render: () => <MethodologyPage />,
};
