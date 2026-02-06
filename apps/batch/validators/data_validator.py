"""
데이터 유효성 검증
파싱된 행 데이터의 비즈니스 규칙 검증
"""
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


def validate_rows(rows: list[dict[str, Any]]) -> tuple[list[dict], list[dict]]:
    """
    파싱된 행 목록을 검증하여 유효/무효 행으로 분리한다.
    Returns: (valid_rows, error_rows)
    """
    valid: list[dict] = []
    errors: list[dict] = []

    seen_ids: set[str] = set()

    for row in rows:
        row_errors = list(row.get("_errors", []))
        row_num = row.get("_rowNumber", 0)

        # 파서에서 이미 에러가 있는 경우
        if row_errors:
            errors.append({
                "rowNumber": row_num,
                "errors": row_errors,
                "raw": row,
            })
            continue

        emr_id = row.get("emrPatientId", "")

        # 파일 내 중복 ID 검사
        if emr_id in seen_ids:
            errors.append({
                "rowNumber": row_num,
                "errors": [f"파일 내 환자번호 중복: {emr_id}"],
                "raw": row,
            })
            continue
        seen_ids.add(emr_id)

        # 생년월일 범위 검사
        dob = row.get("dob")
        if isinstance(dob, datetime):
            age = (datetime.now() - dob).days / 365.25
            if age < 0 or age > 150:
                row_errors.append(f"생년월일이 범위를 벗어납니다: {dob.strftime('%Y-%m-%d')}")

        # 입원일 검사 (미래 30일 이상은 경고)
        admit_date = row.get("admitDate")
        if isinstance(admit_date, datetime):
            days_ahead = (admit_date - datetime.now()).days
            if days_ahead > 30:
                row_errors.append(f"입원일이 30일 이상 미래입니다: {admit_date.strftime('%Y-%m-%d')}")

        # 퇴원예정일이 입원일 이전인지 검사
        planned = row.get("plannedDischargeDate")
        if planned and admit_date and isinstance(planned, datetime) and isinstance(admit_date, datetime):
            if planned < admit_date:
                row_errors.append("퇴원예정일이 입원일보다 이전입니다.")

        # 성별 검증
        sex = row.get("sex")
        if sex and sex not in ("M", "F"):
            row_errors.append(f"성별 값이 올바르지 않습니다: {sex}")

        if row_errors:
            errors.append({
                "rowNumber": row_num,
                "errors": row_errors,
                "raw": row,
            })
        else:
            valid.append(row)

    logger.info(f"검증 완료: 유효 {len(valid)}건, 오류 {len(errors)}건")
    return valid, errors
