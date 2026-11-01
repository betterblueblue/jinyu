import { useEffect } from "react";
import type { Gender, Phase } from "./show-data";

/**
 * 直播台快捷键：A 打开名字打分、S 换肤、Esc 关面板；
 * 揭晓态空格或回车回到输入，输入态空格开始取名；1、2 选男、女（起名没有「未知」）。
 * 输入框里的 1、2 和回车由输入框自己处理，这里不管。
 */
export function useLiveKeys(o: {
  phase: Phase;
  analyzeOpen: boolean;
  setAnalyzeOpen: (open: boolean) => void;
  cycleSkin: () => void;
  resetToInput: () => void;
  generate: () => unknown;
  setGender: (g: Gender) => void;
}): void {
  const { phase, analyzeOpen, setAnalyzeOpen, cycleSkin, resetToInput, generate, setGender } = o;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (analyzeOpen) {
          setAnalyzeOpen(false);
          return;
        }
        return;
      }
      // 分析面板开着的时候不吃其它快捷键，免得在输入框外按空格就把取名触发了
      if (analyzeOpen) return;
      if (e.key === "a" || e.key === "A") {
        setAnalyzeOpen(true);
        return;
      }
      if (e.key === "s" || e.key === "S") {
        cycleSkin();
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      // 揭晓态：空格/回车回输入；输入态：空格开始取名
      if (phase === "reveal" && (e.code === "Space" || e.key === "Enter")) {
        e.preventDefault();
        resetToInput();
        return;
      }
      if (phase === "input" && e.code === "Space") {
        e.preventDefault();
        void generate();
        return;
      }
      if (e.key === "1") setGender("male");
      if (e.key === "2") setGender("female");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, resetToInput, generate, cycleSkin, analyzeOpen, setAnalyzeOpen, setGender]);
}
