"""
메인 배치 워커
EMR 엑셀 파일을 감시하고, 스케줄에 따라 Import 처리를 실행한다.
스케줄: 10:00, 13:10, 17:00
"""
import glob
import json
import logging
import os
import shutil
import sys
import time
from datetime import datetime

import psycopg2
import schedule

from config import (
    ARCHIVE_FOLDER,
    BATCH_SCHEDULE_TIMES,
    DATABASE_URL,
    ERROR_FOLDER,
    FOLDERS,
)
from importers.inpatient_importer import save_import_errors, upsert_patients
from importers.outpatient_importer import (
    save_import_errors as save_outpatient_errors,
    upsert_appointments,
)
from parsers.inpatient_parser import parse_inpatient_file
from parsers.outpatient_parser import parse_outpatient_file
from validators.data_validator import validate_rows
from validators.file_validator import (
    check_duplicate,
    compute_sha256,
    is_file_ready,
    validate_xlsx,
)

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("batch_worker.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger("worker")


def get_db_connection():
    """PostgreSQL 연결을 반환한다."""
    return psycopg2.connect(DATABASE_URL)


def ensure_dirs():
    """필요한 디렉토리가 없으면 생성한다."""
    for folder in FOLDERS.values():
        os.makedirs(folder, exist_ok=True)
    os.makedirs(ERROR_FOLDER, exist_ok=True)
    os.makedirs(ARCHIVE_FOLDER, exist_ok=True)


def move_to_error(file_path: str, reason: str):
    """파일을 에러 폴더로 이동한다."""
    dest = os.path.join(ERROR_FOLDER, os.path.basename(file_path))
    shutil.move(file_path, dest)
    # done 시그널 파일도 함께 이동
    done_path = file_path + ".done"
    if os.path.exists(done_path):
        shutil.move(done_path, dest + ".done")
    logger.error(f"에러 폴더로 이동: {file_path} → {dest} (사유: {reason})")


def move_to_archive(file_path: str):
    """파일을 아카이브 폴더로 이동한다."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    basename = os.path.basename(file_path)
    name, ext = os.path.splitext(basename)
    dest = os.path.join(ARCHIVE_FOLDER, f"{name}_{timestamp}{ext}")
    shutil.move(file_path, dest)
    # done 시그널 파일도 삭제
    done_path = file_path + ".done"
    if os.path.exists(done_path):
        os.remove(done_path)
    logger.info(f"아카이브 완료: {file_path} → {dest}")


def create_import_record(conn, file_path: str, file_hash: str, file_type: str) -> str:
    """Import 레코드를 생성하고 ID를 반환한다."""
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO "Import"
               ("id", "filePath", "fileHash", "fileType", "status", "startedAt", "createdAt")
               VALUES (gen_random_uuid(), %s, %s, %s, 'PROCESSING', NOW(), NOW())
               RETURNING "id" """,
            (file_path, file_hash, file_type),
        )
        import_id = cur.fetchone()[0]
    conn.commit()
    return import_id


def update_import_status(conn, import_id: str, status: str, stats: dict | None = None):
    """Import 레코드 상태를 갱신한다."""
    stats_json = json.dumps(stats, ensure_ascii=False) if stats else None
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE "Import"
               SET "status" = %s, "finishedAt" = NOW(), "statsJson" = %s::jsonb
               WHERE "id" = %s""",
            (status, stats_json, import_id),
        )
    conn.commit()


def process_inpatient_file(file_path: str):
    """입원현황 파일 하나를 처리한다."""
    logger.info(f"=== 입원현황 처리 시작: {file_path} ===")

    # 1. 파일 수신 확인
    if not is_file_ready(file_path):
        logger.info(f"파일 수신 미완료, 건너뜀: {file_path}")
        return

    # 2. XLSX 무결성 검사
    valid, err_msg = validate_xlsx(file_path)
    if not valid:
        move_to_error(file_path, err_msg)
        return

    # 3. SHA-256 중복 체크
    file_hash = compute_sha256(file_path)
    conn = get_db_connection()
    try:
        if check_duplicate(file_hash, conn):
            logger.warning(f"이미 처리된 파일 (중복): {file_path}")
            move_to_archive(file_path)
            return

        # 4. Import 레코드 생성
        import_id = create_import_record(conn, file_path, file_hash, "INPATIENT")

        try:
            # 5. 엑셀 파싱
            rows = parse_inpatient_file(file_path)

            if not rows:
                update_import_status(conn, import_id, "SUCCESS", {"total": 0, "message": "데이터 없음"})
                move_to_archive(file_path)
                return

            # 6. 데이터 검증
            valid_rows, error_rows = validate_rows(rows)

            # 7. 오류 행 기록
            if error_rows:
                save_import_errors(conn, import_id, error_rows)

            # 8. Patient upsert
            stats = upsert_patients(conn, valid_rows, import_id)
            stats["totalRows"] = len(rows)
            stats["errorRows"] = len(error_rows)

            # 9. 상태 갱신
            final_status = "SUCCESS" if not error_rows else "SUCCESS"
            if len(error_rows) == len(rows):
                final_status = "FAIL"

            update_import_status(conn, import_id, final_status, stats)
            move_to_archive(file_path)

            logger.info(f"=== 입원현황 처리 완료: {file_path} (결과: {final_status}) ===")

        except Exception as e:
            logger.exception(f"Import 처리 중 오류: {e}")
            update_import_status(conn, import_id, "FAIL", {"error": str(e)})
            move_to_error(file_path, str(e))

    finally:
        conn.close()


def run_inpatient_batch():
    """입원현황 폴더의 모든 엑셀 파일을 처리한다."""
    logger.info("========== 입원현황 배치 시작 ==========")
    folder = FOLDERS["INPATIENT"]

    if not os.path.exists(folder):
        logger.warning(f"입원현황 폴더가 없습니다: {folder}")
        return

    files = sorted(glob.glob(os.path.join(folder, "*.xlsx")))
    if not files:
        logger.info("처리할 파일이 없습니다.")
        return

    logger.info(f"대상 파일: {len(files)}개")
    for file_path in files:
        try:
            process_inpatient_file(file_path)
        except Exception as e:
            logger.exception(f"파일 처리 실패: {file_path} - {e}")

    logger.info("========== 입원현황 배치 종료 ==========")


def process_outpatient_file(file_path: str):
    """외래예약 파일 하나를 처리한다."""
    logger.info(f"=== 외래예약 처리 시작: {file_path} ===")

    # 1. 파일 수신 확인
    if not is_file_ready(file_path):
        logger.info(f"파일 수신 미완료, 건너뜀: {file_path}")
        return

    # 2. XLSX 무결성 검사
    valid, err_msg = validate_xlsx(file_path)
    if not valid:
        move_to_error(file_path, err_msg)
        return

    # 3. SHA-256 중복 체크
    file_hash = compute_sha256(file_path)
    conn = get_db_connection()
    try:
        if check_duplicate(file_hash, conn):
            logger.warning(f"이미 처리된 파일 (중복): {file_path}")
            move_to_archive(file_path)
            return

        # 4. Import 레코드 생성
        import_id = create_import_record(conn, file_path, file_hash, "OUTPATIENT")

        try:
            # 5. 엑셀 파싱
            rows = parse_outpatient_file(file_path)

            if not rows:
                update_import_status(conn, import_id, "SUCCESS", {"total": 0, "message": "데이터 없음"})
                move_to_archive(file_path)
                return

            # 6. 오류 행과 정상 행 분리
            error_rows = [r for r in rows if "_error" in r]
            valid_rows = [r for r in rows if "_error" not in r]

            # 7. 오류 행 기록
            if error_rows:
                save_outpatient_errors(conn, import_id, error_rows)

            # 8. Appointment upsert
            stats = upsert_appointments(conn, valid_rows, import_id)
            stats["totalRows"] = len(rows)
            stats["errorRows"] = len(error_rows)

            # 9. 상태 갱신
            final_status = "SUCCESS"
            if len(error_rows) == len(rows):
                final_status = "FAIL"

            update_import_status(conn, import_id, final_status, stats)
            move_to_archive(file_path)

            logger.info(f"=== 외래예약 처리 완료: {file_path} (결과: {final_status}) ===")

        except Exception as e:
            logger.exception(f"외래예약 Import 처리 중 오류: {e}")
            update_import_status(conn, import_id, "FAIL", {"error": str(e)})
            move_to_error(file_path, str(e))

    finally:
        conn.close()


def run_outpatient_batch():
    """외래예약 폴더의 모든 엑셀 파일을 처리한다."""
    logger.info("========== 외래예약 배치 시작 ==========")
    folder = FOLDERS["OUTPATIENT"]

    if not os.path.exists(folder):
        logger.warning(f"외래예약 폴더가 없습니다: {folder}")
        return

    files = sorted(glob.glob(os.path.join(folder, "*.xlsx")))
    if not files:
        logger.info("처리할 외래예약 파일이 없습니다.")
        return

    logger.info(f"대상 파일: {len(files)}개")
    for file_path in files:
        try:
            process_outpatient_file(file_path)
        except Exception as e:
            logger.exception(f"외래예약 파일 처리 실패: {file_path} - {e}")

    logger.info("========== 외래예약 배치 종료 ==========")


def main():
    """메인 엔트리포인트. 스케줄러를 실행한다."""
    logger.info("서울온케어 배치 워커 시작")
    ensure_dirs()

    # 스케줄 등록
    for time_str in BATCH_SCHEDULE_TIMES:
        schedule.every().day.at(time_str).do(run_inpatient_batch)
        schedule.every().day.at(time_str).do(run_outpatient_batch)
        logger.info(f"스케줄 등록: 매일 {time_str} (입원현황 + 외래예약)")

    # 시작 시 즉시 1회 실행 (개발 편의)
    if "--run-now" in sys.argv:
        logger.info("즉시 실행 모드 (--run-now)")
        run_inpatient_batch()
        run_outpatient_batch()

    # 스케줄 루프
    logger.info("스케줄러 대기 중...")
    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    main()
