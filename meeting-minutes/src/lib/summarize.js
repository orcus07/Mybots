import Anthropic from "@anthropic-ai/sdk";

const MODEL      = "claude-opus-4-8";
const FAST_MODEL = "claude-haiku-4-5-20251001";

// SDK 내부 node-fetch 대신 native fetch 주입 (Render에서 node-fetch의 Premature close 문제 우회)
let _anthropic;
function client() {
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았습니다.");
  return (_anthropic ??= new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    fetch: (url, init) => fetch(url, init),
  }));
}

// ── Step 1: 맥락 배경 리서치 (Haiku로 빠르게) ──────────────────────────────

const RESEARCH_SYSTEM = `당신은 비즈니스 리서치 전문가입니다.
주어진 회의 맥락에 대한 배경 지식을 한국어로 간결하게 정리해주세요.

포함 사항:
- 관련 기업/기관 소개 (업종, 주요 사업, 규모)
- 양측의 관계 및 이번 미팅의 예상 목적
- 업계 핵심 용어·약어 (전문 표기법 포함)
- 회의에서 다룰 가능성이 높은 주제

형식: 간결한 불릿 정리. 불확실한 내용은 "(추정)" 표시.`;

async function researchContext(context) {
  const msg = await client().messages.create({
    model: FAST_MODEL,
    max_tokens: 800,
    system: RESEARCH_SYSTEM,
    messages: [{ role: "user", content: `회의 맥락: ${context}` }],
  });
  return msg.content[0]?.text || "";
}

// ── Step 2: 회의록 작성 (Opus로 품질 높게) ─────────────────────────────────

const TOOL = {
  name: "write_meeting_notes",
  description: "받아쓰기 원문을 한국어 회의록으로 정리한다",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "핵심 포인트를 불릿으로 정리한 주요 내용 (한국어, 마크다운)",
      },
      detailedNotes: {
        type: "string",
        description: "논의 흐름·결정사항·후속조치를 갖춘 상세 회의록 전문 (한국어, 마크다운)",
      },
    },
    required: ["summary", "detailedNotes"],
    additionalProperties: false,
  },
};

const SYSTEM = `너는 한국어 회의록 작성 전문가다.
받아쓰기 원문을 바탕으로 두 가지를 작성한다.

summary: 핵심 포인트만 불릿으로 압축한 주요 내용
detailedNotes: 논의 흐름, 결정사항, 후속 조치를 담은 상세 회의록

기본 규칙:
- 원문에 없는 내용은 절대 추가하지 않는다
- 제공된 회의 맥락·배경 정보를 활용해 전문 용어·고유명사·약어를 정확히 표기한다
- 모든 출력은 한국어로 작성한다
- 마크다운 형식을 사용한다 (## 제목, - 불릿, **강조**)

자연스러운 우리말 쓰기 원칙:
- 문장은 짧게 쓴다. 한 문장에 한 가지 내용만 담는다.
- 번역투 표현을 쓰지 않는다. '~을 가지고 있다' → '~이 있다', '~에 의해' → 능동형으로 바꾼다. '~에 대한', '~에 대해서'는 가능하면 줄인다.
- '의'를 남발하지 않는다. '팀의 의견의 수렴'이 아니라 '팀 의견 수렴'으로 쓴다.
- '-들'은 꼭 필요할 때만 쓴다. '참석자들이 논의했다' → '참석자가 논의했다'.
- 지시어(그것, 이것, 해당, 동 사항 등)보다 고유명사를 직접 쓴다.
- '~할 것이다', '~인 것이다'를 피하고 '~한다', '~이다'로 단정 짓는다.
- 명사 나열로 끝내지 않는다. '매출 증가 기대' → '매출이 늘어날 것으로 기대한다'.
- 한자어 명사를 겹쳐 쓰는 대신 동사·형용사 어미를 살린다. '검토 예정' → '검토하기로 했다'.
- 어렵고 딱딱한 말보다 쉬운 우리말을 쓴다. '언급을 회피했다' → '말하려 하지 않았다'.
- 주관적 수식어(결코, 매우, 분명히 등)를 절제하고 사실을 있는 그대로 쓴다.`;

/**
 * 받아쓰기 텍스트 → 한국어 주요 내용 + 상세 회의록
 * @param {string} transcript
 * @param {string} [context]   - 사용자가 입력한 회의 맥락
 * @param {(msg: string) => void} [onProgress]
 * @returns {Promise<{summary: string, detailedNotes: string}>}
 */
export async function writeMeetingNotes(transcript, context = "", onProgress) {
  // 맥락이 있으면 배경 리서치 먼저 수행
  let contextBlock = "";
  if (context.trim()) {
    onProgress?.("맥락 분석 중…");
    const background = await researchContext(context);
    contextBlock = `\n\n## 회의 맥락\n${context}\n\n## 배경 정보 (AI 정리)\n${background}\n\n---`;
  }

  onProgress?.("한국어 회의록 작성 중…");

  const userContent = contextBlock
    ? `다음 받아쓰기 원문을 바탕으로 한국어 회의록을 작성해줘.${contextBlock}\n\n## 받아쓰기 원문\n${transcript}`
    : `다음 받아쓰기 원문을 바탕으로 한국어 회의록을 작성해줘.\n\n---\n${transcript}`;

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "write_meeting_notes" },
    messages: [{ role: "user", content: userContent }],
  });

  const block = message.content.find((b) => b.type === "tool_use");
  if (!block) throw new Error("회의록 생성에 실패했습니다.");
  return block.input;
}
