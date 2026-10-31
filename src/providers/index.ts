import { FakeProvider } from "./fake-provider";
import { StepFunProvider } from "./stepfun-provider";
import { FakeFixProvider, LlmFixProvider, type CharFixProvider } from "./fix-provider";
import type { CandidateProvider } from "./types";

export type { CandidateProvider } from "./types";
export type { CharFixProvider } from "./fix-provider";
export { FakeProvider } from "./fake-provider";
export { StepFunProvider } from "./stepfun-provider";

function useFakeProvider(): boolean {
  return (
    process.env.LLM_USE_FAKE === "true" ||
    process.env.LLM_USE_FAKE === "1" ||
    process.env.NODE_ENV === "test" ||
    !process.env.LLM_API_KEY
  );
}

export function createCandidateProvider(): CandidateProvider {
  if (useFakeProvider()) {
    return new FakeProvider("default");
  }

  const baseUrl = process.env.LLM_BASE_URL ?? "http://127.0.0.1:3425/v1";
  const apiKey = process.env.LLM_API_KEY!;
  const model = process.env.LLM_MODEL ?? "opendesign/deepseek-v4.1-flash";
  return new StepFunProvider({ baseUrl, apiKey, model });
}

/** 打分榜的「改字」：从同音候选里挑字，要快，推理强度固定 low */
export function createFixProvider(): CharFixProvider {
  if (useFakeProvider()) {
    return new FakeFixProvider();
  }

  const baseUrl = process.env.LLM_BASE_URL ?? "http://127.0.0.1:3425/v1";
  const apiKey = process.env.LLM_API_KEY!;
  const model = process.env.LLM_MODEL ?? "opendesign/deepseek-v4.1-flash";
  return new LlmFixProvider({ baseUrl, apiKey, model, temperature: 0.3, reasoningEffort: "low" });
}
