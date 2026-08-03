import { describe, expect, it } from "vitest";
import { normalizeRequest } from "@/domain/normalizer";

describe("normalizeRequest", () => {
  it("requires surname and gender", () => {
    const r = normalizeRequest({ surname: "", gender: "male" });
    expect(r.ok).toBe(false);
  });

  it("rejects bazi without birth date", () => {
    const r = normalizeRequest({
      surname: "王",
      gender: "male",
      baziEnabled: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/公历生日/);
  });

  it("rejects bazi when unborn", () => {
    const r = normalizeRequest({
      surname: "王",
      gender: "female",
      birthStatus: "unborn",
      baziEnabled: true,
      birthDate: "2026-01-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/未出生/);
  });

  it("defaults name length two, avoid popular on, and birth status born", () => {
    const r = normalizeRequest({ surname: "李", gender: "unknown" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.nameLength).toBe("two");
      expect(r.value.avoidPopular).toBe(true);
      expect(r.value.stylePrototypeId).toBe("default_dignified");
      expect(r.value.birthStatus).toBe("born");
    }
  });

  it("parses taboo chars", () => {
    const r = normalizeRequest({
      surname: "张",
      gender: "male",
      tabooChars: "明, 强、海",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.tabooChars).toEqual(["明", "强", "海"]);
  });

  it("rejects taboo that contains the generation char (deadlock)", () => {
    const r = normalizeRequest({
      surname: "沈",
      gender: "female",
      generationChar: "书",
      generationPosition: "second",
      tabooChars: "书",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/避讳字不能包含辈分字/);
  });

  it("allows taboo and generation that do not overlap", () => {
    const r = normalizeRequest({
      surname: "沈",
      gender: "female",
      generationChar: "书",
      generationPosition: "second",
      tabooChars: "轩,梓",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.generationChar).toBe("书");
      expect(r.value.tabooChars).toEqual(["轩", "梓"]);
    }
  });
});
