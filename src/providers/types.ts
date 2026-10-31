import type { NormalizedRequest, RawCandidate } from "@/domain/types";

export interface CandidateGenerationOptions {
  /** 直播台未知性别：只出明确的男向/女向候选，最终各精选 3 个 */
  liveUnknownSix?: boolean;
  /** 能做原文核验的书目（诗经、楚辞……）。提示词要求出处只从这里面找，核不过的出处会被丢掉 */
  catalog?: string[];
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
