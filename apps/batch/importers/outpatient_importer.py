"""
외래예약 임포터
파싱된 외래예약 데이터를 DB에 Upsert 한다.
- EMR예약ID 기준으로 기존 레코드를 조회
- 없으면 신규 생성, 있으면 변경 감지 → conflictFlag 설정
"""
import json
import logging

logger = logging.getLogger("importer.outpatient")


def save_import_errors(conn, import_id: str, error_rows: list[dict]):
    """오류 행을 ImportError 테이블에 저장한다."""
    with conn.cursor() as cur:
        for row in error_rows:
            cur.execute(
                """INSERT INTO "ImportError"
                   ("id", "importId", "errorCode", "message", "rowNumber", "rawRowJson", "createdAt")
                   VALUES (gen_random_uuid(), %s, %s, %s, %s, %s::jsonb, NOW())""",
                (
                    import_id,
                    "PARSE_ERROR",
                    row.get("_error", "알 수 없는 오류"),
                    row.get("_row"),
                    json.dumps({k: str(v) for k, v in row.items() if not k.startswith("_")}, ensure_ascii=False),
                ),
            )
    conn.commit()


def _find_or_create_patient(cur, emr_patient_id: str, patient_name: str) -> str | None:
    """환자를 emrPatientId로 조회하거나 신규 생성한다. 환자 ID를 반환한다."""
    cur.execute(
        'SELECT "id" FROM "Patient" WHERE "emrPatientId" = %s AND "deletedAt" IS NULL LIMIT 1',
        (emr_patient_id,),
    )
    result = cur.fetchone()
    if result:
        return result[0]

    # 환자가 없으면 최소 정보로 생성 (배치에서는 이름 + emrPatientId만)
    cur.execute(
        """INSERT INTO "Patient" ("id", "emrPatientId", "name", "dob", "sex", "status", "createdAt", "updatedAt")
           VALUES (gen_random_uuid(), %s, %s, '1900-01-01', 'M', 'ACTIVE', NOW(), NOW())
           RETURNING "id" """,
        (emr_patient_id, patient_name),
    )
    result = cur.fetchone()
    return result[0] if result else None


def _find_or_create_doctor(cur, doctor_name: str, emr_doctor_id: str | None) -> str | None:
    """의사를 이름 또는 emrDoctorId로 조회하거나 신규 생성한다."""
    if emr_doctor_id:
        cur.execute(
            'SELECT "id" FROM "Doctor" WHERE "emrDoctorId" = %s AND "deletedAt" IS NULL LIMIT 1',
            (emr_doctor_id,),
        )
        result = cur.fetchone()
        if result:
            return result[0]

    if doctor_name:
        cur.execute(
            'SELECT "id" FROM "Doctor" WHERE "name" = %s AND "deletedAt" IS NULL LIMIT 1',
            (doctor_name,),
        )
        result = cur.fetchone()
        if result:
            return result[0]

        # 없으면 신규 생성
        cur.execute(
            """INSERT INTO "Doctor" ("id", "name", "emrDoctorId", "isActive", "createdAt", "updatedAt")
               VALUES (gen_random_uuid(), %s, %s, true, NOW(), NOW())
               RETURNING "id" """,
            (doctor_name, emr_doctor_id),
        )
        result = cur.fetchone()
        return result[0] if result else None

    return None


def _find_clinic_room(cur, room_name: str | None) -> str | None:
    """진료실을 이름으로 조회한다."""
    if not room_name:
        return None
    cur.execute(
        'SELECT "id" FROM "ClinicRoom" WHERE "name" = %s AND "deletedAt" IS NULL LIMIT 1',
        (room_name,),
    )
    result = cur.fetchone()
    return result[0] if result else None


def upsert_appointments(conn, valid_rows: list[dict], import_id: str) -> dict:
    """외래예약 데이터를 DB에 Upsert 한다."""
    stats = {"created": 0, "updated": 0, "conflicts": 0, "skipped": 0}

    with conn.cursor() as cur:
        for row in valid_rows:
            try:
                emr_patient_id = row["emrPatientId"]
                patient_name = row.get("patientName", "")
                emr_appointment_id = row.get("emrAppointmentId")
                apt_date = row["appointmentDate"]
                start_time = row["startTime"]
                end_time = row["endTime"]
                doctor_name = row.get("doctorName", "")
                emr_doctor_id = row.get("emrDoctorId")
                clinic_room_name = row.get("clinicRoomName")
                status = row.get("status", "BOOKED")
                notes = row.get("notes")

                # 환자 조회/생성
                patient_id = _find_or_create_patient(cur, emr_patient_id, patient_name)
                if not patient_id:
                    logger.warning(f"환자 생성 실패: {emr_patient_id}")
                    stats["skipped"] += 1
                    continue

                # 의사 조회/생성
                doctor_id = _find_or_create_doctor(cur, doctor_name, emr_doctor_id)
                if not doctor_id:
                    logger.warning(f"의사 조회 실패: {doctor_name}")
                    stats["skipped"] += 1
                    continue

                # 진료실 조회
                clinic_room_id = _find_clinic_room(cur, clinic_room_name)

                # startAt / endAt 조합
                start_at = f"{apt_date}T{start_time}:00"
                end_at = f"{apt_date}T{end_time}:00"

                # 기존 예약 조회 (emrAppointmentId 기준)
                existing = None
                if emr_appointment_id:
                    cur.execute(
                        'SELECT "id", "startAt", "endAt", "doctorId", "status", "source" '
                        'FROM "Appointment" WHERE "emrAppointmentId" = %s AND "deletedAt" IS NULL LIMIT 1',
                        (emr_appointment_id,),
                    )
                    existing = cur.fetchone()

                if existing:
                    existing_id = existing[0]
                    old_start = str(existing[1])
                    old_end = str(existing[2])
                    old_doctor = existing[3]
                    old_status = existing[4]
                    old_source = existing[5]

                    # 변경 감지
                    changed = False
                    if start_at not in old_start or end_at not in old_end:
                        changed = True
                    if doctor_id != old_doctor:
                        changed = True
                    if status != old_status:
                        changed = True

                    if changed:
                        # 이미 INTERNAL에서 수정된 경우 → 충돌 플래그 설정
                        if old_source == "INTERNAL":
                            cur.execute(
                                """UPDATE "Appointment"
                                   SET "conflictFlag" = true,
                                       "version" = "version" + 1,
                                       "updatedAt" = NOW()
                                   WHERE "id" = %s""",
                                (existing_id,),
                            )
                            stats["conflicts"] += 1
                            logger.info(f"충돌 감지: EMR예약ID={emr_appointment_id}")
                        else:
                            # EMR 소스면 덮어쓰기
                            cur.execute(
                                """UPDATE "Appointment"
                                   SET "startAt" = %s, "endAt" = %s, "doctorId" = %s,
                                       "clinicRoomId" = %s, "status" = %s,
                                       "notes" = %s, "source" = 'EMR',
                                       "version" = "version" + 1, "updatedAt" = NOW()
                                   WHERE "id" = %s""",
                                (start_at, end_at, doctor_id, clinic_room_id, status, notes, existing_id),
                            )
                            stats["updated"] += 1
                    else:
                        stats["skipped"] += 1
                else:
                    # 신규 생성
                    cur.execute(
                        """INSERT INTO "Appointment"
                           ("id", "emrAppointmentId", "patientId", "doctorId", "clinicRoomId",
                            "startAt", "endAt", "status", "source", "notes",
                            "conflictFlag", "version", "createdAt", "updatedAt")
                           VALUES (gen_random_uuid(), %s, %s, %s, %s,
                                   %s, %s, %s, 'EMR', %s,
                                   false, 0, NOW(), NOW())""",
                        (emr_appointment_id, patient_id, doctor_id, clinic_room_id,
                         start_at, end_at, status, notes),
                    )
                    stats["created"] += 1

            except Exception as e:
                logger.warning(f"예약 upsert 실패 (행 {row.get('_row', '?')}): {e}")
                stats["skipped"] += 1
                continue

    conn.commit()
    logger.info(f"외래예약 Upsert 완료: {stats}")
    return stats
