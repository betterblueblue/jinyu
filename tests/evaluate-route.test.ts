import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JINYU_CORPUS_DIR = path.join(process.cwd(), "tests", "fixtures", "score-corpus");

/**
 * 打分接口这一层（2026-11-05）：同一个名字重放、retry 钉住原名分、敏感名字不打分。
 * 假模型每调一次给不同的字义档位，用来看分数是重放的还是重算的。
 */

const spy = vi.hoisted(() => ({ calls: 0, emptyFirst: false }));

vi.mock("@/auth/session", () => ({ isAuthenticated: async () => true }));

vi.mock("@/domain/evaluate", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/domain/evaluate")>();
  const provider: import("@/domain/evaluate").EvaluateProvider = {
    name: "spy",
    async evaluate(facts, onScores, onOriginal, onOption) {
      spy.calls++;
      const raw = await new real.FakeEvaluateProvider().evaluate(facts);
      // 第一次字义给 20，之后给 12：重算的话原名分会掉 8 分
      const scores = { pronunciation: 16, meaning: spy.calls === 1 ? 20 : 12, gender: 12, style: 6 };
      raw.scores = scores;
      // emptyFirst：第一次不写改法，看接口会不会钉住原名分再试一次
      if (spy.emptyFirst && spy.calls === 1) {
        raw.options = [];
        raw.status = "no_better";
      }
      onScores?.(scores);
      if (raw.original) onOriginal?.(raw.original);
      for (const o of (raw.options as unknown[]) ?? []) onOption?.(o as never);
      return raw;
    },
  };
  return { ...real, createEvaluateProvider: () => provider };
});

import { POST } from "../app/api/analyze/evaluate/route";
import { clearEvalCache } from "@/domain/evaluate/cache";
import { resetCharTableCache } from "@/domain/analysis/chars";
import type { EvaluateResult } from "@/domain/evaluate/types";

async function call(body: Record<string, unknown>): Promise<{ status: number; result?: EvaluateResult; message?: string }> {
  const res = await POST(
    new Request("http://localhost/api/analyze/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const json = (await res.json()) as { result?: EvaluateResult; message?: string };
  return { status: res.status, ...json };
}

beforeEach(() => {
  spy.calls = 0;
  spy.emptyFirst = false;
  clearEvalCache();
  resetCharTableCache();
});

describe("打分接口", () => {
  it("同一个名字再报一次：直接重放，不调模型，分数一样", async () => {
    const first = await call({ fullName: "文娟", gender: "female" });
    expect(spy.calls).toBe(1);
    expect(first.result?.cached).toBeUndefined();

    const again = await call({ fullName: "文娟", gender: "female" });
    expect(spy.calls).toBe(1);
    expect(again.result?.cached).toBe(true);
    expect(again.result?.original?.scores.total).toBe(first.result?.original?.scores.total);
  });

  it("性别不同各算各的", async () => {
    await call({ fullName: "文娟", gender: "female" });
    await call({ fullName: "文娟", gender: "male" });
    expect(spy.calls).toBe(2);
  });

  it("retry：会再调一次模型写改法，但原名分按上次的钉住", async () => {
    const first = await call({ fullName: "文娟", gender: "female" });
    const retry = await call({ fullName: "文娟", gender: "female", retry: true });
    expect(spy.calls).toBe(2);
    expect(retry.result?.original?.scores.total).toBe(first.result?.original?.scores.total);
  });

  it("没评过的名字带 retry 也照常评", async () => {
    const out = await call({ fullName: "文娟", gender: "female", retry: true });
    expect(spy.calls).toBe(1);
    expect(out.result?.original).not.toBeNull();
  });

  it("性别没填不记缓存，填了性别再报会调模型", async () => {
    await call({ fullName: "文娟", gender: "unknown" });
    expect(spy.calls).toBe(0);
    await call({ fullName: "文娟", gender: "female" });
    expect(spy.calls).toBe(1);
  });

  it("不到 90 分、第一次一个改法都没有：钉住原名分再试一次，第二次的改法交出去", async () => {
    spy.emptyFirst = true;
    const out = await call({ fullName: "文娟", gender: "female" });
    expect(spy.calls).toBe(2);
    expect(out.result?.original?.scores.total).toBeLessThan(90);
    expect(out.result?.candidates.length).toBeGreaterThan(0);
  });

  it("敏感人物的名字（含同音同调）直接拒，不调模型", async () => {
    for (const fullName of ["习近平", "习进平"]) {
      const out = await call({ fullName, gender: "male" });
      expect(out.status).toBe(400);
      expect(out.message).toBe("这个名字不打分");
    }
    expect(spy.calls).toBe(0);
  });
});
