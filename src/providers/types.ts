import type { NormalizedRequest, RawCandidate } from "@/domain/types";

export interface CandidateGenerationOptions {
  /** 直播台未知性别：只出明确的男向/女向候选，最终各精选 3 个 */
  liveUnknownSix?: boolean;
}

export interface CandidateProvider {
  readonly name: string;
  generateCandidates(
    req: NormalizedRequest,
    attempt: number,
    onThinking?: (chunk: string) => void,
    options?: CandidateGenerationOptions,
  ): Promise<RawCandidate[]>;
}
