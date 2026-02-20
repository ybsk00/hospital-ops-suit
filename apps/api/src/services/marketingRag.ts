/**
 * 마케팅 챗봇 RAG 서비스
 * 하이브리드 검색 (벡터 + 키워드)
 */

import { prisma } from '../lib/prisma';
import { embed } from './embedding';
import { SearchResult } from './marketingSafety';

// 설정
const SIMILARITY_THRESHOLD = 0.40;
const MAX_CONTEXT_DOCS = 8;
const MAX_CONTEXT_CHARS = 8000;

// 한국어 불용어
const STOPWORDS = new Set([
  '은', '는', '이', '가', '을', '를', '의', '에', '에서', '으로', '로',
  '와', '과', '도', '만', '까지', '부터', '에게', '한테', '께',
  '하는', '하고', '해서', '하면', '합니다', '입니다', '있는', '없는',
  '어떤', '무엇', '어떻게', '왜', '좀', '것', '수', '때', '거',
  '알려줘', '알려주세요', '뭐야', '뭔가요', '인가요', '건가요',
  '대해', '대해서', '관해', '관해서', '뭐예요', '무엇인가요',
  '어떻', '그런', '이런', '저런', '있나요', '없나요', '해주세요',
  '싶어', '싶은', '싶다', '싶어요', '싶습니다', '소개', '설명', '궁금', '정보',
]);

// 조사/어미 접미사
const PARTICLES = [
  '에서는', '에서도', '에서의', '으로는', '으로도', '에서',
  '에게는', '에게도', '에게', '한테는', '한테도', '한테',
  '으로', '로는', '로도',
  '이란', '이라', '이든', '이나', '이고', '이에',
  '에는', '에도', '에의',
  '은요', '는요', '이요',
  '과는', '와는',
  '까지', '부터', '마저', '조차', '밖에',
  '하고', '해서', '해요', '하면', '할까',
  '은', '는', '이', '가', '을', '를', '의', '에', '로',
  '와', '과', '도', '만', '요',
];

// 의료 동의어 사전 (확장)
const MEDICAL_SYNONYMS: Record<string, string[]> = {
  // 암 관련 (일반)
  '암': ['종양', '악성종양', '암세포', '암환자', '암치료', '항암', 'cancer'],
  '항암': ['항암제', '항암치료', '항암요법', '화학요법', '암'],
  '재발': ['재발방지', '전이', '재발률', '재발위험'],
  '전이': ['재발', '전이암', '원격전이'],

  // 암 종류별 상위/하위 매핑
  '소화기암': ['위암', '대장암', '직장암', '식도암', '췌장암', '간암', '담낭암', '담도암', '소장암'],
  '위암': ['소화기암', '위장암', '위선암'],
  '대장암': ['소화기암', '직장암', '결장암', '대장'],
  '직장암': ['소화기암', '대장암'],
  '식도암': ['소화기암'],
  '췌장암': ['소화기암', '췌장'],
  '간암': ['소화기암', '간세포암', '간'],
  '담낭암': ['소화기암', '담도암'],
  '부인암': ['유방암', '자궁암', '난소암', '자궁경부암'],
  '유방암': ['부인암', '유방'],
  '자궁암': ['부인암', '자궁경부암', '자궁내막암'],
  '난소암': ['부인암'],
  '폐암': ['비소세포폐암', '소세포폐암', '폐'],
  '혈액암': ['백혈병', '림프종', '골수종'],
  '백혈병': ['혈액암', '급성백혈병', '만성백혈병'],
  '림프종': ['혈액암', '림프'],

  // 치료법 관련
  '고주파': ['고주파치료', '온열치료', '온코써미아', '하이퍼써미아', '온열암치료', '고주파온열', 'hyperthermia'],
  '온열': ['온열치료', '고주파', '고주파치료', '고주파온열', '온열암', '하이퍼써미아'],
  '저주파': ['온열치료', '고주파', '고주파치료', '고주파온열', '온열'],
  '저주파온열': ['고주파온열', '온열치료', '고주파치료', '온열'],
  '고압산소': ['고압산소치료', 'HBOT'],
  '이뮨셀': ['면역세포치료', 'NK세포', '면역세포', '면역치료'],
  '면역세포': ['이뮨셀', 'NK세포', '면역세포치료', '면역치료'],
  '세레늄': ['셀레늄', '셀레니움', 'selenium'],
  '셀레늄': ['세레늄', '셀레니움'],
  '싸이모신': ['타이모신', '흉선펩타이드', 'thymosin'],
  '미슬토': ['겨우살이', 'mistletoe', '미슬토주사'],
  '폴리사카라이드': ['베타글루칸', '다당류', 'PSK'],
  '베타글루칸': ['폴리사카라이드', '다당류'],
  '비타민C': ['비타민', '영양제', '메가도스', '고용량비타민C', '아스코르빈산'],
  '방사선': ['방사선치료', '방사선요법', '방사선암치료'],

  // 자율신경 관련
  '자율신경': ['자율신경계', '자율신경실조', '자율신경장애', '자율신경실조증'],
  '자율신경실조증': ['자율신경', '자율신경실조', '자율신경장애'],

  // 증상 관련
  '어지러움': ['어지럼증', '어지러움증', '현기증', '기립성', '기립성저혈압'],
  '어지럼증': ['어지러움', '어지러움증', '현기증', '기립성'],
  '기립성': ['기립성저혈압', '어지러움', '어지럼증'],
  '두통': ['편두통', '머리아픔', '두통증'],
  '불면': ['불면증', '수면장애', '잠'],
  '불면증': ['불면', '수면장애', '잠', '숙면'],
  '피로': ['만성피로', '피로감', '무기력', '기력저하'],
  '스트레스': ['긴장', '불안', '화병', '정신적'],
  '소화불량': ['소화', '위장', '속쓰림', '더부룩'],
  '소화': ['소화불량', '위장', '소화장애'],

  // 갱년기 관련
  '갱년기': ['폐경', '갱년기증상', '갱년기장애', '호르몬'],
  '폐경': ['갱년기', '갱년기증상'],

  // 건강/영양 관련
  '면역': ['면역력', '면역치료', '면역요법', '면역강화'],
  '비타민': ['비타민C', '영양제', '영양소', '메가도스'],
  '영양': ['영양제', '영양소', '비타민', '건강식품'],
  '영양제': ['영양', '비타민', '건강식품', '보충제'],
  '식단': ['식이요법', '음식', '식사', '건강식'],
  '건강': ['건강관리', '건강식', '웰빙'],
  '통증': ['통증치료', '진통', '만성통증', '아픔'],
  '음식': ['식단', '식이요법', '식사', '건강식', '영양'],

  // 기타 증상
  '화병': ['스트레스', '분노', '울화병', '열오름'],
  '열오름': ['화병', '상열감', '안면홍조'],

  // ── 혈액검사/소변검사 관련 ──
  '피검사': ['혈액검사', '채혈', '혈액분석', 'CBC', '종합혈액검사', '혈액'],
  '혈액검사': ['피검사', '채혈', 'CBC', '종합혈액검사', '혈액분석'],
  '소변검사': ['요검사', '뇨검사', '소변분석', '요분석'],
  '요검사': ['소변검사', '뇨검사', '소변분석'],

  // 종양표지자
  '종양표지자': ['암표지자', '암수치', 'CEA', 'AFP', 'CA19-9', 'PSA', 'CA-125'],
  '암표지자': ['종양표지자', '암수치', '암검사'],
  'CEA': ['종양표지자', '암태아성항원', '대장암표지자'],
  'AFP': ['종양표지자', '알파태아단백', '간암표지자'],
  'CA19-9': ['종양표지자', '췌장암표지자', '담도암표지자'],
  'CA-125': ['종양표지자', '난소암표지자'],
  'PSA': ['종양표지자', '전립선특이항원', '전립선암표지자'],

  // 간기능
  '간수치': ['간기능검사', 'AST', 'ALT', 'GOT', 'GPT', '간효소'],
  '간기능': ['간수치', '간기능검사', 'AST', 'ALT', 'GGT'],
  'AST': ['간수치', 'GOT', '간기능'],
  'ALT': ['간수치', 'GPT', '간기능'],
  'GOT': ['AST', '간수치', '간기능'],
  'GPT': ['ALT', '간수치', '간기능'],
  '지방간': ['간수치', '간기능', 'NAFLD', '간질환'],

  // 신장기능
  '신장': ['콩팥', '신기능', '크레아티닌', 'eGFR', '신장기능'],
  '콩팥': ['신장', '신기능', '신장기능'],
  '크레아티닌': ['신장', '신기능', 'eGFR'],

  // 당뇨/혈당
  '당뇨': ['혈당', 'HbA1c', '당화혈색소', '공복혈당', '당뇨병'],
  '혈당': ['당뇨', '공복혈당', 'HbA1c', '당화혈색소', '혈당수치'],
  'HbA1c': ['당화혈색소', '당뇨', '혈당'],
  '당화혈색소': ['HbA1c', '당뇨', '혈당'],

  // 콜레스테롤/지질
  '콜레스테롤': ['지질검사', 'LDL', 'HDL', '중성지방', '이상지질혈증', '고지혈증'],
  '고지혈증': ['콜레스테롤', '이상지질혈증', '지질검사', 'LDL'],
  'LDL': ['콜레스테롤', '나쁜콜레스테롤', '지질검사'],
  'HDL': ['콜레스테롤', '좋은콜레스테롤', '지질검사'],
  '중성지방': ['콜레스테롤', '지질검사', '트리글리세리드'],

  // 갑상선
  '갑상선': ['TSH', 'T3', 'T4', '갑상선기능', '갑상선호르몬'],
  'TSH': ['갑상선', '갑상선기능', '갑상선호르몬'],
  '갑상선암': ['갑상선', '갑상선결절', '갑상선수술'],

  // 빈혈
  '빈혈': ['헤모글로빈', '철분', '페리틴', '철결핍', '빈혈검사'],
  '헤모글로빈': ['빈혈', '혈색소', 'Hb'],
  '철분': ['빈혈', '페리틴', '철결핍성빈혈'],

  // 염증지표
  'CRP': ['염증수치', '염증표지자', '고감도CRP'],
  '염증': ['CRP', '염증수치', '염증표지자', '염증반응'],
  '염증수치': ['CRP', '염증', '염증표지자'],

  // 전해질
  '전해질': ['나트륨', '칼륨', '칼슘', '마그네슘', '전해질검사'],

  // 소변 관련
  '단백뇨': ['소변검사', '소변단백', '알부민뇨', '신장질환'],
  '혈뇨': ['소변검사', '소변혈액', '혈뇨검사'],
  '요당': ['소변검사', '소변포도당', '당뇨'],

  // 만성질환 관련
  '대사증후군': ['내장지방', '인슐린저항성', '만성질환', '복부비만'],
  '만성질환': ['대사증후군', '고혈압', '당뇨', '고지혈증'],

  // 비타민/미네랄 결핍
  '비타민D': ['비타민D결핍', '골다공증', '칼슘흡수'],
  '비타민B12': ['빈혈', '엽산', '신경손상', '거대적아구성빈혈'],

  // 검사 관련 일반
  '정상범위': ['참고치', '기준치', '정상수치', '정상치'],
  '수치': ['결과', '정상범위', '이상수치', '검사결과'],
  '검사결과': ['수치', '정상범위', '이상소견', '결과해석'],
};

/**
 * 조사 분리
 */
function stripParticles(word: string): string {
  for (const p of PARTICLES) {
    if (word.endsWith(p) && word.length > p.length + 1) {
      return word.slice(0, -p.length);
    }
  }
  return word;
}

/**
 * 키워드 추출
 */
function extractKeywords(query: string): string[] {
  const tokens = query
    .replace(/[?!.]/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));

  const keywords: string[] = [];
  for (const w of tokens) {
    const stripped = stripParticles(w);
    if (stripped.length >= 2 && !STOPWORDS.has(stripped)) {
      keywords.push(stripped);
    } else if (w.length >= 2) {
      keywords.push(w);
    }
  }

  // 중복 제거
  return [...new Set(keywords)];
}

/**
 * 동의어 확장
 */
function expandSynonyms(keywords: string[]): string[] {
  const expanded = [...keywords];
  for (const kw of keywords) {
    const syns = MEDICAL_SYNONYMS[kw];
    if (syns) {
      for (const syn of syns) {
        if (!expanded.includes(syn)) {
          expanded.push(syn);
        }
      }
    }
  }
  return expanded;
}

/**
 * 복합어 키워드 확장 (3글자 서브워드)
 */
function expandCompoundKeywords(keywords: string[]): string[] {
  const expanded = [...keywords];

  // 암 질환명 패턴 감지
  const cancerTerms = ['암', '암치료', '암환자', '항암', '암보조'];
  for (const kw of keywords) {
    if (kw.endsWith('암') && kw.length >= 2 && kw !== '암') {
      for (const term of cancerTerms) {
        if (!expanded.includes(term)) {
          expanded.push(term);
        }
      }
    }
  }

  // 3글자 서브워드
  for (const kw of keywords) {
    if (kw.length >= 4) {
      for (let i = 0; i <= kw.length - 3; i++) {
        const sub = kw.slice(i, i + 3);
        if (!expanded.includes(sub) && !STOPWORDS.has(sub)) {
          expanded.push(sub);
        }
      }
    }
  }

  return expanded;
}

export class MarketingRetriever {
  /**
   * 쿼리에서 키워드 추출 (외부 사용용)
   */
  extractKeywords(query: string): string[] {
    return expandCompoundKeywords(expandSynonyms(extractKeywords(query)));
  }

  /**
   * 하이브리드 검색 (벡터 + 키워드)
   */
  async retrieve(query: string, k: number = 10): Promise<SearchResult[]> {
    // 1. 벡터 검색 (병렬) - 더 많은 결과 가져오기
    const queryVector = await embed(query);
    const vectorStr = `[${queryVector.join(',')}]`;

    const [faqVectorResults, docVectorResults] = await Promise.all([
      this.vectorSearchFaqs(vectorStr, k * 2),
      this.vectorSearchDocs(vectorStr, k * 2),
    ]);

    // 2. 키워드 검색
    const keywords = extractKeywords(query);
    const expandedKeywords = expandCompoundKeywords(expandSynonyms(keywords));
    const keywordResults = await this.keywordSearch(expandedKeywords, k);

    // 3. 결과 병합 + 중복 제거
    const mergedDocs = new Map<string, SearchResult>();

    // FAQ 벡터 결과 우선
    for (const doc of faqVectorResults) {
      mergedDocs.set(doc.id, doc);
    }

    // 문서 벡터 결과
    for (const doc of docVectorResults) {
      if (!mergedDocs.has(doc.id)) {
        mergedDocs.set(doc.id, doc);
      } else {
        const existing = mergedDocs.get(doc.id)!;
        if (doc.similarity > existing.similarity) {
          mergedDocs.set(doc.id, doc);
        }
      }
    }

    // 키워드 결과
    for (const doc of keywordResults) {
      if (!mergedDocs.has(doc.id)) {
        mergedDocs.set(doc.id, doc);
      }
    }

    // 4. 유사도 기준 정렬
    const ranked = Array.from(mergedDocs.values()).sort(
      (a, b) => b.similarity - a.similarity
    );

    // 5. 컨텍스트 절단
    const finalResults: SearchResult[] = [];
    let totalChars = 0;

    for (const doc of ranked) {
      const content = doc.content || `Q: ${doc.question}\nA: ${doc.answer}`;
      if (totalChars + content.length > MAX_CONTEXT_CHARS) break;
      if (finalResults.length >= MAX_CONTEXT_DOCS) break;

      finalResults.push(doc);
      totalChars += content.length;
    }

    console.log(
      `[MarketingRAG] faqVector=${faqVectorResults.length}, docVector=${docVectorResults.length}, keyword=${keywordResults.length}, final=${finalResults.length}`
    );

    return finalResults;
  }

  /**
   * HospitalFaq 벡터 검색
   */
  private async vectorSearchFaqs(
    vectorStr: string,
    limit: number
  ): Promise<SearchResult[]> {
    try {
      const results = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          question: string;
          answer: string;
          metadata: unknown;
          category: string;
          sourceUrl: string;
          title: string;
          similarity: number;
        }>
      >(
        `SELECT id, question, answer, metadata, category, "sourceUrl", title,
                1 - (vector <=> $1::vector) AS similarity
         FROM "HospitalFaq"
         WHERE "isActive" = true AND "deletedAt" IS NULL
           AND 1 - (vector <=> $1::vector) > $2
         ORDER BY vector <=> $1::vector
         LIMIT $3`,
        vectorStr,
        SIMILARITY_THRESHOLD,
        limit
      );

      return results.map((r) => ({
        id: r.id,
        question: r.question,
        answer: r.answer,
        metadata: r.metadata as Record<string, unknown>,
        category: r.category,
        sourceUrl: r.sourceUrl,
        title: r.title,
        similarity: r.similarity,
        type: 'faq',
      }));
    } catch (err) {
      console.error('[MarketingRAG] FAQ vector search error:', err);
      return [];
    }
  }

  /**
   * MarketingDocument 벡터 검색
   */
  private async vectorSearchDocs(
    vectorStr: string,
    limit: number
  ): Promise<SearchResult[]> {
    try {
      const results = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          content: string;
          metadata: unknown;
          type: string;
          category: string;
          sourceUrl: string;
          title: string;
          similarity: number;
        }>
      >(
        `SELECT id, content, metadata, type, category, "sourceUrl", title,
                1 - (vector <=> $1::vector) AS similarity
         FROM "MarketingDocument"
         WHERE "isActive" = true AND "deletedAt" IS NULL
           AND 1 - (vector <=> $1::vector) > $2
         ORDER BY vector <=> $1::vector
         LIMIT $3`,
        vectorStr,
        SIMILARITY_THRESHOLD,
        limit
      );

      return results.map((r) => ({
        id: r.id,
        content: r.content,
        metadata: r.metadata as Record<string, unknown>,
        type: r.type,
        category: r.category,
        sourceUrl: r.sourceUrl,
        title: r.title,
        similarity: r.similarity,
      }));
    } catch (err) {
      console.error('[MarketingRAG] Document vector search error:', err);
      return [];
    }
  }

  /**
   * 키워드 검색
   */
  private async keywordSearch(
    keywords: string[],
    limit: number
  ): Promise<SearchResult[]> {
    if (keywords.length === 0) return [];

    try {
      // FAQ 키워드 검색
      const faqResults = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          question: string;
          answer: string;
          metadata: unknown;
          category: string;
          sourceUrl: string;
          title: string;
        }>
      >(
        `SELECT id, question, answer, metadata, category, "sourceUrl", title
         FROM "HospitalFaq"
         WHERE "isActive" = true AND "deletedAt" IS NULL
           AND (${keywords.map((_, i) => `question ILIKE $${i + 1} OR answer ILIKE $${i + 1}`).join(' OR ')})
         LIMIT $${keywords.length + 1}`,
        ...keywords.map((kw) => `%${kw}%`),
        limit
      );

      return faqResults.map((r) => ({
        id: r.id,
        question: r.question,
        answer: r.answer,
        metadata: r.metadata as Record<string, unknown>,
        category: r.category,
        sourceUrl: r.sourceUrl,
        title: r.title,
        similarity: 0.5, // 키워드 매칭 기본 점수
        type: 'faq',
      }));
    } catch (err) {
      console.error('[MarketingRAG] Keyword search error:', err);
      return [];
    }
  }

  /**
   * 유튜브 영상 전용 검색 (브로드 매칭 + 띄어쓰기 처리 + 중복 URL 제거)
   */
  async searchYouTubeVideos(
    keywords: string[],
    category?: string,
    limit: number = 10,
    originalQuery?: string
  ): Promise<SearchResult[]> {
    try {
      // 1. 검색 키워드 준비 (브로드 매칭)
      const searchTerms = new Set<string>();

      // 원본 쿼리에서 키워드 추출
      if (originalQuery) {
        // 띄어쓰기 제거 버전
        const noSpace = originalQuery.replace(/\s+/g, '');
        if (noSpace.length >= 2) searchTerms.add(noSpace);

        // 원본 그대로
        if (originalQuery.length >= 2) searchTerms.add(originalQuery);

        // 공백으로 분리된 각 단어
        originalQuery.split(/\s+/).forEach(w => {
          if (w.length >= 2) searchTerms.add(w);
        });
      }

      // 전달된 키워드들
      keywords.forEach(kw => {
        if (kw.length >= 2) searchTerms.add(kw);
        // 띄어쓰기 제거 버전
        const noSpace = kw.replace(/\s+/g, '');
        if (noSpace.length >= 2 && noSpace !== kw) searchTerms.add(noSpace);
      });

      // 핵심 의료/건강 키워드 추가 (동의어 확장)
      const medicalKeywords = [
        // 암/치료 관련
        '고주파', '온열', '온열치료', '고주파온열', '항암', '면역', '암',
        // 자율신경 관련
        '자율신경', '자율신경실조', '자율신경실조증',
        // 증상 관련
        '어지러움', '어지럼증', '기립성', '두통', '불면', '불면증',
        '피로', '만성피로', '스트레스', '소화', '소화불량',
        // 갱년기 관련
        '갱년기', '폐경', '호르몬', '열오름', '화병',
        // 건강/영양 관련
        '비타민', '비타민C', '영양', '영양제', '식단', '건강',
      ];

      // 검색어에서 의료 키워드 감지 및 확장
      for (const term of Array.from(searchTerms)) {
        const termLower = term.toLowerCase();
        for (const mk of medicalKeywords) {
          if (termLower.includes(mk) || mk.includes(termLower)) {
            if (!searchTerms.has(mk)) searchTerms.add(mk);
          }
        }
        // 동의어 사전에서 확장
        const syns = MEDICAL_SYNONYMS[term];
        if (syns) {
          for (const syn of syns) {
            if (!searchTerms.has(syn)) searchTerms.add(syn);
          }
        }
      }

      const allTerms = Array.from(searchTerms);
      console.log(`[MarketingRAG] YouTube search terms: ${allTerms.join(', ')}`);

      // 2. 모든 유튜브 영상 가져오기 (채널 URL 제외)
      const allVideos = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          question: string;
          answer: string;
          metadata: unknown;
          category: string;
          sourceUrl: string;
          title: string;
        }>
      >(
        `SELECT id, question, answer, metadata, category, "sourceUrl", title
         FROM "HospitalFaq"
         WHERE "isActive" = true AND "deletedAt" IS NULL
           AND "sourceUrl" IS NOT NULL
           AND ("sourceUrl" ILIKE '%youtube.com/watch%' OR "sourceUrl" ILIKE '%youtu.be/%')
           AND "sourceUrl" NOT LIKE '%@%'
         ORDER BY "createdAt" DESC`
      );

      // 3. 키워드 매칭 점수 계산 (브로드 매칭)
      const scoredVideos: Array<{
        video: typeof allVideos[0];
        score: number;
        matchedTerms: string[];
      }> = [];

      for (const video of allVideos) {
        // 검색 대상 텍스트 (띄어쓰기 제거 버전도 포함)
        const titleNoSpace = (video.title || '').replace(/\s+/g, '').toLowerCase();
        const questionNoSpace = (video.question || '').replace(/\s+/g, '').toLowerCase();
        const answerNoSpace = (video.answer || '').replace(/\s+/g, '').toLowerCase();

        const titleWithSpace = (video.title || '').toLowerCase();
        const questionWithSpace = (video.question || '').toLowerCase();
        const answerWithSpace = (video.answer || '').toLowerCase();

        let score = 0;
        const matchedTerms: string[] = [];

        for (const term of allTerms) {
          const termLower = term.toLowerCase();
          const termNoSpace = termLower.replace(/\s+/g, '');

          // 제목 매칭 (가장 높은 가중치)
          if (titleNoSpace.includes(termNoSpace) || titleWithSpace.includes(termLower)) {
            score += 10;
            matchedTerms.push(`title:${term}`);
          }
          // 질문 매칭
          if (questionNoSpace.includes(termNoSpace) || questionWithSpace.includes(termLower)) {
            score += 5;
            matchedTerms.push(`question:${term}`);
          }
          // 답변 매칭
          if (answerNoSpace.includes(termNoSpace) || answerWithSpace.includes(termLower)) {
            score += 3;
            matchedTerms.push(`answer:${term}`);
          }
        }

        // 카테고리 보너스
        if (category && category !== 'general') {
          const categoryMap: Record<string, string> = { cancer: 'CANCER', nerve: 'NERVE' };
          if (video.category === categoryMap[category]) {
            score += 2;
          }
        }

        if (score > 0) {
          scoredVideos.push({ video, score, matchedTerms });
        }
      }

      // 4. 점수순 정렬
      scoredVideos.sort((a, b) => b.score - a.score);

      // 5. 중복 URL 제거 (같은 영상에서 여러 FAQ가 있을 수 있음)
      const uniqueUrls = new Map<string, typeof scoredVideos[0]>();
      for (const item of scoredVideos) {
        const url = item.video.sourceUrl;
        if (!uniqueUrls.has(url) || uniqueUrls.get(url)!.score < item.score) {
          uniqueUrls.set(url, item);
        }
      }

      // 6. 결과가 부족하면 카테고리 기반 보충
      if (uniqueUrls.size < limit && category) {
        const categoryMap: Record<string, string> = { cancer: 'CANCER', nerve: 'NERVE' };

        // general인 경우 건강/자율신경 관련이므로 NERVE 우선, 그 다음 CANCER
        const categoriesToSearch = category === 'general'
          ? ['NERVE', 'GENERAL', 'CANCER']
          : [categoryMap[category]];

        for (const dbCategory of categoriesToSearch) {
          if (!dbCategory) continue;
          for (const video of allVideos) {
            if (video.category === dbCategory && !uniqueUrls.has(video.sourceUrl)) {
              uniqueUrls.set(video.sourceUrl, {
                video,
                score: 1,
                matchedTerms: ['category'],
              });
              if (uniqueUrls.size >= limit) break;
            }
          }
          if (uniqueUrls.size >= limit) break;
        }
      }

      // 7. 최종 결과 생성
      const results = Array.from(uniqueUrls.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(item => ({
          id: item.video.id,
          question: item.video.question,
          answer: item.video.answer,
          metadata: item.video.metadata as Record<string, unknown>,
          category: item.video.category,
          sourceUrl: item.video.sourceUrl,
          title: item.video.title,
          similarity: Math.min(item.score / 20, 1),
          type: 'youtube',
        }));

      console.log(`[MarketingRAG] YouTube search: terms=${allTerms.length}, matched=${scoredVideos.length}, unique=${uniqueUrls.size}, final=${results.length}`);

      return results;
    } catch (err) {
      console.error('[MarketingRAG] YouTube search error:', err);
      return [];
    }
  }
}
