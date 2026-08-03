import { describe, expect, it } from "vitest";
import { applyHardGate } from "@/domain/gate";
import type { NormalizedRequest, RawCandidate } from "@/domain/types";

const baseReq: NormalizedRequest = {
  surname: "王",
  gender: "male",
  birthStatus: "born",
  nameLength: "two",
  baziEnabled: false,
  generationPosition: "first",
  tabooChars: [],
  stylePrototypeId: "default_dignified",
  avoidPopular: true,
  isPreparationName: false,
};

describe("applyHardGate", () => {
  it("drops L1 templates", () => {
    const raw: RawCandidate[] = [
      { givenName: "子轩" },
      { givenName: "清远" },
    ];
    const r = applyHardGate(raw, baseReq);
    expect(r.passed.map((p) => p.givenName)).toEqual(["清远"]);
    expect(r.eliminated.some((e) => e.givenName === "子轩")).toBe(true);
  });

  it("drops taboo and missing generation", () => {
    const req = {
      ...baseReq,
      generationChar: "承",
      generationPosition: "first" as const,
      tabooChars: ["明"],
    };
    const raw: RawCandidate[] = [
      { givenName: "承远" },
      { givenName: "明远" },
      { givenName: "清和" },
    ];
    const r = applyHardGate(raw, req);
    expect(r.passed.map((p) => p.givenName)).toEqual(["承远"]);
  });

  it("enforces name length", () => {
    const raw: RawCandidate[] = [{ givenName: "远" }, { givenName: "清远" }];
    const r = applyHardGate(raw, baseReq);
    expect(r.passed.map((p) => p.givenName)).toEqual(["清远"]);
  });

  it("marks L2 hot but does not hard drop", () => {
    const r = applyHardGate([{ givenName: "梓清" }], baseReq);
    expect(r.passed[0]?.l2Hot).toBe(true);
  });
});
