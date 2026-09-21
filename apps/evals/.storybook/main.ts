import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-docs"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  staticDirs: ["../public"],
  // Storybook copies staticDirs itself. Vite must not race it for the same files.
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    build: { ...viteConfig.build, copyPublicDir: false },
  }),
};

export default config;
