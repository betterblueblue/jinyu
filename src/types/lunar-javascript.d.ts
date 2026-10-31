declare module "lunar-javascript" {
  export class Solar {
    static fromYmdHms(
      year: number,
      month: number,
      day: number,
      hour: number,
      minute: number,
      second: number,
    ): Solar;
    static fromYmd(year: number, month: number, day: number): Solar;
    getLunar(): Lunar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getHour(): number;
    getMinute(): number;
    /** YYYY-MM-DD HH:mm:ss */
    toYmdHms(): string;
  }

  export class Lunar {
    getEightChar(): EightChar;
    getSolar(): Solar;
    /** 如「一九九〇」 */
    getYearInChinese(): string;
    /** 如「四」「闰四」 */
    getMonthInChinese(): string;
    /** 如「廿一」 */
    getDayInChinese(): string;
    /** 以立春为界的年干支 */
    getYearInGanZhiExact(): string;
    /** 上一个「节」（立春、惊蛰……，月柱的分界） */
    getPrevJie(): JieQi;
    getNextJie(): JieQi;
  }

  export class JieQi {
    getName(): string;
    getSolar(): Solar;
  }

  export class EightChar {
    /** 1 = 晚子时（23 点后）日柱归次日；2 = 归当日 */
    setSect(sect: number): void;
    getYear(): string;
    getMonth(): string;
    getDay(): string;
    getTime(): string;
    getYearWuXing(): string;
    getMonthWuXing(): string;
    getDayWuXing(): string;
    getTimeWuXing(): string;
    /**
     * 大运。gender：1 男 0 女；sect：1 按天数与时辰折算，2 按分钟折算（三天折一年）。
     */
    getYun(gender: number, sect?: number): Yun;
  }

  export class Yun {
    getStartYear(): number;
    getStartMonth(): number;
    getStartDay(): number;
    getStartHour(): number;
    isForward(): boolean;
    getStartSolar(): Solar;
    getDaYun(n?: number): DaYun[];
  }

  export class DaYun {
    /** 0 是起运前（童限），干支为空 */
    getIndex(): number;
    getGanZhi(): string;
    getStartYear(): number;
    getEndYear(): number;
    /** 虚岁 */
    getStartAge(): number;
    getEndAge(): number;
  }

  export const LunarUtil: {
    /** 键为「日干 + 他干」，如「甲乙」→「劫财」 */
    SHI_SHEN: Record<string, string>;
    /** 地支藏干，顺序为本气、中气、余气 */
    ZHI_HIDE_GAN: Record<string, string[]>;
    /** 六十甲子纳音 */
    NAYIN: Record<string, string>;
    /** 旬空，如「甲子」→「戌亥」 */
    getXunKong(ganZhi: string): string;
  };
}
