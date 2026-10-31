import type { NormalizedRequest, RawCandidate } from "@/domain/types";
import { buildBaziSummary } from "@/domain/bazi";
import { extractJson, streamChat, type ChatMessage, type ChatClientOptions } from "./chat";
import type { CandidateGenerationOptions, CandidateProvider } from "./types";

/** 首轮预算：推理模型推理 token 计入 max_tokens，短思考 prompt 下 8192 足够装下 JSON */
const DEFAULT_MAX_TOKENS = 8192;
/** 截断/解析失败时的重试预算 */
const RETRY_MAX_TOKENS = 16384;

/**
 * OpenAI 兼容 Chat Completions provider（流式）。
 * 当前接本机网关（`opendesign/deepseek-v4.1-flash`），也可换回 StepFun 等同类网关。
 *
 * 推理模型说明：模型会先产生一段隐藏推理（计入 max_tokens 预算但不返回在 content 里），
 * 因此使用 response_format=json_object + 短思考 prompt 压低推理长度，保证最终 JSON 有足够预算。
 */
export class StepFunProvider implements CandidateProvider {
  readonly name = process.env.LLM_PROVIDER?.trim() || "stepfun";

  private readonly client: ChatClientOptions;

  constructor(
    private readonly opts: {
      baseUrl: string;
      apiKey: string;
      model: string;
    },
  ) {
    this.client = { ...opts, temperature: 0.5, reasoningEffort: "xhigh" };
  }

  async generateCandidates(
    req: NormalizedRequest,
    attempt: number,
    onThinking?: (chunk: string) => void,
    options?: CandidateGenerationOptions,
  ): Promise<RawCandidate[]> {
    const liveUnknownSix = Boolean(options?.liveUnknownSix && req.gender === "unknown");
    // 四柱先算好再交给模型：模型只解释，不自己推干支
    const bazi = req.baziEnabled ? buildBaziSummary(req) : null;
    const baziSummary = bazi && bazi.ok ? bazi.summary : null;
    const baziPillars = baziSummary?.pillarsText;
    const baziUncertain = Boolean(baziSummary?.notes.some((n) => n.includes("可能为")));
    const candidateFields = [
      '"givenName":"名不含姓"',
      liveUnknownSix ? '"genderLean":"male|female"' : '"genderLean":"male|female|neutral"',
      '"pinyin":"标准拼音，含声调，如 shū yǎo"',
      '"phonology":""',
      '"glyph":""',
      '"meaning":"这个名整体是什么意思，具体到字，不写空话"',
      '"composition":"这两个字各自什么意思、合起来为什么成立，一两句"',
      '"citation":{"source":"书名，仅限给定书目","piece":"篇名，如 周南·桃夭","quote":"原文连续片段，至少五字，一字不差","gloss":"一句话说这个名怎么用这句，20 字内"}',
      '"pitfalls":""',
    ];
    if (req.baziEnabled) {
      candidateFields.push('"baziFit":"与生辰气质的呼应（一两句，温和不作定论）"');
    }
    const jsonFormatLine = `JSON 格式：{"candidates":[{${candidateFields.join(",")}}]}`;
    const system: ChatMessage = {
      role: "system",
      content: [
        "你是中文起名助手。",
        "最终回复的 content 必须是且仅是一个 JSON 对象（response_format 为 json_object），不要 markdown、解释或前后缀。",
        "请简短思考，优先完成最终 JSON；思考过程不要出现在 content 里。",
        "优先使用现代常用汉字，避免生僻字、多音字和笔画过多的字；避免烂大街网红模板（如子轩/梓涵/浩宇等）。",
        "候选之间避免重复用字与高度相似的意象；不要多个候选共用同一高频字，确保每个候选用字有区分度。",
        jsonFormatLine,
        "givenName 不要包含姓氏；字数严格符合用户要求。",
      ].join(""),
    };

    const len = req.nameLength === "one" ? 1 : 2;
    const user: ChatMessage = {
      role: "user",
      content: JSON.stringify(
        {
          surname: req.surname,
          gender: req.gender,
          nameLength: len,
          generationChar: req.generationChar,
          generationPosition: req.generationPosition,
          tabooChars: req.tabooChars,
          ...(req.requirements ? { requirements: req.requirements } : {}),
          avoidPopular: req.avoidPopular,
          birthStatus: req.birthStatus,
          ...(req.baziEnabled
            ? {
                baziEnabled: true,
                birthDate: req.birthDate,
                birthHour: req.birthHour || undefined,
                baziPillars,
                baziPrecision: baziSummary?.precision,
                ...(baziUncertain
                  ? { baziUncertain: true, baziPillarOptions: baziSummary?.pillarOptions }
                  : {}),
              }
            : {}),
          attempt,
          // 指令里说「source 只用给定的 catalog」，书目必须真的给到
          ...(options?.catalog?.length ? { catalog: options.catalog } : {}),
          count: liveUnknownSix ? 12 : req.gender === "unknown" ? 8 : 6,
          instruction:
            "请生成多个候选「名」（不含姓）。若有辈分字必须按位置包含。不要使用避讳字。citation 必须是具体古典书目的原文：quote 一字不差，source 只用给定的 catalog。没有可靠出处就不要编，也不要写「现代常用字组合」「成词义」这类说法——系统会拿原文逐字核对，核不过整条丢掉。最终只输出 JSON。" +
            (liveUnknownSix
              ? "性别未知（直播男女分组）：生成 12 个候选，男向 6 个、女向 6 个，供服务端各精选 3 个。genderLean 只能填 male 或 female，禁止 neutral，不要生成中性名；两组名字不得重复，每个名字都要有明确的男向或女向气质。"
              : req.gender === "unknown"
                ? "性别未知：8 个候选里要有明确的男向、女向、中性三类，genderLean 分别填 male/female/neutral，不要全部填 neutral——至少各有 1~2 个明确的男向与女向名字，方便用户按实际性别收窄。"
                : "") +
            (req.baziEnabled
              ? "每个候选的 JSON 对象必须包含 baziFit 字段：用普通人听得懂的话说这个名字和出生季节/气候合不合（例如「生在夏天，名字取清润的字压一压」），不许出现天干地支、日柱月柱、五行用神这类词——baziPillars 只供你自己参考，不要抄进句子里；baziPillars 缺失时只作季节层面的温和提醒。若 baziUncertain 为 true，说明出生时刻不确定，句子必须留有余地，不给单一结论。生辰仅作温和参考，不作铁口定论。"
              : ""),
        },
        null,
        0,
      ),
    };

    const messages: ChatMessage[] = [system, user];

    // 首轮：短思考 + 常规预算
    let { content, finishReason } = await streamChat(this.client, {
      messages,
      maxTokens: DEFAULT_MAX_TOKENS,
      onThinking,
    });
    let list = parseCandidates(content);

    // 截断或解析 0 候选 → 用更大预算重试一次（仍转发推理增量）
    if (finishReason === "length" || list.length === 0) {
      const retry = await streamChat(this.client, {
        messages,
        maxTokens: RETRY_MAX_TOKENS,
        onThinking,
      });
      const retryList = parseCandidates(retry.content);
      if (retryList.length > 0) {
        content = retry.content;
        list = retryList;
      }
    }

    // 兜底：开启八字时若模型漏了 baziFit，用已经算好的结果补上
    // 措辞只留「属相 + 出生季节」，不出现干支；柱子不确定时明说不确定
    if (req.baziEnabled && list.length > 0 && baziPillars) {
      const readable = baziSummary?.readable;
      const who = readable?.zodiac ? `属${readable.zodiac}，` : "";
      const when = readable?.season ? `生在${readable.season}` : "生辰已按公历生日计算";
      const fallback = baziSummary?.pillarOptions
        ? `${who}${when}，但出生时刻不确定，岁节可能落在前后两侧，名字与季节的呼应等精确时间再定，不作铁口定论。`
        : `${who}${when}，名字取与之相合的字更稳，可结合家庭偏好参考；不作铁口定论。`;
      for (const c of list) {
        if (!c.baziFit) {
          c.baziFit = fallback;
        }
      }
    }

    return list;
  }

}

function parseCandidates(content: string): RawCandidate[] {
  const jsonText = extractJson(content);
  if (!jsonText) return [];
  try {
    const parsed = JSON.parse(jsonText) as {
      candidates?: RawCandidate[];
      names?: RawCandidate[];
    };
    const list = parsed.candidates ?? parsed.names ?? [];
    return list
      .filter((c) => c && typeof c.givenName === "string")
      .map((c) => ({
        givenName: String(c.givenName).trim(),
        genderLean: c.genderLean,
        pinyin: c.pinyin,
        phonology: c.phonology,
        glyph: c.glyph,
        meaning: c.meaning,
        composition: c.composition,
        citation: c.citation,
        pitfalls: c.pitfalls,
        baziFit: c.baziFit,
      }));
  } catch {
    return [];
  }
}