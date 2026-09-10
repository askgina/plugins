import type { Meta, StoryObj } from "@storybook/react-vite";
import { ModelProfilePage } from "./model-profile";
import {
  aggregateOnlyCatalog,
  incompleteCoverageCatalog,
  verifiedSyntheticCatalog,
} from "../stories/public-comparison-fixtures";

const meta = {
  title: "Evals/Model profile",
  component: ModelProfilePage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ModelProfilePage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const CurrentPublication: Story = {
  args: {
    modelId: "synthetic-candidate-a",
    catalog: verifiedSyntheticCatalog,
  },
};

export const AggregateOnly: Story = {
  args: {
    modelId: "synthetic-candidate-a",
    catalog: aggregateOnlyCatalog,
  },
};

export const IncompleteCoverage: Story = {
  args: {
    modelId: "synthetic-candidate-a",
    catalog: incompleteCoverageCatalog,
  },
};

export const CandidateNotFound: Story = {
  args: {
    modelId: "missing-candidate",
    catalog: verifiedSyntheticCatalog,
  },
};

export const Mobile: Story = {
  args: {
    modelId: "synthetic-candidate-a",
    catalog: verifiedSyntheticCatalog,
  },
  globals: { viewport: { value: "mobile", isRotated: false } },
};
