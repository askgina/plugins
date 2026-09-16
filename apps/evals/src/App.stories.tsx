import type { Meta, StoryObj } from "@storybook/react-vite";
import App from "./App";

const meta = {
  title: "Evals/Public pages",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const RoutedApp: Story = {
  render: () => {
    window.location.hash = "#/leaderboard";
    return <App key="/leaderboard" />;
  },
};

export const NotFound: Story = {
  render: () => {
    window.location.hash = "#/no-such-page";
    return <App key="/no-such-page" />;
  },
};
