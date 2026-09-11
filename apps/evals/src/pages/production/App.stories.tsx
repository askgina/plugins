import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  productionMultipleCohortsState,
  productionReadyState,
} from "../../stories/production-fixtures";
import { ProductionApp } from "./App";
import { ProductionMethodologyPage } from "./methodology";

const meta = {
  title: "Evals/Production UI/Experience",
  component: ProductionApp,
  args: { catalog: productionReadyState.catalog },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Production-facing evaluation UI using the restored editorial design and public v1 contracts. Story data is synthetic. The existing illustrative and public-results batches remain separate.",
      },
    },
  },
} satisfies Meta<typeof ProductionApp>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullExperience: Story = {};

export const MultipleBenchmarkGroups: Story = {
  args: { catalog: productionMultipleCohortsState.catalog },
};

export const BundledVerifiedSource: Story = {
  args: { catalog: undefined },
  parameters: {
    docs: {
      description: {
        story:
          "Uses the real bundled-publication loader and its index checks, without supplying a story catalog. The bundled source is still synthetic.",
      },
    },
  },
};

export const Methodology: Story = {
  render: (args) => <ProductionMethodologyPage catalog={args.catalog} />,
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
