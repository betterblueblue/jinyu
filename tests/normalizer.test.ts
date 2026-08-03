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
});
