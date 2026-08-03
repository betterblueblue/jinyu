import type { NormalizedRequest, RawCandidate } from "@/domain/types";
import { getStylePrototype } from "@/config/style-prototypes";
import type { CandidateProvider } from "./types";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * StepFun OpenAI-compatible Chat Completions provider.
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

  async generateCandidates(req: NormalizedRequest, attempt: number): Promise<RawCandidate[]> {
    const proto = getStylePrototype(req.stylePrototypeId);
    const system: ChatMessage = {
      role: "system",
      content: [
        "你是中文起名助手。",
        "最终回复的 content 必须是且仅是一个 JSON 对象，不要 markdown，不要解释。",
        'JSON 格式：{"candidates":[{"givenName":"名不含姓","genderLean":"male|female|neutral","phonology":"","glyph":"","meaning":"","origin":"","pitfalls":"","styleFit":""}]}',
        "要求：具体少空话；不编造铁口命理；避免烂大街网红模板（如子轩/梓涵/浩宇等）；",
        "givenName 不要包含姓氏；字数严格符合用户要求。",
        "若你需要思考，思考过程不要占用最终 content；content 只放 JSON。",
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
          attempt,
          count: req.gender === "unknown" ? 8 : 6,
          instruction:
            "请生成多个候选「名」（不含姓）。若有辈分字必须按位置包含。不要使用避讳字。最终只输出 JSON。",
        },
        null,
        0,
      ),
    };

    const url = `${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model: this.opts.model,
        messages: [system, user],
        temperature: 0.8,
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices?: {
        message?: {
          content?: string;
          reasoning?: string;
          reasoning_content?: string;
        };
      }[];
    };
    const message = data.choices?.[0]?.message;
    const content = (message?.content ?? "").trim();
    const reasoning = (message?.reasoning ?? message?.reasoning_content ?? "").trim();

    let list = parseCandidates(content);
    if (!list.length && reasoning) {
      list = parseCandidates(reasoning);
    }
    if (!list.length && reasoning) {
      list = extractNamesFromReasoning(reasoning, len);
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
        phonology: c.phonology,
        glyph: c.glyph,
        meaning: c.meaning,
        origin: c.origin,
        pitfalls: c.pitfalls,
        styleFit: c.styleFit,
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

/** Fallback when model only writes Chinese reasoning with quoted names */
function extractNamesFromReasoning(reasoning: string, nameLen: number): RawCandidate[] {
  const re = /[「“"]([一-鿿]{1,2})[」”"]/g;
  const seen = new Set<string>();
  const out: RawCandidate[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(reasoning)) !== null) {
    const given = m[1]!;
    if ([...given].length !== nameLen) continue;
    if (seen.has(given)) continue;
    // skip common non-name phrases
    if (["左右", "结构", "平仄", "多音", "阳平", "上声", "去声", "阴平"].includes(given)) continue;
    seen.add(given);
    out.push({
      givenName: given,
      genderLean: "neutral",
      meaning: "（由模型思考过程抽取的候选，释义待补）",
      phonology: "",
      glyph: "",
      origin: "",
      pitfalls: "模型未输出完整 JSON，字段为降级抽取。",
      styleFit: "",
    });
    if (out.length >= 8) break;
  }
  return out;
}
