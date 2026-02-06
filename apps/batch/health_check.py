"""
배치 헬스체크
30분 주기로 배치 실행 상태를 모니터링한다.
- 최근 배치 실행 시간 확인
- MAX_BATCH_GAP_HOURS 초과 시 알림 전송
"""
import logging
import sys
import time
from datetime import datetime, timedelta

import psycopg2
import requests
import schedule

from config import (
    ALERT_WEBHOOK_URL,
    DATABASE_URL,
    HEALTH_CHECK_INTERVAL_MINUTES,
    MAX_BATCH_GAP_HOURS,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("health_check")


def send_alert(title: str, message: str):
    """웹훅으로 알림을 전송한다."""
    if not ALERT_WEBHOOK_URL:
        logger.warning(f"알림 웹훅 미설정. 알림 내용: [{title}] {message}")
        return

    try:
        requests.post(
            ALERT_WEBHOOK_URL,
            json={"title": title, "message": message},
            timeout=10,
        )
        logger.info(f"알림 전송 완료: {title}")
    except Exception as e:
        logger.error(f"알림 전송 실패: {e}")


def check_batch_health():
    """최근 배치 실행 상태를 확인한다."""
    logger.info("배치 헬스체크 실행")

    conn = None
    try:
        conn = psycopg2.connect(DATABASE_URL)
        with conn.cursor() as cur:
            # 최근 성공한 Import 확인
            cur.execute(
                """SELECT MAX("finishedAt") FROM "Import"
                   WHERE "status" = 'SUCCESS' AND "fileType" = 'INPATIENT'"""
            )
            row = cur.fetchone()
            last_success = row[0] if row else None

            # 최근 실패한 Import 확인
            cur.execute(
                """SELECT COUNT(*) FROM "Import"
                   WHERE "status" = 'FAIL'
                     AND "createdAt" > NOW() - INTERVAL '24 hours'"""
            )
            fail_count = cur.fetchone()[0]

        now = datetime.now()

        # 배치 미실행 감지
        if last_success is None:
            # 아직 한 번도 성공한 적 없음 (초기 상태)
            logger.info("아직 성공한 배치가 없습니다.")
        else:
            gap = now - last_success
            gap_hours = gap.total_seconds() / 3600

            if gap_hours > MAX_BATCH_GAP_HOURS:
                send_alert(
                    "배치 미실행 경고",
                    f"입원현황 배치가 {gap_hours:.1f}시간 동안 실행되지 않았습니다. "
                    f"마지막 성공: {last_success.strftime('%Y-%m-%d %H:%M')}",
                )
            else:
                logger.info(
                    f"배치 정상. 마지막 성공: {last_success.strftime('%Y-%m-%d %H:%M')} "
                    f"({gap_hours:.1f}시간 전)"
                )

        # 최근 24시간 실패 건수 경고
        if fail_count > 0:
            send_alert(
                "배치 실패 감지",
                f"최근 24시간 내 {fail_count}건의 배치 실패가 발생했습니다.",
            )

    except Exception as e:
        logger.exception(f"헬스체크 오류: {e}")
        send_alert("헬스체크 오류", f"배치 헬스체크 실행 중 오류: {str(e)}")
    finally:
        if conn:
            conn.close()


def main():
    """헬스체크 스케줄러를 실행한다."""
    logger.info(f"배치 헬스체크 시작 (주기: {HEALTH_CHECK_INTERVAL_MINUTES}분)")

    schedule.every(HEALTH_CHECK_INTERVAL_MINUTES).minutes.do(check_batch_health)

    # 시작 시 즉시 1회 실행
    check_batch_health()

    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    main()
