import { createSeededRng, type SeededRng } from "./seededRng.js";

export type StepContext = {
  rng: SeededRng;
  stepIndex: number;
};

export type StepAction = (ctx: StepContext) => Promise<void> | void;

export async function runSeededSteps(seed: number, steps: StepAction[]): Promise<void> {
  const rng = createSeededRng(seed);

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    await steps[stepIndex]({ rng, stepIndex });
  }
}
