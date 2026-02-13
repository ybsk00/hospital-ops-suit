"""
YouTube 신규 영상 자동 벡터DB화 스크립트
- 매일 자정 Cloud Scheduler에 의해 실행
- 서울온케어 유튜브 채널의 신규 영상을 감지
- 자막 추출 → Gemini FAQ 변환 → 벡터화 → HospitalFaq 저장
"""

import os
import sys
import json
import uuid
import logging
import tempfile
from datetime import datetime, timedelta, timezone

import requests
import psycopg2
from dotenv import load_dotenv

# 배치 폴더 .env → 루트 .env 순으로 로드 (루트에 YouTube/Gemini 키가 있음)
_batch_dir = os.path.dirname(os.path.abspath(__file__))
_root_env = os.path.join(_batch_dir, '..', '..', '.env')
load_dotenv(os.path.join(_batch_dir, '.env'))
load_dotenv(_root_env, override=False)

# ─── 설정 ──────────────────────────────────────────────
YOUTUBE_API_KEY = os.getenv('YOUTUBE_API_KEY')
YOUTUBE_CHANNEL_ID = os.getenv('YOUTUBE_CHANNEL_ID')
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
DATABASE_URL = os.getenv('DIRECT_URL') or os.getenv('DATABASE_URL', '').split('?')[0]

EMBEDDING_MODEL = 'gemini-embedding-001'
EMBEDDING_DIM = 768
GEMINI_LLM_MODEL = 'gemini-2.0-flash'

# 로깅
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger('youtube_sync')


# ─── 1. YouTube Data API: 신규 영상 조회 ────────────────
def fetch_recent_videos(days_back=1):
    """최근 N일 내 업로드된 영상 목록 조회"""
    kst = timezone(timedelta(hours=9))
    after = (datetime.now(kst) - timedelta(days=days_back)).strftime('%Y-%m-%dT%H:%M:%SZ')

    url = 'https://www.googleapis.com/youtube/v3/search'
    params = {
        'key': YOUTUBE_API_KEY,
        'channelId': YOUTUBE_CHANNEL_ID,
        'part': 'snippet',
        'order': 'date',
        'type': 'video',
        'publishedAfter': after,
        'maxResults': 10,
    }

    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    videos = []
    for item in data.get('items', []):
        vid = item['id'].get('videoId')
        if not vid:
            continue
        snippet = item['snippet']
        videos.append({
            'videoId': vid,
            'title': snippet.get('title', ''),
            'description': snippet.get('description', ''),
            'publishedAt': snippet.get('publishedAt', ''),
            'url': f'https://www.youtube.com/watch?v={vid}',
        })

    log.info(f'최근 {days_back}일 내 신규 영상 {len(videos)}개 발견')
    return videos


# ─── 2. 이미 처리된 영상 필터링 ──────────────────────────
def filter_new_videos(conn, videos):
    """DB에 이미 존재하는 영상 제외"""
    if not videos:
        return []

    video_ids = [v['videoId'] for v in videos]
    cur = conn.cursor()
    cur.execute(
        'SELECT "sourceVideoId" FROM "HospitalFaq" WHERE "sourceVideoId" = ANY(%s)',
        (video_ids,)
    )
    existing = {row[0] for row in cur.fetchall()}
    cur.close()

    new_videos = [v for v in videos if v['videoId'] not in existing]
    log.info(f'신규 영상 {len(new_videos)}개 (이미 처리된 영상 {len(existing)}개 스킵)')
    return new_videos


# ─── 3. 자막 추출 ──────────────────────────────────────
def get_transcript(video_id):
    """YouTube 자막 추출 (1차: 자동자막, 2차: Gemini 오디오 STT)"""
    # 1차: youtube-transcript-api 시도
    transcript = _get_youtube_captions(video_id)
    if transcript:
        log.info(f'  자동자막 추출 성공 ({len(transcript)}자)')
        return transcript

    # 2차: 음성 다운로드 → Gemini STT
    log.info(f'  자동자막 없음 → Gemini STT 시도')
    transcript = _get_gemini_stt(video_id)
    if transcript:
        log.info(f'  Gemini STT 성공 ({len(transcript)}자)')
        return transcript

    log.warning(f'  자막 추출 실패: {video_id}')
    return None


def _get_youtube_captions(video_id):
    """youtube-transcript-api로 자막 추출"""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        ytt_api = YouTubeTranscriptApi()
        transcript_list = ytt_api.fetch(video_id, languages=['ko', 'en'])
        text_parts = [snippet.text for snippet in transcript_list]
        return ' '.join(text_parts)
    except Exception as e:
        log.debug(f'  youtube-transcript-api 실패: {e}')
        return None


def _get_gemini_stt(video_id):
    """yt-dlp로 음성 다운로드 후 Gemini로 STT"""
    try:
        import yt_dlp

        # 임시 파일로 음성 다운로드
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_path = os.path.join(tmp_dir, 'audio')
            ydl_opts = {
                'format': 'bestaudio[ext=m4a]/bestaudio/best',
                'outtmpl': output_path + '.%(ext)s',
                'quiet': True,
                'no_warnings': True,
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([f'https://www.youtube.com/watch?v={video_id}'])

            # 다운로드된 오디오 파일 찾기
            audio_file = None
            for f in os.listdir(tmp_dir):
                if f.startswith('audio'):
                    audio_file = os.path.join(tmp_dir, f)
                    break

            if not audio_file:
                return None

            # Gemini로 STT
            import google.generativeai as genai
            genai.configure(api_key=GEMINI_API_KEY)
            model = genai.GenerativeModel(GEMINI_LLM_MODEL)

            uploaded = genai.upload_file(audio_file)
            response = model.generate_content([
                '이 오디오를 한국어로 정확하게 전사(transcribe)해주세요. 말한 내용을 그대로 텍스트로 변환하되, 의미가 통하도록 문장 단위로 정리해주세요.',
                uploaded
            ])

            return response.text.strip() if response.text else None

    except Exception as e:
        log.error(f'  Gemini STT 실패: {e}')
        return None


# ─── 4. Gemini: 자막 오타 수정 및 정제 ─────────────────────
def refine_transcript(title, transcript):
    """Gemini를 이용하여 자동자막의 오타 수정 및 텍스트 정제"""
    import google.generativeai as genai
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_LLM_MODEL)

    max_chars = 30000
    trimmed = transcript[:max_chars] if len(transcript) > max_chars else transcript

    prompt = f"""당신은 의료 전문 교정 편집자입니다.
아래는 유튜브 자동자막(STT)에서 추출한 텍스트입니다.
자동자막 특성상 오타, 띄어쓰기 오류, 의학 용어 오인식이 많습니다.

[작업]
1. 오타 및 맞춤법 수정 (예: "자율신경실조증" ← "자율 신경 실 조증")
2. 의학 용어 정확한 표기로 교정 (예: "PRF 주사", "PRP", "인대강화주사", "온열치료" 등)
3. 문장 부호 및 띄어쓰기 정리
4. 의미가 불명확한 부분은 문맥에 맞게 보정
5. 원본 내용을 임의로 추가하거나 삭제하지 말 것
6. 정제된 텍스트만 출력 (설명 없이)

[영상 제목]: {title}

[자동자막 원본]:
{trimmed}

[정제된 텍스트]:"""

    try:
        response = model.generate_content(prompt)
        refined = response.text.strip()
        if refined and len(refined) > 100:
            log.info(f'  텍스트 정제 완료 ({len(transcript)}자 → {len(refined)}자)')
            return refined
        return transcript
    except Exception as e:
        log.warning(f'  텍스트 정제 실패 (원본 사용): {e}')
        return transcript


# ─── 5. Gemini: 정제된 스크립트 → FAQ 변환 ───────────────
def generate_faqs(title, transcript):
    """Gemini를 이용하여 정제된 스크립트를 FAQ로 변환"""
    import google.generativeai as genai
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_LLM_MODEL)

    max_chars = 30000
    trimmed = transcript[:max_chars] if len(transcript) > max_chars else transcript

    prompt = f"""당신은 암요양병원(서울온케어의원) FAQ 작성 전문가입니다.
아래 유튜브 영상의 스크립트를 읽고, 환자가 궁금해할 FAQ를 5~10개 생성해주세요.

[규칙]
1. 각 FAQ는 반드시 아래 JSON 형식으로 출력
2. question: 환자 관점의 자연스러운 질문 (예: "암 보조치료는 어떤 건가요?")
3. answer: 전문적이지만 이해하기 쉬운 답변 (3~5문장). 의학 용어는 정확하게 표기.
4. category: 아래 중 하나 선택
   - CANCER: 암 관련 치료/검사/관리
   - NERVE: 자율신경/통증 치료
   - GENERAL: 일반 진료/병원 안내
5. 오타 없이 정확한 한국어로 작성

[영상 제목]: {title}

[스크립트]:
{trimmed}

[출력 형식] (반드시 JSON 배열만 출력, 다른 텍스트 없이):
[
  {{
    "question": "질문 내용",
    "answer": "답변 내용",
    "category": "CANCER"
  }}
]"""

    try:
        response = model.generate_content(prompt)
        text = response.text.strip()

        # JSON 파싱 (```json ... ``` 감싸기 제거)
        if text.startswith('```'):
            text = text.split('\n', 1)[1] if '\n' in text else text[3:]
        if text.endswith('```'):
            text = text[:-3]
        text = text.strip()

        faqs = json.loads(text)
        log.info(f'  FAQ {len(faqs)}개 생성 완료')
        return faqs

    except json.JSONDecodeError as e:
        log.error(f'  FAQ JSON 파싱 실패: {e}')
        log.debug(f'  원본 응답: {text[:500]}')
        return []
    except Exception as e:
        log.error(f'  FAQ 생성 실패: {e}')
        return []


# ─── 5. Gemini: 임베딩 생성 ──────────────────────────────
def embed_text(text):
    """Gemini embedding-001로 텍스트 벡터화 (768차원)"""
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{EMBEDDING_MODEL}:embedContent?key={GEMINI_API_KEY}'

    resp = requests.post(url, json={
        'content': {'parts': [{'text': text}]},
        'outputDimensionality': EMBEDDING_DIM,
    }, timeout=30)
    resp.raise_for_status()

    values = resp.json()['embedding']['values']
    return values


# ─── 6. DB 저장 ─────────────────────────────────────────
def save_faq_to_db(conn, faq, video_info):
    """FAQ를 HospitalFaq 테이블에 벡터와 함께 저장"""
    faq_id = str(uuid.uuid4())
    question = faq['question']
    answer = faq['answer']
    category = faq.get('category', 'GENERAL')

    # question을 임베딩
    vector = embed_text(question)
    vector_str = f'[{",".join(str(v) for v in vector)}]'

    metadata = json.dumps({
        'videoTitle': video_info['title'],
        'videoUrl': video_info['url'],
        'publishedAt': video_info['publishedAt'],
        'autoGenerated': True,
        'syncedAt': datetime.utcnow().isoformat(),
    }, ensure_ascii=False)

    cur = conn.cursor()
    cur.execute("""
        INSERT INTO "HospitalFaq" (
            "id", "question", "answer", "metadata", "vector",
            "category", "sourceUrl", "sourceVideoId", "title",
            "isActive", "createdAt", "updatedAt"
        ) VALUES (
            %s, %s, %s, %s::jsonb, %s::vector,
            %s::"MarketingCategory", %s, %s, %s,
            true, NOW(), NOW()
        )
    """, (
        faq_id, question, answer, metadata, vector_str,
        category, video_info['url'], video_info['videoId'], video_info['title'],
    ))
    conn.commit()
    cur.close()

    return faq_id


# ─── 메인 실행 ──────────────────────────────────────────
def sync(days_back=1):
    """메인 동기화 함수"""
    log.info('='*60)
    log.info('YouTube → 벡터DB 동기화 시작')
    log.info(f'채널: {YOUTUBE_CHANNEL_ID} | 조회 기간: 최근 {days_back}일')
    log.info('='*60)

    # 환경변수 체크
    missing = []
    if not YOUTUBE_API_KEY:  missing.append('YOUTUBE_API_KEY')
    if not YOUTUBE_CHANNEL_ID: missing.append('YOUTUBE_CHANNEL_ID')
    if not GEMINI_API_KEY: missing.append('GEMINI_API_KEY')
    if not DATABASE_URL: missing.append('DATABASE_URL')
    if missing:
        log.error(f'환경변수 누락: {", ".join(missing)}')
        return {'success': False, 'error': f'환경변수 누락: {", ".join(missing)}'}

    conn = None
    stats = {'videos_found': 0, 'videos_new': 0, 'faqs_created': 0, 'errors': []}

    try:
        # DB 연결
        conn = psycopg2.connect(DATABASE_URL)
        log.info('DB 연결 성공')

        # 1. 신규 영상 조회
        videos = fetch_recent_videos(days_back)
        stats['videos_found'] = len(videos)

        # 2. 이미 처리된 영상 필터링
        new_videos = filter_new_videos(conn, videos)
        stats['videos_new'] = len(new_videos)

        if not new_videos:
            log.info('처리할 신규 영상이 없습니다.')
            return {'success': True, **stats}

        # 3. 각 영상 처리
        for video in new_videos:
            log.info(f'\n▶ 처리 중: [{video["title"]}]')
            log.info(f'  URL: {video["url"]}')

            try:
                # 자막 추출
                transcript = get_transcript(video['videoId'])
                if not transcript:
                    stats['errors'].append(f'{video["videoId"]}: 자막 추출 실패')
                    continue

                # 오타 수정 및 텍스트 정제
                transcript = refine_transcript(video['title'], transcript)

                # 정제된 텍스트로 FAQ 생성
                faqs = generate_faqs(video['title'], transcript)
                if not faqs:
                    stats['errors'].append(f'{video["videoId"]}: FAQ 생성 실패')
                    continue

                # DB 저장
                for faq in faqs:
                    try:
                        faq_id = save_faq_to_db(conn, faq, video)
                        stats['faqs_created'] += 1
                        log.info(f'  ✓ FAQ 저장: {faq["question"][:40]}...')
                    except Exception as e:
                        log.error(f'  ✗ FAQ 저장 실패: {e}')
                        conn.rollback()
                        stats['errors'].append(f'{video["videoId"]}: DB 저장 실패 - {str(e)[:100]}')

            except Exception as e:
                log.error(f'  영상 처리 실패: {e}')
                stats['errors'].append(f'{video["videoId"]}: {str(e)[:100]}')

    except Exception as e:
        log.error(f'동기화 실패: {e}')
        stats['errors'].append(str(e)[:200])
        return {'success': False, **stats}

    finally:
        if conn:
            conn.close()

    log.info(f'\n{"="*60}')
    log.info(f'동기화 완료: 영상 {stats["videos_new"]}개 → FAQ {stats["faqs_created"]}개 생성')
    if stats['errors']:
        log.warning(f'오류 {len(stats["errors"])}건: {stats["errors"]}')
    log.info('='*60)

    return {'success': True, **stats}


if __name__ == '__main__':
    # CLI 실행: python youtube_sync.py [days_back]
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    result = sync(days_back=days)
    print(json.dumps(result, ensure_ascii=False, indent=2))
