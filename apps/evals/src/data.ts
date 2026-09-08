// Illustrative design fixtures. These are not measured benchmark results.
export const families = ["Portfolio", "Spot", "Perps", "Predictions"] as const;
export type TaskFamily = (typeof families)[number];
export type FamilyFilter = "All tasks" | TaskFamily;
export type PageId = "leaderboard" | "models" | "tasks" | "methodology";

export interface FamilyResult {
  passRate: number;
  accuracy: number;
  failures: number;
}

export interface EvalModel {
  id: string;
  name: string;
  provider: string;
  mark: string;
  color: string;
  passRate: number;
  accuracy: number;
  uncertainty: number;
  latency: number;
  cost: number;
  families: Record<TaskFamily, FamilyResult>;
}

export const dataset = {
  version: "v0.3",
  label: "Dataset v0.3 (Sep 2026)",
  harness: "gina-evals v1.2.0",
  runDate: "Sep 3, 2026",
  tasksPerFamily: 256,
  repetitions: 3,
  tasks: 1024,
  disclaimer: "Illustrative data. Not a measured benchmark.",
} as const;

export const models: readonly EvalModel[] = [
  {
    id: "kimi-k3",
    name: "Kimi K3",
    provider: "Moonshot",
    mark: "K",
    color: "#171717",
    passRate: 78,
    accuracy: 83,
    uncertainty: 3,
    latency: 4.2,
    cost: 0.012,
    families: {
      Portfolio: { passRate: 82, accuracy: 88, failures: 46 },
      Spot: { passRate: 80, accuracy: 85, failures: 51 },
      Perps: { passRate: 77, accuracy: 82, failures: 59 },
      Predictions: { passRate: 73, accuracy: 77, failures: 69 },
    },
  },
  {
    id: "claude-4",
    name: "Claude 4",
    provider: "Anthropic",
    mark: "✳",
    color: "#b77d64",
    passRate: 72,
    accuracy: 79,
    uncertainty: 4,
    latency: 6.8,
    cost: 0.018,
    families: {
      Portfolio: { passRate: 78, accuracy: 84, failures: 56 },
      Spot: { passRate: 74, accuracy: 81, failures: 67 },
      Perps: { passRate: 70, accuracy: 78, failures: 77 },
      Predictions: { passRate: 66, accuracy: 73, failures: 87 },
    },
  },
  {
    id: "gpt-5",
    name: "GPT-5",
    provider: "OpenAI",
    mark: "◎",
    color: "#52826f",
    passRate: 68,
    accuracy: 76,
    uncertainty: 4,
    latency: 5.1,
    cost: 0.015,
    families: {
      Portfolio: { passRate: 74, accuracy: 83, failures: 67 },
      Spot: { passRate: 70, accuracy: 79, failures: 77 },
      Perps: { passRate: 66, accuracy: 74, failures: 87 },
      Predictions: { passRate: 62, accuracy: 68, failures: 97 },
    },
  },
  {
    id: "gemini-2-5",
    name: "Gemini 2.5",
    provider: "Google",
    mark: "G",
    color: "#4285d4",
    passRate: 61,
    accuracy: 69,
    uncertainty: 5,
    latency: 4.8,
    cost: 0.011,
    families: {
      Portfolio: { passRate: 68, accuracy: 77, failures: 82 },
      Spot: { passRate: 64, accuracy: 73, failures: 92 },
      Perps: { passRate: 58, accuracy: 65, failures: 108 },
      Predictions: { passRate: 54, accuracy: 61, failures: 118 },
    },
  },
  {
    id: "deepseek-r1",
    name: "DeepSeek R1",
    provider: "DeepSeek",
    mark: "≈",
    color: "#5269d7",
    passRate: 56,
    accuracy: 63,
    uncertainty: 5,
    latency: 5.9,
    cost: 0.009,
    families: {
      Portfolio: { passRate: 62, accuracy: 70, failures: 97 },
      Spot: { passRate: 58, accuracy: 65, failures: 108 },
      Perps: { passRate: 54, accuracy: 61, failures: 118 },
      Predictions: { passRate: 50, accuracy: 56, failures: 128 },
    },
  },
  {
    id: "llama-3-1",
    name: "Llama 3.1",
    provider: "Meta",
    mark: "∞",
    color: "#2675c8",
    passRate: 48,
    accuracy: 55,
    uncertainty: 6,
    latency: 7.4,
    cost: 0.008,
    families: {
      Portfolio: { passRate: 54, accuracy: 62, failures: 118 },
      Spot: { passRate: 50, accuracy: 57, failures: 128 },
      Perps: { passRate: 46, accuracy: 53, failures: 138 },
      Predictions: { passRate: 42, accuracy: 48, failures: 148 },
    },
  },
];

export const featuredModel = models[0]!;

export function getModel(id: string): EvalModel | undefined {
  return models.find((model) => model.id === id);
}

export function familyMetrics(model: EvalModel, family: FamilyFilter) {
  return family === "All tasks" ? model : model.families[family];
}
