import type { NormalizedRequest, RawCandidate } from "@/domain/types";

export interface CandidateProvider {
  readonly name: string;
  generateCandidates(
    req: NormalizedRequest,
    attempt: number,
    onThinking?: (chunk: string) => void,
  ): Promise<RawCandidate[]>;
}
