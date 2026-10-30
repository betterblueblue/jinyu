import { FakeProvider } from "./fake-provider";
import { StepFunProvider } from "./stepfun-provider";
import { FakeAnalysisProvider, LlmAnalysisProvider, type AnalysisProvider } from "./analysis-provider";
import type { CandidateProvider } from "./types";

export type { CandidateProvider } from "./types";
export type { AnalysisProvider } from "./analysis-provider";
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

/** 名字分析走同一个网关，只是提示词与输出形状不同 */
export function createAnalysisProvider(): AnalysisProvider {
  if (useFakeProvider()) {
    return new FakeAnalysisProvider();
  }

  const baseUrl = process.env.LLM_BASE_URL ?? "http://127.0.0.1:3425/v1";
  const apiKey = process.env.LLM_API_KEY!;
  const model = process.env.LLM_MODEL ?? "opendesign/deepseek-v4.1-flash";
  return new LlmAnalysisProvider({ baseUrl, apiKey, model, temperature: 0.6, reasoningEffort: "high" });
}
