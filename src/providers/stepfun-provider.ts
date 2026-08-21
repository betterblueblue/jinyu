import type { NormalizedRequest, RawCandidate } from "@/domain/types";
import { getStylePrototype } from "@/config/style-prototypes";
import { buildBaziSummary } from "@/domain/bazi";
import type { CandidateProvider } from "./types";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 首轮预算：推理模型推理 token 计入 max_tokens，短思考 prompt 下 8192 足够装下 JSON */
const DEFAULT_MAX_TOKENS = 8192;
/** 截断/解析失败时的重试预算 */
const RETRY_MAX_TOKENS = 16384;
/** 总超时：xhigh 推理 + 流式下行，240s 内必须出完 */
const TOTAL_TIMEOUT_MS = 240_000;
/** 流内无字节判死：90s 没数据视为卡死 */
const IDLE_TIMEOUT_MS = 90_000;

/**
 * StepFun OpenAI-compatible Chat Completions provider (streaming).
 *
 * 推理模型说明：模型会先产生一段隐藏推理（计入 max_tokens 预算但不返回在 content 里），
 * 因此使用 response_format=json_object + 短思考 prompt 压低推理长度，保证最终 JSON 有足够预算。
 */
export class StepFunProvider implements CandidateProvider {
  readonly name = "stepfun";

  constructor(
    private readonly opts: {
      baseUrl: string;
      apiKey: string;
      model: string;
    },
  ) {}

  async generateCandidates(
    req: NormalizedRequest,
    attempt: number,
    onThinking?: (chunk: string) => void,
  ): Promise<RawCandidate[]> {
    const proto = getStylePrototype(req.stylePrototypeId);
    const candidateFields = [
      '"givenName":"名不含姓"',
      '"genderLean":"male|female|neutral"',
      '"pinyin":"标准拼音，含声调，如 shū yǎo"',
      '"phonology":""',
      '"glyph":""',
      '"meaning":""',
      '"origin":""',
      '"pitfalls":""',
      '"styleFit":""',
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
          style: proto.softPrompt,
          styleNotes: req.styleNotes,
          avoidPopular: req.avoidPopular,
          birthStatus: req.birthStatus,
          ...(req.baziEnabled
            ? {
                baziEnabled: true,
                birthDate: req.birthDate,
                birthHour: req.birthHour || undefined,
              }
            : {}),
          attempt,
          count: req.gender === "unknown" ? 8 : 6,
          instruction:
            "请生成多个候选「名」（不含姓）。若有辈分字必须按位置包含。不要使用避讳字。最终只输出 JSON。" +
            (req.baziEnabled
              ? "每个候选的 JSON 对象必须包含 baziFit 字段，值为该名与生辰五行气质呼应的一两句；缺失则整个输出作废。生辰仅作温和参考，克制表述，不作五行用神铁口定论。"
              : ""),
        },
        null,
        0,
      ),
    };

    const messages: ChatMessage[] = [system, user];

    // 首轮：短思考 + 常规预算
    let { content, finishReason } = await this.streamChat({
      messages,
      maxTokens: DEFAULT_MAX_TOKENS,
      onThinking,
    });
    let list = parseCandidates(content);

    // 截断或解析 0 候选 → 用更大预算重试一次（仍转发推理增量）
    if (finishReason === "length" || list.length === 0) {
      const retry = await this.streamChat({
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

    // 兜底：开启八字时若模型漏了 baziFit，用本地排盘的示意柱补上（克制表述）
    if (req.baziEnabled && list.length > 0) {
      const bazi = buildBaziSummary(req);
      const pillars = bazi.ok && bazi.summary ? bazi.summary.pillarsText : undefined;
      if (pillars) {
        for (const c of list) {
          if (!c.baziFit) {
            c.baziFit = `四柱示意为${pillars}，名字与生辰气质的细致呼应建议结合家庭偏好参考；不作铁口定论。`;
          }
        }
      }
    }

    return list;
  }

  /** 单次流式 Chat Completions 调用，返回最终 content 与 finish_reason。 */
  private async streamChat(args: {
    messages: ChatMessage[];
    maxTokens: number;
    onThinking?: (chunk: string) => void;
  }): Promise<{ content: string; finishReason: string | null }> {
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const controller = new AbortController();
    const totalTimer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const pokeIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    };

    try {
      pokeIdle();
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({
          model: this.opts.model,
          messages: args.messages,
          temperature: 0.5,
          max_tokens: args.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
          response_format: { type: "json_object" },
          reasoning_effort: "xhigh",
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      if (!res.body) {
        throw new Error("LLM 未返回响应体");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      let finishReason: string | null = null;
      const { onThinking } = args;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pokeIdle();
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            let ev: {
              choices?: {
                delta?: { reasoning_content?: string; content?: string };
                finish_reason?: string | null;
              }[];
            };
            try {
              ev = JSON.parse(payload);
            } catch {
              continue;
            }
            const delta = ev.choices?.[0]?.delta;
            if (delta?.reasoning_content) onThinking?.(delta.reasoning_content);
            if (delta?.content) content += delta.content;
            if (ev.choices?.[0]?.finish_reason) {
              finishReason = ev.choices[0].finish_reason;
            }
          }
        }
      }

      return { content: content.trim(), finishReason };
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error("LLM 生成超时，请重试");
      }
      throw err;
    } finally {
      clearTimeout(totalTimer);
      if (idleTimer) clearTimeout(idleTimer);
    }
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
        origin: c.origin,
        pitfalls: c.pitfalls,
        styleFit: c.styleFit,
        baziFit: c.baziFit,
      }));
  } catch {
    return [];
  }
}

function extractJson(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const lastObj = text.lastIndexOf("{");
  if (lastObj >= 0) {
    const end = text.lastIndexOf("}");
    if (end > lastObj) {
      const slice = text.slice(lastObj, end + 1);
      try {
        JSON.parse(slice);
        return slice;
      } catch {
        /* fall through */
      }
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}
