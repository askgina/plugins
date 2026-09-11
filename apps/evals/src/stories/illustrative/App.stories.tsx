import type { Meta, StoryObj } from "@storybook/react-vite";
import App, { MethodologyPage } from "./App";

const meta = {
  title: "Evals/Illustrative UI/Public pages",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Original origin/main UI restored beside the public-results stories. Scores, costs, and uncertainty are synthetic design fixtures, not measured evaluation results.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const RoutedApp: Story = {
  render: () => <App />,
};

export const Methodology: Story = {
  render: () => <MethodologyPage />,
};
