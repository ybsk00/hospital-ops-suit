/**
 * 마케팅 챗봇 안전장치 서비스
 * 진단/처방 금지, 관련성 체크, 출력 안전 검증
 */

// 진단/처방 요청 키워드
const FORBIDDEN_KEYWORDS = [
  '진단해줘', '처방해줘', '약 추천', '무슨 병이야',
  '진단해 줘', '처방해 줘', '약 좀 추천', '병명 알려',
  '무슨 병인지', '진단 내려', '약 처방',
];

// LLM 출력에서 차단해야 할 표현
const OUTPUT_FORBIDDEN = [
  '처방합니다', '처방드립니다', '진단합니다', '진단드립니다',
  '복용하세요', '투여', '처방전', 'mg', '정을 드세요',
  '주사하세요', '수술하세요',
];

// 설정
const RELEVANCE_MIN_SIMILARITY = 0.67;
const MEDICAL_DISCLAIMER = '⚠️ 본 상담 내용은 참고용 정보이며, 의학적 진단이나 처방을 대신할 수 없습니다. 정확한 진단과 치료를 위해 반드시 전문의와 상담하시기 바랍니다.';
const NO_INFO_MESSAGE = '죄송합니다. 해당 내용에 대한 병원 공식 자료를 찾을 수 없습니다. 정확한 상담은 서울온케어의원(☎ 1577-7998)으로 전화 부탁드립니다.';
const FALLBACK_PREFIX = '📋 [일반 의학 상식 안내]\n\n';
const FALLBACK_DISCLAIMER = '⚠️ 주의: 위 내용은 서울온케어의원의 공식 자료가 아닌 일반적인 의학 상식에 기반한 참고 정보입니다. 개인의 건강 상태에 따라 다를 수 있으므로, 정확한 진단과 치료를 위해 서울온케어의원(☎ 1577-7998)에 내원하시거나 전화로 상담받으시기 바랍니다.';

export interface SearchResult {
  id: string;
  content?: string;
  question?: string;
  answer?: string;
  metadata?: Record<string, unknown>;
  similarity: number;
  type?: string;
  category?: string;
  sourceUrl?: string;
  title?: string;
}

export class MarketingSafetyGuard {
  /**
   * 진단/처방 요청 감지 (띄어쓰기 변형 포함)
   */
  static checkMedicalQuery(query: string): boolean {
    const normalized = query.replace(/\s/g, '');
    return FORBIDDEN_KEYWORDS.some((kw) =>
      normalized.includes(kw.replace(/\s/g, ''))
    );
  }

  /**
   * 검색된 문서의 관련성 확인 (벡터 노이즈 필터링)
   */
  static checkRelevance(
    docs: SearchResult[],
    minSimilarity: number = RELEVANCE_MIN_SIMILARITY
  ): boolean {
    if (!docs || docs.length === 0) return false;
    return docs.some((doc) => doc.similarity >= minSimilarity);
  }

  /**
   * LLM 출력에 처방/진단 표현이 없으면 true (안전)
   */
  static checkOutputSafety(response: string): boolean {
    const normalized = response.replace(/\s/g, '');
    return !OUTPUT_FORBIDDEN.some((kw) =>
      normalized.includes(kw.replace(/\s/g, ''))
    );
  }

  /**
   * 진단/처방 요청 경고 문구
   */
  static getDiagnosisWarning(): string {
    return '죄송합니다. 저는 의학적 진단이나 처방을 내려드릴 수 없습니다. 정확한 진단은 병원에 내원하여 전문의와 상담해주세요.';
  }

  /**
   * 정보 없음 응답
   */
  static getNoInfoResponse(): string {
    return NO_INFO_MESSAGE;
  }

  /**
   * 면책 조항 추가
   */
  static appendDisclaimer(response: string): string {
    return `${response}\n\n---\n**${MEDICAL_DISCLAIMER}**`;
  }

  /**
   * 폴백 접두어
   */
  static getFallbackPrefix(): string {
    return FALLBACK_PREFIX;
  }

  /**
   * 폴백 면책 조항
   */
  static getFallbackDisclaimer(): string {
    return FALLBACK_DISCLAIMER;
  }

  /**
   * 대화 이력 검증
   */
  static validateHistory(
    history: unknown
  ): Array<{ role: string; content: string }> {
    if (!Array.isArray(history)) return [];

    const validated: Array<{ role: string; content: string }> = [];
    for (const item of history) {
      if (
        typeof item === 'object' &&
        item !== null &&
        'role' in item &&
        'content' in item
      ) {
        const role =
          (item as { role: string }).role === 'user' ||
          (item as { role: string }).role === 'model'
            ? (item as { role: string }).role
            : 'user';
        const content = String((item as { content: unknown }).content).slice(
          0,
          2000
        );
        validated.push({ role, content });
      }
    }

    return validated.slice(-10);
  }
}

export {
  MEDICAL_DISCLAIMER,
  NO_INFO_MESSAGE,
  FALLBACK_PREFIX,
  FALLBACK_DISCLAIMER,
  RELEVANCE_MIN_SIMILARITY,
};
