/// <reference path="../src/vite-env.d.ts" />

import type { Preview } from "@storybook/react-vite";
import { StoryTheme } from "./story-theme";
import "@fontsource/eb-garamond/latin-400.css";
import "@fontsource/eb-garamond/latin-600.css";
import "../src/styles/design-system.css";
import "../src/styles/evals.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    viewport: {
      options: {
        ginaCompact: {
          name: "Gina Compact",
          styles: { width: "360px", height: "640px" },
        },
        mobile: {
          name: "Mobile",
          styles: { width: "375px", height: "667px" },
        },
        mobileLarge: {
          name: "Mobile Large",
          styles: { width: "414px", height: "896px" },
        },
        tablet: {
          name: "Tablet",
          styles: { width: "768px", height: "1024px" },
        },
        desktop: {
          name: "Desktop",
          styles: { width: "1280px", height: "800px" },
        },
        wide: {
          name: "Wide",
          styles: { width: "1440px", height: "900px" },
        },
      },
    },
  },
  globalTypes: {
    theme: {
      description: "Global theme for components",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "light", icon: "sun", title: "Light" },
          { value: "dark", icon: "moon", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "light",
  },
  decorators: [
    (Story, context) => {
      const theme =
        !context.title.startsWith("Evals/") && context.globals.theme === "dark" ? "dark" : "light";
      return (
        <StoryTheme theme={theme}>
          <Story />
        </StoryTheme>
      );
    },
  ],
};

export default preview;
