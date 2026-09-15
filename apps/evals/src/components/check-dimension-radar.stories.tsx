import type { Meta, StoryObj } from "@storybook/react-vite";
import { canonicalRuns } from "../canonical/canonical";
import { getModel } from "../canonical/selectors";
import { CheckDimensionPanel } from "./check-dimension-radar";

const measuredAvailable = canonicalRuns.filter(
  (run) => run.origin === "measured" && run.dimensions.availability === "available",
);

const firstMeasured = measuredAvailable[0];
const gpt55Spot = canonicalRuns.find((run) => run.runId === "gpt55-spot-1");
const fableSpot = canonicalRuns.find((run) => run.runId === "fable-spot-1");

const meta = {
  title: "Evals/Check dimensions",
  component: CheckDimensionPanel,
} satisfies Meta<typeof CheckDimensionPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Single: Story = {
  args: {
    fill: true,
    series:
      firstMeasured === undefined
        ? []
        : [
            {
              key: "run",
              label: firstMeasured.runId,
              dimensions: firstMeasured.dimensions,
            },
          ],
  },
};

export const Compare: Story = {
  args: {
    fill: false,
    series:
      gpt55Spot !== undefined && fableSpot !== undefined
        ? [
            {
              key: "left",
              label: getModel(gpt55Spot.modelId)?.name ?? gpt55Spot.modelId,
              dimensions: gpt55Spot.dimensions,
            },
            {
              key: "right",
              label: getModel(fableSpot.modelId)?.name ?? fableSpot.modelId,
              dimensions: fableSpot.dimensions,
            },
          ]
        : firstMeasured === undefined
          ? []
          : [
              {
                key: "run",
                label: firstMeasured.runId,
                dimensions: firstMeasured.dimensions,
              },
            ],
  },
};
