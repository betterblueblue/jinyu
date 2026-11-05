"use client";

import { useEffect, useRef, useState } from "react";
import { Gift } from "./gift";
import { SCORE_TABLE_ROWS } from "./score-table";
import "./analyze.css";

/**
 * 名字打分表：直播台上观众看到的那一层（2026-11-05 改成主播手填，用户定）。
 *
 * 原来系统打完分直接上屏，观众觉得主播是照着系统念，主播的价值感出不来。
 * 现在打分、分析、改字都在提词页「打分」页签（prompter/score-desk.tsx），观众看不到；
 * 这里只剩三列格子：名字 | 分数（红字） | 点评，主播看着提词页自己打字。
 * 格子里回车跳下一格，第三列回车跳下一行第一格。不存，刷新页面就清空；关掉面板再打开内容还在。
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

const COLS = 3;
const CELLS = SCORE_TABLE_ROWS * COLS;
const COL_LABEL = ["名字", "分数", "点评"];

export function AnalyzePanel({ open, onClose }: Props) {
  const [values, setValues] = useState<string[]>(() => Array<string>(CELLS).fill(""));
  const [confirmClear, setConfirmClear] = useState(false);
  const cells = useRef<(HTMLInputElement | null)[]>([]);

  // 打开时光标放到第一个空格子
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const empty = cells.current.find((el) => el && !el.value) ?? cells.current[0];
      empty?.focus();
    });
  }, [open]);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  if (!open) return null;

  const hasAny = values.some((v) => v.trim());

  return (
    <section className="ap" role="dialog" aria-label="名字打分表">
      <header className="ap-top">
        <div className="ap-title">
          <span className="ap-name">名字打分</span>
          <span className="ap-sub">
            <span>瑾瑜综合分 · 音律、字义、气质、识读、</span>
            <span>流行、谐音、国学、字形</span>
          </span>
        </div>
        <div className="ap-top-actions">
          {hasAny && (
            <button
              type="button"
              className="ap-close"
              onClick={() => {
                if (!confirmClear) {
                  setConfirmClear(true);
                  return;
                }
                setValues(Array<string>(CELLS).fill(""));
                setConfirmClear(false);
                cells.current[0]?.focus();
              }}
            >
              {confirmClear ? "再点一次清空" : "清空表格"}
            </button>
          )}
          <button type="button" className="ap-close" onClick={onClose} aria-label="关闭">
            关闭
          </button>
        </div>
      </header>

      {/* 礼物引导：放在标题和表格之间，一直看得见（11-05 用户定） */}
      <div className="ap-offer">
        <p>
          点关注+送<Gift name="灯牌" />分析名字
        </p>
        <p>
          送<Gift name="墨镜" />可插队分析
        </p>
        <p>
          送<Gift name="比心兔兔" />起三个名字
        </p>
        <p>定制起名私信 666</p>
      </div>

      <div className="ap-table" role="grid" style={{ gridTemplateRows: `repeat(${SCORE_TABLE_ROWS}, minmax(0, 1fr))` }}>
        {Array.from({ length: SCORE_TABLE_ROWS }, (_, r) => (
          <div className="ap-trow" role="row" key={r}>
            {Array.from({ length: COLS }, (_, c) => {
              const i = r * COLS + c;
              return (
                <input
                  key={c}
                  ref={(el) => {
                    cells.current[i] = el;
                  }}
                  className={`ap-cell c${c + 1}`}
                  value={values[i]}
                  onChange={(e) => {
                    const v = e.target.value;
                    setValues((all) => all.map((x, j) => (j === i ? v : x)));
                  }}
                  onKeyDown={(e) => {
                    // 输入法选字时回车归输入法
                    if (e.nativeEvent.isComposing || e.key === "Process") return;
                    if (e.key === "Enter") {
                      e.preventDefault();
                      cells.current[(i + 1) % CELLS]?.focus();
                    }
                  }}
                  autoComplete="off"
                  aria-label={`第 ${r + 1} 行${COL_LABEL[c]}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
