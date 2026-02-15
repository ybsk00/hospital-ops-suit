"""
PubMed 논문 → 벡터DB 자동 동기화 스크립트
- 암환자 보조치료(고주파온열, 고압산소, 이뮨셀, 세레늄, 싸이모신, 미슬토, 폴리사카라이드, 고용량비타민C)
- 긍정적 효과를 보고한 논문만 수집
- 영문 초록/결론 → Gemini FAQ 변환 (인용 포함) → 벡터화 → Embedding + HospitalFaq 저장
"""

import os
import sys
import json
import logging
import argparse
import time
import re
from datetime import datetime
from typing import List, Dict, Optional
from xml.etree import ElementTree as ET

import requests
import psycopg2
from dotenv import load_dotenv

# ─── 환경 로드 ─────────────────────────────────────────
_batch_dir = os.path.dirname(os.path.abspath(__file__))
_root_env = os.path.join(_batch_dir, '..', '..', '.env')
load_dotenv(os.path.join(_batch_dir, '.env'))
load_dotenv(_root_env, override=False)

# ─── 설정 ──────────────────────────────────────────────
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
DATABASE_URL = os.getenv('DIRECT_URL') or os.getenv('DATABASE_URL', '').split('?')[0]
NCBI_API_KEY = os.getenv('NCBI_API_KEY', '')
NCBI_EMAIL = os.getenv('NCBI_EMAIL', 'admin@seouloncare.com')
NCBI_TOOL = os.getenv('NCBI_TOOL', 'seoul-oncare-rag')

EMBEDDING_MODEL = 'gemini-embedding-001'
EMBEDDING_DIM = 768
GEMINI_LLM_MODEL = 'gemini-2.0-flash'

PUBMED_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

# ─── 치료법별 검색 쿼리 (약물명/성분명 기반, 암 보조치료 초점) ───
TREATMENT_QUERIES = {
    'hyperthermia': {
        'name_ko': '고주파온열치료',
        'query': (
            '(hyperthermia OR "radiofrequency ablation" OR thermotherapy OR "regional hyperthermia") '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (adjuvant OR complementary OR "combined therapy" OR "concurrent") '
            'AND (survival OR effective OR beneficial OR improvement OR "tumor response")'
        ),
    },
    'hyperbaric_oxygen': {
        'name_ko': '고압산소치료',
        'query': (
            '("hyperbaric oxygen" OR HBOT OR "hyperbaric oxygenation") '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (adjuvant OR complementary OR supportive OR radiosensitiz*) '
            'AND (effective OR beneficial OR improvement OR survival)'
        ),
    },
    'immuncell': {
        'name_ko': '면역세포치료(이뮨셀)',
        'query': (
            '("activated T cell" OR "cytokine-induced killer" OR CIK '
            'OR "natural killer cell" OR "NK cell therapy" OR "adoptive cell therapy" '
            'OR "dendritic cell vaccine") '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (adjuvant OR adjunctive OR postoperative) '
            'AND (survival OR response OR benefit OR "disease-free")'
        ),
    },
    'selenium': {
        'name_ko': '세레늄',
        'query': (
            '(selenium OR "sodium selenite" OR selenomethionine OR "selenium supplementation") '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (adjuvant OR supplementation OR complementary OR supportive) '
            'AND (survival OR protective OR beneficial OR "side effect reduction")'
        ),
    },
    'thymosin': {
        'name_ko': '싸이모신',
        'query': (
            '("thymosin alpha-1" OR "thymosin alpha 1" OR "thymalin" OR "thymic peptide" '
            'OR "thymosin fraction 5" OR zadaxin) '
            'AND (cancer OR tumor OR neoplasm OR hepatocellular) '
            'AND (adjuvant OR immunotherapy OR complementary) '
            'AND (survival OR immune OR beneficial OR response)'
        ),
    },
    'mistletoe': {
        'name_ko': '미슬토',
        'query': (
            '("Viscum album" OR "mistletoe extract" OR iscador OR helixor '
            'OR abnobaviscum OR "Viscum album extract") '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (adjuvant OR complementary OR integrative) '
            'AND (survival OR "quality of life" OR beneficial OR "immune modulation")'
        ),
    },
    'polysaccharide': {
        'name_ko': '폴리사카라이드',
        'query': (
            '(polysaccharide OR "beta-glucan" OR lentinan OR PSK '
            'OR "polysaccharide-K" OR krestin OR "polysaccharopeptide") '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (adjuvant OR complementary OR immunotherapy) '
            'AND (survival OR response OR beneficial OR "immune enhancement")'
        ),
    },
    'vitamin_c': {
        'name_ko': '고용량비타민C',
        'query': (
            '("high-dose vitamin C" OR "ascorbic acid" OR "intravenous vitamin C" '
            'OR "IV vitamin C" OR "pharmacologic ascorbate" OR "high dose ascorbate") '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (adjuvant OR complementary OR supportive OR "combined") '
            'AND (survival OR effective OR beneficial OR "quality of life" OR "tumor response")'
        ),
    },
    # ── 암환자 권장 음식/영양소 ──
    'green_tea': {
        'name_ko': '녹차(EGCG)',
        'query': (
            '("green tea" OR EGCG OR "epigallocatechin gallate" OR catechin) '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (prevention OR protective OR adjuvant OR supplementation) '
            'AND (survival OR beneficial OR "risk reduction" OR antioxidant OR apoptosis)'
        ),
    },
    'curcumin': {
        'name_ko': '강황/커큐민',
        'query': (
            '(curcumin OR turmeric OR "Curcuma longa") '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (adjuvant OR complementary OR dietary OR supplementation) '
            'AND (survival OR beneficial OR "tumor suppression" OR anti-inflammatory OR apoptosis)'
        ),
    },
    'cruciferous': {
        'name_ko': '십자화과채소(브로콜리)',
        'query': (
            '(sulforaphane OR broccoli OR "cruciferous vegetable" OR glucosinolate '
            'OR "indole-3-carbinol" OR "Brassica") '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (prevention OR protective OR dietary OR chemopreventive) '
            'AND (survival OR beneficial OR "risk reduction" OR apoptosis)'
        ),
    },
    'omega3': {
        'name_ko': '오메가3지방산',
        'query': (
            '("omega-3" OR "fish oil" OR EPA OR DHA OR "n-3 fatty acid" '
            'OR "eicosapentaenoic" OR "docosahexaenoic") '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (adjuvant OR supplementation OR dietary OR supportive) '
            'AND (survival OR beneficial OR "quality of life" OR anti-inflammatory OR cachexia)'
        ),
    },
    'mushroom': {
        'name_ko': '약용버섯(영지/표고)',
        'query': (
            '("Ganoderma lucidum" OR reishi OR "Lentinula edodes" OR shiitake '
            'OR "Trametes versicolor" OR "turkey tail" OR "Agaricus blazei" '
            'OR "medicinal mushroom") '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (adjuvant OR complementary OR immunotherapy OR dietary) '
            'AND (survival OR immune OR beneficial OR "quality of life")'
        ),
    },
    'garlic': {
        'name_ko': '마늘/알리신',
        'query': (
            '(garlic OR allicin OR "Allium sativum" OR "diallyl sulfide" '
            'OR "S-allylcysteine" OR "aged garlic") '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (prevention OR protective OR dietary OR chemopreventive) '
            'AND (survival OR beneficial OR "risk reduction" OR apoptosis OR antioxidant)'
        ),
    },
    'probiotics': {
        'name_ko': '유산균/프로바이오틱스',
        'query': (
            '(probiotics OR Lactobacillus OR Bifidobacterium OR "fermented food" '
            'OR "gut microbiota" OR synbiotics) '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (adjuvant OR supportive OR complementary OR "side effect") '
            'AND (survival OR beneficial OR "quality of life" OR "immune modulation" OR "treatment toxicity")'
        ),
    },
    'ginger': {
        'name_ko': '생강/진저롤',
        'query': (
            '(ginger OR gingerol OR "Zingiber officinale" OR shogaol) '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (adjuvant OR supportive OR complementary OR antiemetic) '
            'AND (nausea OR beneficial OR "quality of life" OR anti-inflammatory OR apoptosis)'
        ),
    },
    'berry': {
        'name_ko': '베리류(블루베리/아로니아)',
        'query': (
            '(blueberry OR anthocyanin OR aronia OR "berry extract" '
            'OR "Vaccinium" OR "chokeberry" OR "berry polyphenol") '
            'AND (cancer OR tumor OR neoplasm) '
            'AND (prevention OR protective OR dietary OR chemopreventive) '
            'AND (survival OR beneficial OR "risk reduction" OR antioxidant OR apoptosis)'
        ),
    },
    'soy': {
        'name_ko': '콩/이소플라본',
        'query': (
            '(soy OR isoflavone OR genistein OR daidzein OR "soy protein" '
            'OR "soybean" OR tofu) '
            'AND (cancer OR tumor OR neoplasm OR "breast cancer") '
            'AND (prevention OR protective OR dietary OR supplementation) '
            'AND (survival OR beneficial OR "risk reduction" OR "recurrence")'
        ),
    },
    # ── 자율신경실조증 ──
    'dysautonomia_cause': {
        'name_ko': '자율신경실조증(원인)',
        'query': (
            '(dysautonomia OR "autonomic dysfunction" OR "autonomic neuropathy" '
            'OR "autonomic nervous system disorder" OR "autonomic imbalance" '
            'OR "sympathovagal imbalance") '
            'AND (etiology OR cause OR pathophysiology OR "risk factor" OR mechanism) '
            'AND (stress OR fatigue OR diabetes OR autoimmune OR "lifestyle" OR aging)'
        ),
    },
    'dysautonomia_symptom': {
        'name_ko': '자율신경실조증(증상)',
        'query': (
            '(dysautonomia OR "autonomic dysfunction" OR "autonomic neuropathy" '
            'OR "autonomic nervous system disorder") '
            'AND (symptom OR manifestation OR presentation OR clinical) '
            'AND (fatigue OR headache OR insomnia OR "heart palpitation" OR tachycardia '
            'OR "digestive disorder" OR dizziness OR "cold extremities" OR sweating '
            'OR "orthostatic hypotension" OR syncope)'
        ),
    },
    'dysautonomia_diagnosis': {
        'name_ko': '자율신경실조증(진단)',
        'query': (
            '(dysautonomia OR "autonomic dysfunction" OR "autonomic neuropathy") '
            'AND (diagnosis OR assessment OR "autonomic testing" OR "heart rate variability" '
            'OR "tilt table test" OR "Valsalva maneuver" OR biomarker) '
            'AND (sensitivity OR specificity OR accuracy OR evaluation OR screening)'
        ),
    },
    'dysautonomia_treatment': {
        'name_ko': '자율신경실조증(치료)',
        'query': (
            '(dysautonomia OR "autonomic dysfunction" OR "autonomic neuropathy" '
            'OR "autonomic nervous system disorder") '
            'AND (treatment OR therapy OR management OR intervention OR rehabilitation) '
            'AND (pharmacotherapy OR "lifestyle modification" OR exercise OR "cognitive behavioral" '
            'OR biofeedback OR "heart rate variability training" OR improvement OR recovery)'
        ),
    },
    'dysautonomia_cancer': {
        'name_ko': '자율신경실조증(암환자)',
        'query': (
            '(dysautonomia OR "autonomic dysfunction" OR "autonomic neuropathy" '
            'OR "cancer-related autonomic") '
            'AND (cancer OR tumor OR neoplasm OR "cancer patient" OR "cancer survivor" '
            'OR chemotherapy OR "paraneoplastic") '
            'AND (symptom OR management OR treatment OR "quality of life" OR fatigue OR neuropathy)'
        ),
    },
}

# ─── 로깅 ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('pubmed_sync')


# ═══════════════════════════════════════════════════════
#  1. PubMed API
# ═══════════════════════════════════════════════════════

def search_pubmed(query: str, max_results: int = 10, years: int = 5) -> List[str]:
    """ESearch: 검색어로 PMID 목록 조회"""
    params = {
        'db': 'pubmed',
        'term': query,
        'retmax': max_results,
        'retmode': 'json',
        'sort': 'relevance',
        'datetype': 'pdat',
        'reldate': years * 365,
        'email': NCBI_EMAIL,
        'tool': NCBI_TOOL,
    }
    if NCBI_API_KEY:
        params['api_key'] = NCBI_API_KEY

    resp = requests.get(f'{PUBMED_BASE}/esearch.fcgi', params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    pmids = data.get('esearchresult', {}).get('idlist', [])
    total = data.get('esearchresult', {}).get('count', '0')
    log.info(f'  검색 결과: {total}건 중 상위 {len(pmids)}건 조회')
    return pmids


def fetch_articles(pmids: List[str]) -> List[Dict]:
    """EFetch: PMID 목록으로 논문 메타데이터(XML) 조회 및 파싱"""
    if not pmids:
        return []

    params = {
        'db': 'pubmed',
        'id': ','.join(pmids),
        'retmode': 'xml',
        'email': NCBI_EMAIL,
        'tool': NCBI_TOOL,
    }
    if NCBI_API_KEY:
        params['api_key'] = NCBI_API_KEY

    resp = requests.get(f'{PUBMED_BASE}/efetch.fcgi', params=params, timeout=60)
    resp.raise_for_status()

    root = ET.fromstring(resp.content)
    articles = []

    for elem in root.findall('.//PubmedArticle'):
        article = _parse_article(elem)
        if article:
            articles.append(article)

    return articles


def _parse_article(xml) -> Optional[Dict]:
    """PubMed XML 요소에서 논문 정보 추출"""
    try:
        pmid_elem = xml.find('.//PMID')
        if pmid_elem is None:
            return None
        pmid = pmid_elem.text

        # 제목
        title_elem = xml.find('.//ArticleTitle')
        title = ''.join(title_elem.itertext()).strip() if title_elem is not None else ''
        if not title:
            return None

        # 저자 (상위 3명 + et al.)
        author_elems = xml.findall('.//Author')
        authors = []
        for a in author_elems[:3]:
            last = a.findtext('LastName', '')
            initials = a.findtext('Initials', '')
            if last:
                authors.append(f'{last} {initials}' if initials else last)
        author_str = ', '.join(authors)
        if len(author_elems) > 3:
            author_str += ' et al.'

        # 저널 / 연도
        journal = xml.findtext('.//Journal/Title', '')
        # ISOAbbreviation이 더 깔끔할 수 있음
        journal_abbr = xml.findtext('.//Journal/ISOAbbreviation', '')
        journal_display = journal_abbr or journal
        year = xml.findtext('.//PubDate/Year', '')
        if not year:
            medline_date = xml.findtext('.//PubDate/MedlineDate', '')
            year = medline_date[:4] if medline_date else ''

        # 초록 (구조화된 섹션 포함)
        abstract_parts = []
        for ab in xml.findall('.//Abstract/AbstractText'):
            label = ab.get('Label', '')
            text = ''.join(ab.itertext()).strip()
            if label:
                abstract_parts.append(f'{label}: {text}')
            else:
                abstract_parts.append(text)
        abstract = '\n'.join(abstract_parts)

        # DOI
        doi = None
        for aid in xml.findall('.//ArticleIdList/ArticleId'):
            if aid.get('IdType') == 'doi':
                doi = aid.text
                break

        # 언어 필터 (영어만)
        lang = xml.findtext('.//Language', 'eng')
        if lang.lower() not in ('eng', 'en'):
            log.debug(f'  PMID {pmid}: 영문 아님({lang}), 스킵')
            return None

        # 초록 최소 길이 체크
        if not abstract or len(abstract) < 100:
            log.debug(f'  PMID {pmid}: 초록 없음 또는 너무 짧음, 스킵')
            return None

        return {
            'pmid': pmid,
            'title': title,
            'authors': author_str,
            'journal': journal_display,
            'year': year,
            'abstract': abstract,
            'doi': doi,
        }

    except Exception as e:
        log.warning(f'  논문 XML 파싱 실패: {e}')
        return None


# ═══════════════════════════════════════════════════════
#  2. 중복 감지
# ═══════════════════════════════════════════════════════

def filter_existing(conn, articles: List[Dict]) -> List[Dict]:
    """이미 DB에 존재하는 PMID 제외"""
    if not articles:
        return []

    pmids = [a['pmid'] for a in articles]
    cur = conn.cursor()

    # HospitalFaq 테이블에서 기존 PMID 체크
    cur.execute(
        "SELECT DISTINCT metadata->>'pmid' FROM \"HospitalFaq\" "
        "WHERE metadata->>'sourceType' = 'pubmed' AND metadata->>'pmid' = ANY(%s) "
        'AND "deletedAt" IS NULL',
        (pmids,),
    )
    existing = {row[0] for row in cur.fetchall() if row[0]}

    cur.close()
    new_articles = [a for a in articles if a['pmid'] not in existing]
    skipped = len(articles) - len(new_articles)
    if skipped:
        log.info(f'  기존 {skipped}건 스킵, 신규 {len(new_articles)}건')
    return new_articles


# ═══════════════════════════════════════════════════════
#  3. Gemini LLM: 긍정/부정 판별 + FAQ 생성
# ═══════════════════════════════════════════════════════

def _gemini_generate(prompt: str) -> str:
    """Gemini 2.0 Flash API 호출"""
    url = (
        f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_LLM_MODEL}'
        f':generateContent?key={GEMINI_API_KEY}'
    )
    body = {
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {'temperature': 0.3, 'maxOutputTokens': 2048},
    }
    resp = requests.post(url, json=body, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    candidates = data.get('candidates', [])
    if not candidates:
        raise ValueError('Gemini 응답에 candidates 없음')
    parts = candidates[0].get('content', {}).get('parts', [])
    if not parts:
        raise ValueError('Gemini 응답에 text 없음')
    return parts[0].get('text', '').strip()


def classify_sentiment(article: Dict, treatment_ko: str, lenient: bool = False) -> str:
    """논문 초록을 분석하여 POSITIVE / NEGATIVE / NEUTRAL 판별
    lenient=True: 질환 정보성 논문 (자율신경실조증 등)은 유용한 정보 제공 여부로 판별
    """
    if lenient:
        prompt = f"""You are a biomedical research analyst. Read the following PubMed abstract and classify whether the study provides USEFUL, NOT_USEFUL, or HARMFUL information about the disease/condition.

[Article]
Title: {article['title']}
Topic: {treatment_ko}
Abstract:
{article['abstract'][:3000]}

[Instructions]
- POSITIVE: The study provides useful, informative, or clinically relevant information about the disease (causes, symptoms, diagnosis, treatment options, management strategies, prognosis, patient outcomes, or quality of life).
- NEGATIVE: The study provides misleading information, promotes unproven treatments, or the content is irrelevant to the topic.
- NEUTRAL: The study is purely methodological, animal-only with no clinical relevance, or too technical for patient education.

Respond with ONLY one word: POSITIVE, NEGATIVE, or NEUTRAL"""
    else:
        prompt = f"""You are a biomedical research analyst. Read the following PubMed abstract and classify whether the study reports a POSITIVE, NEGATIVE, or NEUTRAL outcome for the treatment as an adjuvant/complementary cancer therapy.

[Article]
Title: {article['title']}
Treatment category: {treatment_ko}
Abstract:
{article['abstract'][:3000]}

[Instructions]
- POSITIVE: The study concludes that the treatment shows beneficial effects for cancer patients (e.g., improved survival, tumor response, immune enhancement, quality of life improvement, reduced side effects).
- NEGATIVE: The study concludes that the treatment shows no benefit, harmful effects, or recommends against its use.
- NEUTRAL: The study is inconclusive, a methodology paper, or a review without a clear positive/negative conclusion.

Respond with ONLY one word: POSITIVE, NEGATIVE, or NEUTRAL"""

    try:
        result = _gemini_generate(prompt)
        # 첫 단어만 추출
        sentiment = result.strip().split()[0].upper().rstrip('.,;:')
        if sentiment in ('POSITIVE', 'NEGATIVE', 'NEUTRAL'):
            return sentiment
        # 문장에서 키워드 검색
        upper = result.upper()
        if 'POSITIVE' in upper:
            return 'POSITIVE'
        if 'NEGATIVE' in upper:
            return 'NEGATIVE'
        return 'NEUTRAL'
    except Exception as e:
        log.warning(f'    감성 분류 실패 (PMID {article["pmid"]}): {e}')
        return 'NEUTRAL'


def generate_faqs(article: Dict, treatment_key: str, treatment_ko: str) -> List[Dict]:
    """긍정적 논문을 한국어 FAQ로 변환 (인용 포함)"""
    citation = f'{article["authors"]}. {article["journal"]}. {article["year"]}'
    citation_full = f'{citation}. PMID: {article["pmid"]}'
    if article['doi']:
        citation_full += f', DOI: {article["doi"]}'

    prompt = f"""당신은 암 치료 연구를 환자 친화적인 한국어 FAQ로 변환하는 전문가입니다.

아래 PubMed 논문의 초록을 읽고, 환자가 궁금해할 FAQ 1~3개를 생성하세요.

[논문 정보]
제목: {article['title']}
저자: {article['authors']}
학술지: {article['journal']} ({article['year']})
PMID: {article['pmid']}
치료법: {treatment_ko}

[초록]
{article['abstract'][:3000]}

[생성 규칙]
1. 각 FAQ는 JSON 형식으로 출력
2. question: 환자가 물어볼 만한 자연스러운 한국어 질문
   예: "{treatment_ko}는 암 치료에 어떤 도움이 되나요?"
3. answer: 논문 내용을 바탕으로 이해하기 쉬운 한국어 설명 (3~5문장)
   - 암환자의 **보조치료**로서의 효과에 초점
   - 과장하지 말고 논문 결과를 정확히 전달
   - 반드시 답변 마지막에 출처 명시: "(출처: {citation_full})"
4. category: "CANCER"
5. 논문 1개당 1~3개 FAQ (중복 질문 지양)

[출력 형식] (JSON 배열만 출력, 다른 텍스트 없이):
[
  {{
    "question": "질문",
    "answer": "답변... (출처: {citation_full})",
    "category": "CANCER"
  }}
]"""

    try:
        text = _gemini_generate(prompt)

        # 마크다운 코드 블록 제거
        if '```' in text:
            match = re.search(r'```(?:json)?\s*\n?(.*?)```', text, re.DOTALL)
            if match:
                text = match.group(1).strip()
        text = text.strip()

        faqs = json.loads(text)
        if not isinstance(faqs, list):
            faqs = [faqs]

        # 각 FAQ에 치료법 태그 추가
        for faq in faqs:
            faq['treatment'] = treatment_key

        log.info(f'    FAQ {len(faqs)}개 생성')
        return faqs

    except json.JSONDecodeError as e:
        log.error(f'    FAQ JSON 파싱 실패 (PMID {article["pmid"]}): {e}')
        return []
    except Exception as e:
        log.error(f'    FAQ 생성 실패 (PMID {article["pmid"]}): {e}')
        return []


# ═══════════════════════════════════════════════════════
#  4. Gemini Embedding
# ═══════════════════════════════════════════════════════

def embed_text(text: str) -> List[float]:
    """Gemini embedding-001로 텍스트 벡터화 (768차원)"""
    url = (
        f'https://generativelanguage.googleapis.com/v1beta/models/{EMBEDDING_MODEL}'
        f':embedContent?key={GEMINI_API_KEY}'
    )
    resp = requests.post(
        url,
        json={
            'content': {'parts': [{'text': text}]},
            'outputDimensionality': EMBEDDING_DIM,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()['embedding']['values']


# ═══════════════════════════════════════════════════════
#  5. DB 저장 (HospitalFaq — 환자 챗봇용)
# ═══════════════════════════════════════════════════════

def save_to_db(conn, article: Dict, faqs: List[Dict], treatment_key: str, treatment_ko: str):
    """HospitalFaq 테이블에 저장 (환자 챗봇용)"""
    cur = conn.cursor()
    saved = 0

    for idx, faq in enumerate(faqs):
        try:
            vec_faq = embed_text(faq['question'])
            vec_faq_str = '[' + ','.join(str(v) for v in vec_faq) + ']'

            faq_metadata = json.dumps({
                'pmid': article['pmid'],
                'doi': article.get('doi'),
                'authors': article['authors'],
                'journal': article['journal'],
                'year': article['year'],
                'title': article['title'],
                'treatment': treatment_key,
                'treatmentKo': treatment_ko,
                'sourceType': 'pubmed',
                'autoGenerated': True,
                'syncedAt': datetime.utcnow().isoformat(),
            }, ensure_ascii=False)

            source_url = f'https://pubmed.ncbi.nlm.nih.gov/{article["pmid"]}/'

            cur.execute(
                """
                INSERT INTO "HospitalFaq" (
                    "id", "question", "answer", "metadata", "vector",
                    "category", "sourceUrl", "title",
                    "isActive", "createdAt", "updatedAt"
                ) VALUES (
                    gen_random_uuid()::text, %s, %s, %s::jsonb, %s::vector,
                    %s::"MarketingCategory", %s, %s,
                    true, NOW(), NOW()
                )
                """,
                (
                    faq['question'],
                    faq['answer'],
                    faq_metadata,
                    vec_faq_str,
                    faq.get('category', 'CANCER'),
                    source_url,
                    article['title'][:200],
                ),
            )

            conn.commit()
            saved += 1
            log.info(f'    -> 저장 완료: {faq["question"][:50]}...')

        except Exception as e:
            conn.rollback()
            log.error(f'    -> 저장 실패 (PMID {article["pmid"]}, FAQ#{idx}): {e}')

    cur.close()
    return saved


# ═══════════════════════════════════════════════════════
#  6. 메인 동기화 로직
# ═══════════════════════════════════════════════════════

def sync(
    treatments: List[str],
    max_per_treatment: int = 10,
    years: int = 5,
    dry_run: bool = False,
) -> Dict:
    """메인 동기화 함수"""
    log.info('=' * 60)
    log.info('PubMed → 벡터DB 동기화 시작')
    log.info(f'치료법: {", ".join(treatments)}')
    log.info(f'치료법당 최대 논문: {max_per_treatment}편 | 최근 {years}년')
    if dry_run:
        log.info('[DRY-RUN 모드] DB 저장 없이 시뮬레이션만 실행')
    log.info('=' * 60)

    # 환경변수 체크
    missing = []
    if not GEMINI_API_KEY:
        missing.append('GEMINI_API_KEY')
    if not DATABASE_URL and not dry_run:
        missing.append('DATABASE_URL')
    if missing:
        log.error(f'환경변수 누락: {", ".join(missing)}')
        return {'success': False, 'error': f'환경변수 누락: {", ".join(missing)}'}

    conn = None
    stats = {
        'treatments_processed': 0,
        'articles_searched': 0,
        'articles_new': 0,
        'articles_positive': 0,
        'articles_negative_skipped': 0,
        'articles_neutral_skipped': 0,
        'faqs_created': 0,
        'errors': [],
    }

    try:
        if not dry_run:
            conn = psycopg2.connect(DATABASE_URL)
            log.info('DB 연결 성공')

        for treatment in treatments:
            if treatment not in TREATMENT_QUERIES:
                log.warning(f'\n알 수 없는 치료법: {treatment}, 스킵')
                continue

            tconfig = TREATMENT_QUERIES[treatment]
            treatment_ko = tconfig['name_ko']
            query = tconfig['query']

            log.info(f'\n{"─" * 50}')
            log.info(f'▶ {treatment_ko} ({treatment})')
            log.info(f'{"─" * 50}')

            stats['treatments_processed'] += 1

            try:
                # 1) PubMed 검색
                pmids = search_pubmed(query, max_results=max_per_treatment, years=years)
                if not pmids:
                    log.info('  검색 결과 없음')
                    continue
                time.sleep(0.4)  # NCBI rate limit

                # 2) 메타데이터 추출
                articles = fetch_articles(pmids)
                stats['articles_searched'] += len(articles)
                log.info(f'  메타데이터 추출: {len(articles)}건')

                if not articles:
                    continue
                time.sleep(0.4)

                # 3) 중복 필터링
                if conn:
                    articles = filter_existing(conn, articles)
                stats['articles_new'] += len(articles)

                if not articles:
                    log.info('  신규 논문 없음')
                    continue

                # 4) 각 논문 처리
                for article in articles:
                    log.info(f'\n  ┌ PMID: {article["pmid"]}')
                    log.info(f'  │ {article["title"][:70]}...' if len(article['title']) > 70 else f'  │ {article["title"]}')
                    log.info(f'  │ {article["authors"]} | {article["journal"]} ({article["year"]})')

                    # 4a) 긍정/부정 판별
                    # 자율신경실조증 등 질환 카테고리는 lenient 모드 (유용한 정보면 통과)
                    LENIENT_KEYS = {'dysautonomia_cause', 'dysautonomia_symptom',
                                    'dysautonomia_diagnosis', 'dysautonomia_treatment',
                                    'dysautonomia_cancer'}
                    is_lenient = treatment in LENIENT_KEYS
                    sentiment = classify_sentiment(article, treatment_ko, lenient=is_lenient)
                    log.info(f'  │ 감성 판별: {sentiment}' + (' (완화 기준)' if is_lenient else ''))

                    if sentiment == 'NEGATIVE':
                        stats['articles_negative_skipped'] += 1
                        log.info(f'  [SKIP] 부정적 논문')
                        time.sleep(0.5)
                        continue
                    elif sentiment == 'NEUTRAL' and not is_lenient:
                        stats['articles_neutral_skipped'] += 1
                        log.info(f'  [SKIP] 중립 논문')
                        time.sleep(0.5)
                        continue
                    elif sentiment == 'NEUTRAL' and is_lenient:
                        stats['articles_neutral_skipped'] += 1
                        log.info(f'  [SKIP] 중립 논문 (완화 기준에서도 제외)')
                        time.sleep(0.5)
                        continue

                    stats['articles_positive'] += 1
                    log.info(f'  [OK] 긍정적 논문 -> FAQ 생성')
                    time.sleep(0.5)

                    # 4b) FAQ 생성
                    faqs = generate_faqs(article, treatment, treatment_ko)
                    if not faqs:
                        stats['errors'].append(f'PMID {article["pmid"]}: FAQ 생성 실패')
                        log.info(f'  └ FAQ 생성 실패')
                        continue

                    # 4c) DB 저장
                    if dry_run:
                        for faq in faqs:
                            log.info(f'    [DRY-RUN] Q: {faq["question"][:60]}')
                            log.info(f'    [DRY-RUN] A: {faq["answer"][:80]}...')
                        stats['faqs_created'] += len(faqs)
                        log.info(f'  └ [DRY-RUN] FAQ {len(faqs)}개 (저장 안함)')
                    else:
                        saved = save_to_db(conn, article, faqs, treatment, treatment_ko)
                        stats['faqs_created'] += saved
                        log.info(f'  └ FAQ {saved}개 저장 완료')

                    time.sleep(1)  # Gemini rate limit

            except Exception as e:
                log.error(f'  치료법 처리 실패 ({treatment}): {e}')
                stats['errors'].append(f'{treatment}: {str(e)[:100]}')

    except Exception as e:
        log.error(f'동기화 실패: {e}')
        stats['errors'].append(str(e)[:200])
        return {'success': False, **stats}

    finally:
        if conn:
            conn.close()

    # 결과 요약
    log.info(f'\n{"=" * 60}')
    log.info('동기화 완료')
    log.info(f'  치료법: {stats["treatments_processed"]}개')
    log.info(f'  검색된 논문: {stats["articles_searched"]}편')
    log.info(f'  신규 논문: {stats["articles_new"]}편')
    log.info(f'  긍정적 (FAQ 생성): {stats["articles_positive"]}편')
    log.info(f'  부정적 (스킵): {stats["articles_negative_skipped"]}편')
    log.info(f'  중립 (스킵): {stats["articles_neutral_skipped"]}편')
    log.info(f'  생성된 FAQ: {stats["faqs_created"]}건')
    if dry_run:
        log.info('  [DRY-RUN] 실제 DB 저장 없음')
    if stats['errors']:
        log.warning(f'  오류: {len(stats["errors"])}건')
        for err in stats['errors'][:5]:
            log.warning(f'    - {err}')
    log.info('=' * 60)

    return {'success': True, **stats}


# ═══════════════════════════════════════════════════════
#  CLI
# ═══════════════════════════════════════════════════════

if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='PubMed 암 보조치료 논문 → 벡터DB 동기화',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
사용 예시:
  python pubmed_sync.py -t all -n 10              # 전체 치료법, 치료법당 10편
  python pubmed_sync.py -t hyperthermia vitamin_c  # 특정 치료법만
  python pubmed_sync.py --dry-run -t all -n 5      # 시뮬레이션 (DB 저장 안함)
  python pubmed_sync.py -t all -n 30 --years 10    # 최근 10년 논문

치료법 키워드:
  hyperthermia      고주파온열치료
  hyperbaric_oxygen 고압산소치료
  immuncell         면역세포치료(이뮨셀)
  selenium          세레늄
  thymosin          싸이모신
  mistletoe         미슬토
  polysaccharide    폴리사카라이드
  vitamin_c         고용량비타민C
        """,
    )
    parser.add_argument(
        '--treatments', '-t',
        nargs='+',
        choices=list(TREATMENT_QUERIES.keys()) + ['all'],
        default=['all'],
        help='치료법 선택 (기본: all)',
    )
    parser.add_argument(
        '--max-per-treatment', '-n',
        type=int,
        default=10,
        help='치료법당 최대 논문 수 (기본: 10)',
    )
    parser.add_argument(
        '--years', '-y',
        type=int,
        default=5,
        help='최근 N년 이내 논문 (기본: 5)',
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='DB에 저장하지 않고 시뮬레이션만 실행',
    )

    args = parser.parse_args()

    # 'all' 처리
    targets = list(TREATMENT_QUERIES.keys()) if 'all' in args.treatments else args.treatments

    result = sync(
        treatments=targets,
        max_per_treatment=args.max_per_treatment,
        years=args.years,
        dry_run=args.dry_run,
    )

    # JSON 결과 출력
    print('\n' + json.dumps(result, ensure_ascii=False, indent=2))
