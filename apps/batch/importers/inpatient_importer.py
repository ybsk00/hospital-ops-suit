"""
입원현황 데이터 Importer
파싱 + 검증된 데이터를 DB에 upsert한다.
- Patient 테이블 upsert (emrPatientId 기준)
- 인적사항 변경 시 IDENTITY_CONFLICT 생성
- Import / ImportError 테이블 기록
"""
import json
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


def upsert_patients(
    conn,
    valid_rows: list[dict[str, Any]],
    import_id: str,
) -> dict[str, int]:
    """
    유효한 행들을 Patient 테이블에 upsert한다.
    Returns: {"created": n, "updated": n, "conflicts": n, "skipped": n}
    """
    stats = {"created": 0, "updated": 0, "conflicts": 0, "skipped": 0}

    with conn.cursor() as cur:
        for row in valid_rows:
            emr_id = row["emrPatientId"]
            name = row["name"]
            dob = row["dob"]
            sex = row["sex"]
            phone = row.get("phone")

            # 기존 환자 조회
            cur.execute(
                'SELECT "id", "name", "dob", "sex", "phone" FROM "Patient" WHERE "emrPatientId" = %s AND "deletedAt" IS NULL',
                (emr_id,),
            )
            existing = cur.fetchone()

            if existing is None:
                # 신규 환자 생성
                cur.execute(
                    """INSERT INTO "Patient" ("id", "emrPatientId", "name", "dob", "sex", "phone", "status", "createdAt", "updatedAt")
                       VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, 'ACTIVE', NOW(), NOW())""",
                    (emr_id, name, dob, sex, phone),
                )
                stats["created"] += 1
                logger.debug(f"신규 환자: {emr_id} ({name})")
            else:
                patient_id, old_name, old_dob, old_sex, old_phone = existing

                # 인적사항 변경 감지 (이름, 생년월일, 성별)
                identity_changed = (
                    old_name != name
                    or old_dob.strftime("%Y-%m-%d") != dob.strftime("%Y-%m-%d")
                    or old_sex != sex
                )

                if identity_changed:
                    # IDENTITY_CONFLICT 기록
                    before_json = json.dumps(
                        {"name": old_name, "dob": old_dob.strftime("%Y-%m-%d"), "sex": old_sex},
                        ensure_ascii=False,
                    )
                    after_json = json.dumps(
                        {"name": name, "dob": dob.strftime("%Y-%m-%d"), "sex": sex},
                        ensure_ascii=False,
                    )
                    cur.execute(
                        """INSERT INTO "PatientIdentityConflict"
                           ("id", "importId", "emrPatientId", "beforeJson", "afterJson", "status", "detectedAt")
                           VALUES (gen_random_uuid(), %s, %s, %s::jsonb, %s::jsonb, 'OPEN', NOW())""",
                        (import_id, emr_id, before_json, after_json),
                    )
                    stats["conflicts"] += 1
                    logger.warning(f"인적사항 변경 감지: {emr_id} ({old_name} → {name})")
                    # 충돌 발생 시 자동 업데이트하지 않음 (수동 해결 대기)
                else:
                    # 연락처 등 비식별 정보만 업데이트
                    if old_phone != phone and phone is not None:
                        cur.execute(
                            'UPDATE "Patient" SET "phone" = %s, "updatedAt" = NOW() WHERE "id" = %s',
                            (phone, patient_id),
                        )
                        stats["updated"] += 1
                    else:
                        stats["skipped"] += 1

    conn.commit()
    logger.info(
        f"Patient upsert 완료: 생성={stats['created']}, "
        f"갱신={stats['updated']}, 충돌={stats['conflicts']}, 건너뜀={stats['skipped']}"
    )
    return stats


def save_import_errors(
    conn,
    import_id: str,
    error_rows: list[dict[str, Any]],
) -> int:
    """오류 행들을 ImportError 테이블에 저장한다."""
    count = 0
    with conn.cursor() as cur:
        for err in error_rows:
            row_num = err.get("rowNumber")
            errors = err.get("errors", [])
            raw = err.get("raw", {})

            # _errors, _rowNumber 제거
            clean_raw = {k: v for k, v in raw.items() if not k.startswith("_")}
            # datetime → str 변환
            for k, v in clean_raw.items():
                if isinstance(v, datetime):
                    clean_raw[k] = v.isoformat()

            cur.execute(
                """INSERT INTO "ImportError"
                   ("id", "importId", "errorCode", "message", "rowNumber", "rawRowJson", "createdAt")
                   VALUES (gen_random_uuid(), %s, %s, %s, %s, %s::jsonb, NOW())""",
                (
                    import_id,
                    "VALIDATION_ERROR",
                    "; ".join(errors),
                    row_num,
                    json.dumps(clean_raw, ensure_ascii=False, default=str),
                ),
            )
            count += 1

    conn.commit()
    logger.info(f"ImportError 저장: {count}건")
    return count
