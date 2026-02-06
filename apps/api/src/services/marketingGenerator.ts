/**
 * 마케팅 챗봇 LLM 생성 서비스
 * Gemini 2.0 Flash 사용
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import {
  SearchResult,
  MarketingSafetyGuard,
  MEDICAL_DISCLAIMER,
  FALLBACK_DISCLAIMER,
} from './marketingSafety';

// Gemini 클라이언트
let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    if (!env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
    }
    genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }
  return genAI;
}

// 카테고리 타입
export type MarketingCategoryType = 'cancer' | 'nerve' | 'general';

// 설정
const GENERATION_MODEL = 'gemini-2.0-flash';
const GENERAL_TEMPERATURE = 0.3;
const MEDICAL_TEMPERATURE = 0.2;
const ROUTER_TEMPERATURE = 0.0;
const FALLBACK_TEMPERATURE = 0.1;
const FALLBACK_MAX_CHARS = 300;

// 카테고리 라우터 프롬프트
const ROUTER_PROMPT = `당신은 사용자의 질문을 분석하여 가장 적절한 카테고리로 분류하는 AI입니다.

[카테고리 정의]
1. **cancer**: 암, 항암 치료, 면역 치료, 암 식단, 고주파 온열 치료, 종양, 전이, 재발 등 암과 관련된 모든 의학적 질문. 특정 암 질환명(췌장암, 폐암, 위암, 간암, 대장암, 유방암, 갑상선암, 전립선암, 자궁암, 난소암, 담낭암, 식도암, 방광암, 신장암, 림프종, 백혈병, 뇌종양, 직장암, 혈액암, 피부암 등)이 포함된 질문은 반드시 cancer로 분류하세요. 또한 "○○암"(예: XX암) 형태의 단어가 포함되면 cancer입니다.
2. **nerve**: 자율신경, 자율신경실조증과 관련된 모든 의학적 질문. 다음 키워드 포함 시 nerve로 분류:
   - 신경 관련: 자율신경, 자율신경실조, 신경 주사, 미주신경
   - 증상: 어지러움, 어지럼증, 두통, 편두통, 기립성저혈압, 실신, 현기증
   - 수면/피로: 불면증, 불면, 수면장애, 피로, 만성피로, 무기력
   - 소화: 소화불량, 소화장애, 위장장애, 속쓰림
   - 정서: 스트레스, 불안, 화병, 긴장, 공황
   - 갱년기: 갱년기, 갱년기증상, 폐경, 열오름, 안면홍조
   - 건강/영양: 비타민, 비타민C, 영양제, 건강관리, 식단, 영양, 건강식, 올리브오일
   - 운동/생활: 운동, 스트레칭, 생활습관
3. **general**: 인사, 병원 위치 문의, 진료 시간, 비용 문의, 날씨, 일상적인 대화 등 의학적 전문 지식이 필요 없는 질문.

**중요**: 건강, 영양, 생활습관, 증상 관련 질문은 모두 nerve로 분류하세요. general은 정말 의료/건강과 무관한 질문에만 사용하세요.

사용자의 질문이 입력되면, 위 3가지 카테고리 중 하나를 선택하여 단어 하나만 출력하세요. (예: cancer)

[질문]: {question}
[분류]:`;

// 일반 응답 프롬프트 (상담 실장 페르소나)
const GENERAL_PROMPT = `당신은 서울온케어의원의 **상담 실장 온케어봇**입니다.
환자분들을 따뜻하고 친절하게 맞이하고, 병원 이용에 대한 기본적인 안내를 도와드립니다.

[Previous Conversation]:
{history}

[질문]:
{question}

**가이드라인**:
1. **친절함**: 항상 밝고 정중한 태도로 응대하세요.
2. **역할 제한**: 의학적인 상담이나 진단은 하지 않습니다. 의학적인 질문이 들어오면 "죄송하지만, 그 부분은 원장님 진료 시 자세히 상담받으실 수 있습니다."라고 안내하세요.
3. **병원 안내**: 진료 시간, 위치 등은 알고 있는 범위 내에서 안내하되, 모르는 내용은 "병원으로 전화 주시면 친절히 안내해 드리겠습니다."라고 답변하세요.
4. **간결함**: 답변은 공백 포함 300자 이내로 핵심만 전달하세요.`;

// 의료 응답 프롬프트 (AI 상담 전문의 페르소나)
const MEDICAL_PROMPT = `당신은 서울온케어의원의 **AI 상담 전문의 온케어봇**입니다.
현재 상담 주제는 **{category_name}**입니다.

환자(사용자)의 질문에 대해 아래 [Context]를 바탕으로 친절하고 전문적으로 답변해 주세요.

[Previous Conversation]:
{history}

[Context] (참고 자료):
{context}

[Question]:
{question}

**답변 가이드라인 (필수 준수)**:
1. **문맥 필터링 (중요)**: 위 [Context]에는 질문과 관련 없는 내용이 섞여 있을 수 있습니다. **반드시 질문과 직접적으로 관련된 내용만 골라서** 답변하세요. 단순히 단어가 같다고 해서 관련 없는 내용을 억지로 연결하지 마세요.
2. **페르소나**: 당신은 의사 선생님처럼 공감하며 전문적인 어조를 사용합니다. 하지만 **절대로 확정적인 진단이나 처방을 내려서는 안 됩니다.**
3. **안전장치**: "진단", "처방", "약물 추천" 등의 요청에는 "구체적인 진단과 처방은 내원하시어 전문의와 상담이 필요합니다"라는 취지로 안내하세요.
4. **근거 기반**: 제공된 Context에 질문에 대한 답이 명확히 없다면, 솔직하게 "해당 내용은 병원 자료에 없어 정확한 답변이 어렵습니다"라고 말하세요. 지어내지 마세요.
5. **길이 제한**: 답변은 공백 포함 500자 이내로 작성하되, 핵심 정보는 빠짐없이 전달하세요.

**법적 고지 (답변 하단에 필수 포함)**:
"본 상담 내용은 참고용이며, 의학적 진단이나 처방을 대신할 수 없습니다."`;

// 폴백 응답 프롬프트 (일반 상식 에이전트)
const FALLBACK_PROMPT = `당신은 서울온케어의원의 AI 상담 보조입니다.
환자의 질문에 대해 **일반적인 의학 상식** 수준에서 친절하게 안내합니다.

[Previous Conversation]:
{history}

[Question]:
{question}

**답변 규칙 (반드시 준수)**:
1. **공식 자료 없음 안내**: "해당 질문에 대한 서울온케어의원의 공식 자료는 아직 준비되어 있지 않아, 일반적인 의학 상식을 바탕으로 안내해 드립니다."로 시작하세요.

2. **일반 상식 기반 답변**:
   - 널리 알려진 의학 상식 수준으로 친절하게 답변하세요.
   - 예: 고압산소치료 → 혈액 내 산소 농도를 높여 조직 회복과 항암 효과를 높이는 데 도움
   - 예: 고주파온열치료 → 암세포에 열을 가해 항암제의 효과를 극대화
   - 구체적인 약물명, 용량은 언급하지 마세요.

3. **유보적 표현 사용**: "~일 수 있습니다", "~가 일반적입니다", "~에 도움이 될 수 있습니다" 같은 유보적 표현을 사용하세요.

4. **진단/처방 절대 금지**: 특정 질병을 진단하거나 약물을 처방하는 내용은 절대 포함하지 마세요.

5. **길이**: 답변은 공백 포함 400자 이내로 작성하세요.

6. **내원 유도**: 답변 마지막에 "자세한 내용은 서울온케어의원(☎ 1577-7998)에 내원하시어 전문의 상담을 받으시기 바랍니다."를 포함하세요.`;

// 내원 의사 감지 키워드
const VISIT_INTENT_STRONG = [
  '예약', '방문', '내원', '가보고싶', '가볼게', '가고싶',
  '진료받고싶', '치료받고싶', '상담받고싶', '진료예약',
  '어떻게가', '언제가면', '찾아가', '찾아뵙', '방문하고',
  '가보려고', '갈게요', '갈까요', '가볼까', '가봐야',
  '한번가', '직접가', '내원하고', '접수',
  '입원', '입원하려', '입원하고싶', '입원하고', '입원절차', '입원방법',
  '치료받으려', '치료받으러', '상담받으려', '상담받으러',
];

const VISIT_INTENT_WEAK = [
  '어디', '위치', '주소', '오시는길', '길찾기', '지도',
  '진료시간', '운영시간', '몇시', '영업시간',
  '전화번호', '연락처', '전화',
];

const VISIT_NEGATION = [
  '어렵', '못가', '안가', '안갈', '못갈', '힘들', '나중에',
  '다음에', '괜찮', '됐어', '아직', '생각해',
];

export class MarketingGenerator {
  private model = GENERATION_MODEL;

  /**
   * 질문 카테고리 분류
   */
  async classifyQuery(query: string): Promise<MarketingCategoryType> {
    try {
      const ai = getGenAI();
      const model = ai.getGenerativeModel({ model: this.model });

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: ROUTER_PROMPT.replace('{question}', query) }] }],
        generationConfig: { temperature: ROUTER_TEMPERATURE },
      });

      const category = result.response.text().trim().toLowerCase();
      if (['cancer', 'nerve', 'general'].includes(category)) {
        return category as MarketingCategoryType;
      }
      return 'general';
    } catch (err) {
      console.error('[MarketingGenerator] Router error:', err);
      return 'general';
    }
  }

  /**
   * 대화 이력 포맷팅
   */
  private formatHistory(history: Array<{ role: string; content: string }>): string {
    if (!history || history.length === 0) return '없음';
    return history
      .slice(-5)
      .map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
      .join('\n');
  }

  /**
   * 컨텍스트 포맷팅
   */
  private formatContext(docs: SearchResult[]): string {
    return docs
      .map((doc, i) => {
        const content = doc.content || `Q: ${doc.question}\nA: ${doc.answer}`;
        const title = doc.title || '자료';
        const similarity = doc.similarity || 0;
        return `[자료 ${i + 1}] (출처: ${doc.type || 'unknown'}, 관련도: ${Math.round(similarity * 100)}%)\n제목: ${title}\n${content}`;
      })
      .join('\n\n---\n\n');
  }

  /**
   * 일반 응답 생성 (스트리밍)
   */
  async *generateGeneralResponse(
    query: string,
    history: Array<{ role: string; content: string }>
  ): AsyncGenerator<string> {
    const ai = getGenAI();
    const model = ai.getGenerativeModel({ model: this.model });

    const prompt = GENERAL_PROMPT
      .replace('{history}', this.formatHistory(history))
      .replace('{question}', query);

    try {
      const result = await model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: GENERAL_TEMPERATURE },
      });

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) yield text;
      }
    } catch (err) {
      console.error('[MarketingGenerator] General response error:', err);
      yield '죄송합니다. 답변을 생성하는 도중 오류가 발생했습니다.';
    }
  }

  /**
   * 의료 응답 생성 (스트리밍)
   */
  async *generateMedicalResponse(
    query: string,
    context: SearchResult[],
    category: MarketingCategoryType,
    history: Array<{ role: string; content: string }>
  ): AsyncGenerator<string> {
    const ai = getGenAI();
    const model = ai.getGenerativeModel({ model: this.model });

    const categoryName = category === 'cancer'
      ? '암 보조 치료 (Cancer Support Treatment)'
      : '자율신경 치료 (Autonomic Nerve Treatment)';

    const prompt = MEDICAL_PROMPT
      .replace('{category_name}', categoryName)
      .replace('{history}', this.formatHistory(history))
      .replace('{context}', this.formatContext(context))
      .replace('{question}', query);

    try {
      const result = await model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: MEDICAL_TEMPERATURE },
      });

      let fullResponse = '';
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          fullResponse += text;
          yield text;
        }
      }

      // 면책 조항 추가
      if (!fullResponse.includes('본 상담 내용은 참고용이며')) {
        yield `\n\n---\n**${MEDICAL_DISCLAIMER}**`;
      }
    } catch (err) {
      console.error('[MarketingGenerator] Medical response error:', err);
      yield '죄송합니다. 답변을 생성하는 도중 오류가 발생했습니다.';
    }
  }

  /**
   * 폴백 응답 생성 (스트리밍)
   */
  async *generateFallback(
    query: string,
    history: Array<{ role: string; content: string }>
  ): AsyncGenerator<string> {
    yield MarketingSafetyGuard.getFallbackPrefix();

    const ai = getGenAI();
    const model = ai.getGenerativeModel({ model: this.model });

    const prompt = FALLBACK_PROMPT
      .replace('{history}', this.formatHistory(history))
      .replace('{question}', query);

    try {
      const result = await model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: FALLBACK_TEMPERATURE },
      });

      let fullResponse = '';
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          fullResponse += text;
          yield text;
        }
      }

      // 안전 검증
      if (!MarketingSafetyGuard.checkOutputSafety(fullResponse)) {
        yield '\n\n(이 내용은 안전 검토를 통과하지 못했습니다. 병원에 직접 문의해 주세요.)';
        return;
      }

      yield `\n\n---\n**${FALLBACK_DISCLAIMER}**`;
    } catch (err) {
      console.error('[MarketingGenerator] Fallback error:', err);
      yield MarketingSafetyGuard.getNoInfoResponse();
    }
  }

  /**
   * 내원 의사 감지
   */
  detectVisitIntent(
    query: string,
    history: Array<{ role: string; content: string }>
  ): 'strong' | 'weak' | null {
    const q = query.replace(/\s/g, '').toLowerCase();

    // 부정 표현 체크
    if (VISIT_NEGATION.some((neg) => q.includes(neg))) {
      return null;
    }

    if (VISIT_INTENT_STRONG.some((kw) => q.includes(kw))) {
      return 'strong';
    }

    if (VISIT_INTENT_WEAK.some((kw) => q.includes(kw))) {
      return 'weak';
    }

    // 히스토리에서 최근 2턴 내 내원 표현 탐색
    const recent = history.slice(-4);
    for (const turn of recent) {
      if (turn.role === 'user') {
        const t = turn.content.replace(/\s/g, '').toLowerCase();
        if (VISIT_INTENT_STRONG.some((kw) => t.includes(kw))) {
          return 'strong';
        }
      }
    }

    return null;
  }

  /**
   * 소스에서 YouTube 영상 추출
   */
  extractYouTubeSources(docs: SearchResult[]): Array<{
    source: string;
    title: string;
    thumbnail?: string;
  }> {
    const seen = new Set<string>();
    const sources: Array<{ source: string; title: string; thumbnail?: string }> = [];

    for (const doc of docs) {
      const sourceUrl = doc.sourceUrl || (doc.metadata as any)?.source;
      const title = doc.title || (doc.metadata as any)?.title || '관련 추천 영상';

      if (
        sourceUrl &&
        (sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be')) &&
        !seen.has(sourceUrl)
      ) {
        seen.add(sourceUrl);

        // YouTube ID 추출
        const match = sourceUrl.match(
          /(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*)/
        );
        const videoId = match?.[1];

        sources.push({
          source: sourceUrl,
          title,
          thumbnail: videoId
            ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
            : undefined,
        });

        if (sources.length >= 8) break;
      }
    }

    return sources;
  }
}
