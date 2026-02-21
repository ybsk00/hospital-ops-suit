-- ============================================================
-- 서울온케어 그룹웨어 - 시드 데이터
-- init.sql 실행 후 이 파일을 실행하세요
-- ============================================================

-- ──────────────────────────────────────────────
-- 1. 부서 (Department)
-- ──────────────────────────────────────────────
INSERT INTO "Department" ("id", "name", "code") VALUES
  ('dept-director',  '원장실',     'DIRECTOR'),
  ('dept-nursing',   '간호부',     'NURSING'),
  ('dept-admin',     '원무과',     'ADMIN_OFFICE'),
  ('dept-homecare',  '가정방문팀', 'HOMECARE'),
  ('dept-medical',   '진료과',     'MEDICAL')
ON CONFLICT ("code") DO NOTHING;

-- ──────────────────────────────────────────────
-- 2. 사용자 (User)
-- 비밀번호: bcrypt hash (12 rounds)
--   admin    / admin1234
--   doctor1  / doctor1234
--   nurse1   / nurse1234
--   staff1   / staff1234
--   homecare1/ homecare1234
-- ──────────────────────────────────────────────
INSERT INTO "User" ("id", "loginId", "passwordHash", "name", "isSuperAdmin") VALUES
  ('user-admin',    'admin',     '$2a$12$/11kIfmRHSBn2Pn1RCo4lu4hDCJHgUTSjiPi9V.JqAHUkI46jhOG.', '시스템관리자', true),
  ('user-nurse1',   'nurse1',    '$2a$12$eXPgWkTn8eUQQwsMwQdYX.1JxQazHxet5c8u.N1CsOT05AEynnF7q', '이간호사',     false),
  ('user-staff1',   'staff1',    '$2a$12$jD89mAocgUYkjVtNvg..5OYaCvfb764aTiwc/eyaPJ9HtKxzXpiuK', '박직원',       false),
  ('user-homecare1','homecare1', '$2a$12$lO8YwbLXPlNzx0loqahxxuqCceNPfo/fqFWRPVj4EvQtSqMJtU1Vq', '최방문',       false)
ON CONFLICT ("loginId") DO NOTHING;

-- ──────────────────────────────────────────────
-- 3. 사용자-부서 배정 (UserDepartment)
-- ──────────────────────────────────────────────
INSERT INTO "UserDepartment" ("userId", "departmentId", "role", "isPrimary") VALUES
  ('user-nurse1',    'dept-nursing',   'HEAD_NURSE',     true),
  ('user-staff1',    'dept-admin',     'STAFF',          true),
  ('user-homecare1', 'dept-homecare',  'HOMECARE_STAFF', true)
ON CONFLICT ("userId", "departmentId") DO NOTHING;

-- ──────────────────────────────────────────────
-- 4. 부서 권한 (DepartmentPermission)
-- ──────────────────────────────────────────────

-- 원장실 (DIRECTOR): 전체 권한
INSERT INTO "DepartmentPermission" ("departmentId", "resource", "action", "scope")
SELECT 'dept-director', r.resource, a.action, 'ALL'
FROM (VALUES
  ('BEDS'::"PermissionResource"), ('ADMISSIONS'::"PermissionResource"), ('PROCEDURES'::"PermissionResource"),
  ('APPOINTMENTS'::"PermissionResource"), ('HOMECARE_VISITS'::"PermissionResource"), ('QUESTIONNAIRES'::"PermissionResource"),
  ('LAB_RESULTS'::"PermissionResource"), ('AI_REPORTS'::"PermissionResource"), ('INBOX'::"PermissionResource"),
  ('AUDIT_LOGS'::"PermissionResource"), ('IMPORTS'::"PermissionResource"), ('USERS'::"PermissionResource"),
  ('DEPARTMENTS'::"PermissionResource"), ('CHATBOT'::"PermissionResource"), ('DASHBOARD'::"PermissionResource")
) AS r(resource)
CROSS JOIN (VALUES
  ('READ'::"PermissionAction"), ('WRITE'::"PermissionAction"), ('APPROVE'::"PermissionAction"), ('ADMIN'::"PermissionAction")
) AS a(action)
ON CONFLICT ("departmentId", "resource", "action") DO NOTHING;

-- 진료과 (MEDICAL)
INSERT INTO "DepartmentPermission" ("departmentId", "resource", "action", "scope") VALUES
  ('dept-medical', 'BEDS',            'READ',    'OWN_DEPT'),
  ('dept-medical', 'BEDS',            'WRITE',   'OWN_DEPT'),
  ('dept-medical', 'ADMISSIONS',      'READ',    'OWN_DEPT'),
  ('dept-medical', 'ADMISSIONS',      'WRITE',   'OWN_DEPT'),
  ('dept-medical', 'ADMISSIONS',      'APPROVE', 'OWN_DEPT'),
  ('dept-medical', 'PROCEDURES',      'READ',    'OWN_DEPT'),
  ('dept-medical', 'PROCEDURES',      'WRITE',   'OWN_DEPT'),
  ('dept-medical', 'PROCEDURES',      'APPROVE', 'OWN_DEPT'),
  ('dept-medical', 'APPOINTMENTS',    'READ',    'OWN_DEPT'),
  ('dept-medical', 'APPOINTMENTS',    'WRITE',   'OWN_DEPT'),
  ('dept-medical', 'APPOINTMENTS',    'APPROVE', 'OWN_DEPT'),
  ('dept-medical', 'HOMECARE_VISITS', 'READ',    'OWN_DEPT'),
  ('dept-medical', 'HOMECARE_VISITS', 'WRITE',   'OWN_DEPT'),
  ('dept-medical', 'HOMECARE_VISITS', 'APPROVE', 'OWN_DEPT'),
  ('dept-medical', 'QUESTIONNAIRES',  'READ',    'OWN_DEPT'),
  ('dept-medical', 'QUESTIONNAIRES',  'WRITE',   'OWN_DEPT'),
  ('dept-medical', 'QUESTIONNAIRES',  'APPROVE', 'OWN_DEPT'),
  ('dept-medical', 'LAB_RESULTS',     'READ',    'OWN_DEPT'),
  ('dept-medical', 'LAB_RESULTS',     'WRITE',   'OWN_DEPT'),
  ('dept-medical', 'LAB_RESULTS',     'APPROVE', 'OWN_DEPT'),
  ('dept-medical', 'AI_REPORTS',      'READ',    'OWN_DEPT'),
  ('dept-medical', 'AI_REPORTS',      'WRITE',   'OWN_DEPT'),
  ('dept-medical', 'AI_REPORTS',      'APPROVE', 'OWN_DEPT'),
  ('dept-medical', 'DASHBOARD',       'READ',    'OWN_DEPT')
ON CONFLICT ("departmentId", "resource", "action") DO NOTHING;

-- 간호부 (NURSING)
INSERT INTO "DepartmentPermission" ("departmentId", "resource", "action", "scope") VALUES
  ('dept-nursing', 'BEDS',            'READ',  'OWN_DEPT'),
  ('dept-nursing', 'BEDS',            'WRITE', 'OWN_DEPT'),
  ('dept-nursing', 'ADMISSIONS',      'READ',  'OWN_DEPT'),
  ('dept-nursing', 'ADMISSIONS',      'WRITE', 'OWN_DEPT'),
  ('dept-nursing', 'PROCEDURES',      'READ',  'OWN_DEPT'),
  ('dept-nursing', 'PROCEDURES',      'WRITE', 'OWN_DEPT'),
  ('dept-nursing', 'HOMECARE_VISITS', 'READ',  'OWN_DEPT'),
  ('dept-nursing', 'HOMECARE_VISITS', 'WRITE', 'OWN_DEPT'),
  ('dept-nursing', 'QUESTIONNAIRES',  'READ',  'OWN_DEPT'),
  ('dept-nursing', 'QUESTIONNAIRES',  'WRITE', 'OWN_DEPT'),
  ('dept-nursing', 'DASHBOARD',       'READ',  'OWN_DEPT')
ON CONFLICT ("departmentId", "resource", "action") DO NOTHING;

-- 원무과 (ADMIN_OFFICE)
INSERT INTO "DepartmentPermission" ("departmentId", "resource", "action", "scope") VALUES
  ('dept-admin', 'APPOINTMENTS', 'READ',  'OWN_DEPT'),
  ('dept-admin', 'APPOINTMENTS', 'WRITE', 'OWN_DEPT'),
  ('dept-admin', 'ADMISSIONS',   'READ',  'OWN_DEPT'),
  ('dept-admin', 'ADMISSIONS',   'WRITE', 'OWN_DEPT'),
  ('dept-admin', 'BEDS',         'READ',  'OWN_DEPT'),
  ('dept-admin', 'DASHBOARD',    'READ',  'OWN_DEPT')
ON CONFLICT ("departmentId", "resource", "action") DO NOTHING;

-- 가정방문팀 (HOMECARE)
INSERT INTO "DepartmentPermission" ("departmentId", "resource", "action", "scope") VALUES
  ('dept-homecare', 'HOMECARE_VISITS', 'READ',  'OWN_DEPT'),
  ('dept-homecare', 'HOMECARE_VISITS', 'WRITE', 'OWN_DEPT'),
  ('dept-homecare', 'QUESTIONNAIRES',  'READ',  'OWN_DEPT'),
  ('dept-homecare', 'QUESTIONNAIRES',  'WRITE', 'OWN_DEPT'),
  ('dept-homecare', 'LAB_RESULTS',     'READ',  'OWN_DEPT'),
  ('dept-homecare', 'LAB_RESULTS',     'WRITE', 'OWN_DEPT'),
  ('dept-homecare', 'DASHBOARD',       'READ',  'OWN_DEPT')
ON CONFLICT ("departmentId", "resource", "action") DO NOTHING;

-- Phase 7: 원무과·간호부·진료과 모두 외래예약+처치 WRITE 권한
INSERT INTO "DepartmentPermission" ("departmentId", "resource", "action", "scope") VALUES
  -- 원무과: 외래예약 + 처치 WRITE
  ('dept-admin',   'PROCEDURES',   'READ',  'OWN_DEPT'),
  ('dept-admin',   'PROCEDURES',   'WRITE', 'OWN_DEPT'),
  -- 간호부: 외래예약 WRITE (처치 WRITE는 위에서 이미 있음)
  ('dept-nursing', 'APPOINTMENTS', 'READ',  'OWN_DEPT'),
  ('dept-nursing', 'APPOINTMENTS', 'WRITE', 'OWN_DEPT')
ON CONFLICT ("departmentId", "resource", "action") DO NOTHING;

-- ──────────────────────────────────────────────
-- 5. 병동 / 호실 / 베드
-- ──────────────────────────────────────────────
INSERT INTO "Ward" ("id", "name", "floor") VALUES
  ('ward-1', '1병동', 2),
  ('ward-2', '2병동', 3)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "Room" ("id", "wardId", "name", "capacity") VALUES
  ('room-101', 'ward-1', '101호', 2),
  ('room-102', 'ward-1', '102호', 2),
  ('room-201', 'ward-2', '201호', 2),
  ('room-202', 'ward-2', '202호', 2)
ON CONFLICT ("wardId", "name") DO NOTHING;

INSERT INTO "Bed" ("id", "roomId", "label", "status") VALUES
  ('bed-101a', 'room-101', 'A', 'EMPTY'),
  ('bed-101b', 'room-101', 'B', 'EMPTY'),
  ('bed-102a', 'room-102', 'A', 'EMPTY'),
  ('bed-102b', 'room-102', 'B', 'EMPTY'),
  ('bed-201a', 'room-201', 'A', 'EMPTY'),
  ('bed-201b', 'room-201', 'B', 'EMPTY'),
  ('bed-202a', 'room-202', 'A', 'EMPTY'),
  ('bed-202b', 'room-202', 'B', 'EMPTY')
ON CONFLICT ("roomId", "label") DO NOTHING;

-- ──────────────────────────────────────────────
-- 6. 처치 카탈로그 (ProcedureCatalog)
-- ──────────────────────────────────────────────
INSERT INTO "ProcedureCatalog" ("name", "code", "category", "defaultDuration", "defaultUnitPrice") VALUES
  ('수액주사',       'INJECTION',       '주사', 15, 15000),
  ('상처소독',       NULL,              '처치', 20, 8000),
  ('물리치료',       NULL,              '재활', 30, 20000),
  ('도수치료',       'MANUAL_THERAPY',  '재활', 30, 25000),
  ('고주파온열치료', 'RF_HYPERTHERMIA', '처치', 60, 30000),
  ('산소치료',       'O2_THERAPY',      '처치', 30, 15000),
  ('주사치료',       NULL,              '주사', 15, 12000),
  ('레이저치료',     'LASER',           '처치', 20, 20000)
ON CONFLICT ("name") DO NOTHING;

-- ──────────────────────────────────────────────
-- 7. 의사 마스터 (Doctor) - 실제 의사는 별도 마이그레이션으로 추가
-- ──────────────────────────────────────────────

-- ──────────────────────────────────────────────
-- 8. 진료실 (ClinicRoom)
-- ──────────────────────────────────────────────
INSERT INTO "ClinicRoom" ("id", "name") VALUES
  ('clinic-1', '1진료실')
ON CONFLICT ("name") DO NOTHING;

-- ──────────────────────────────────────────────
-- 9. 테스트 환자 (Patient)
-- ──────────────────────────────────────────────
INSERT INTO "Patient" ("id", "emrPatientId", "name", "dob", "sex", "phone", "status") VALUES
  ('patient-1', 'EMR-001', '김철수', '1975-03-15', 'M', '010-1111-2222', 'ACTIVE'),
  ('patient-2', 'EMR-002', '이영희', '1960-08-22', 'F', '010-3333-4444', 'ACTIVE'),
  ('patient-3', 'EMR-003', '박민수', '1990-12-01', 'M', '010-5555-6666', 'ACTIVE'),
  ('patient-4', 'EMR-004', '최수진', '1985-05-10', 'F', '010-7777-8888', 'ACTIVE'),
  ('patient-5', 'EMR-005', '정대호', '1952-11-30', 'M', '010-9999-0000', 'ACTIVE')
ON CONFLICT ("emrPatientId") DO NOTHING;

-- ──────────────────────────────────────────────
-- 10. 테스트 외래예약 (Appointment) - 오늘 날짜 기준
-- ──────────────────────────────────────────────
-- 테스트 외래예약은 실제 의사(이찬용/이재일)로 별도 마이그레이션에서 추가됨
