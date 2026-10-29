import { FakeProvider } from "./fake-provider";
import { StepFunProvider } from "./stepfun-provider";
import type { CandidateProvider } from "./types";

export type { CandidateProvider } from "./types";
export { FakeProvider } from "./fake-provider";
export { StepFunProvider } from "./stepfun-provider";

export function createCandidateProvider(): CandidateProvider {
  const useFake =
    process.env.LLM_USE_FAKE === "true" ||
    process.env.LLM_USE_FAKE === "1" ||
    process.env.NODE_ENV === "test" ||
    !process.env.LLM_API_KEY;

  if (useFake) {
    return new FakeProvider("default");
  }

  const baseUrl = process.env.LLM_BASE_URL ?? "http://127.0.0.1:3425/v1";
  const apiKey = process.env.LLM_API_KEY!;
  const model = process.env.LLM_MODEL ?? "opendesign/deepseek-v4.1-flash";
  return new StepFunProvider({ baseUrl, apiKey, model });
}
