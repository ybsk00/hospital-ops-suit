-- ============================================================
-- 서울온케어 그룹웨어 - 통합 SQL (스키마 + 시드)
-- Supabase SQL Editor에서 이 파일 하나만 실행하세요
-- ============================================================

-- ──────────────────────────────────────────────
-- PART 1: ENUM 타입
-- ──────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'DEPT_ADMIN', 'DOCTOR', 'HEAD_NURSE', 'NURSE', 'STAFF', 'HOMECARE_STAFF', 'VIEWER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PermissionResource" AS ENUM ('BEDS', 'ADMISSIONS', 'PROCEDURES', 'APPOINTMENTS', 'HOMECARE_VISITS', 'QUESTIONNAIRES', 'LAB_RESULTS', 'AI_REPORTS', 'INBOX', 'AUDIT_LOGS', 'IMPORTS', 'USERS', 'DEPARTMENTS', 'CHATBOT', 'DASHBOARD'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PermissionAction" AS ENUM ('READ', 'WRITE', 'DELETE', 'APPROVE', 'EXPORT', 'ADMIN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PatientStatus" AS ENUM ('ACTIVE', 'DECEASED', 'TRANSFERRED', 'INACTIVE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BedStatus" AS ENUM ('EMPTY', 'OCCUPIED', 'RESERVED', 'CLEANING', 'ISOLATION', 'OUT_OF_ORDER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AdmissionStatus" AS ENUM ('ADMITTED', 'DISCHARGE_PLANNED', 'TRANSFER_PLANNED', 'ON_LEAVE', 'DISCHARGED', 'OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ProcedureStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'CHANGED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AppointmentSource" AS ENUM ('EMR', 'INTERNAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "VisitStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "RiskLevel" AS ENUM ('NORMAL', 'ORANGE', 'RED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "LabFlag" AS ENUM ('NORMAL', 'HIGH', 'LOW', 'UNDETERMINED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AiReportStatus" AS ENUM ('DRAFT', 'AI_REVIEWED', 'APPROVED', 'REJECTED', 'SENT', 'ACKED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "InboxItemType" AS ENUM ('RED_ALERT', 'ORANGE_ALERT', 'LAB_ABNORMAL', 'REPORT_PENDING', 'SYNC_CONFLICT', 'MANUAL_FLAG', 'BATCH_FAILURE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "InboxItemStatus" AS ENUM ('UNREAD', 'IN_REVIEW', 'RESOLVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAIL', 'QUARANTINED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ImportFileType" AS ENUM ('INPATIENT', 'OUTPATIENT', 'LAB'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ──────────────────────────────────────────────
-- PART 2: 테이블 생성
-- ──────────────────────────────────────────────

-- Department
CREATE TABLE IF NOT EXISTS "Department" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Department_name_key" ON "Department"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Department_code_key" ON "Department"("code");

-- DepartmentPermission
CREATE TABLE IF NOT EXISTS "DepartmentPermission" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "departmentId" TEXT NOT NULL,
    "resource" "PermissionResource" NOT NULL,
    "action" "PermissionAction" NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'OWN_DEPT',
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DepartmentPermission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DepartmentPermission_departmentId_resource_action_key" ON "DepartmentPermission"("departmentId", "resource", "action");

-- User
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "loginId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "User_loginId_key" ON "User"("loginId");

-- UserDepartment
CREATE TABLE IF NOT EXISTS "UserDepartment" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserDepartment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserDepartment_userId_departmentId_key" ON "UserDepartment"("userId", "departmentId");

-- Patient
CREATE TABLE IF NOT EXISTS "Patient" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "emrPatientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dob" TIMESTAMP(3) NOT NULL,
    "sex" TEXT NOT NULL,
    "phone" TEXT,
    "status" "PatientStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Patient_emrPatientId_key" ON "Patient"("emrPatientId");

-- Ward
CREATE TABLE IF NOT EXISTS "Ward" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "floor" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Ward_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Ward_name_key" ON "Ward"("name");

-- Room
CREATE TABLE IF NOT EXISTS "Room" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "wardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Room_wardId_name_key" ON "Room"("wardId", "name");

-- Bed
CREATE TABLE IF NOT EXISTS "Bed" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "roomId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "BedStatus" NOT NULL DEFAULT 'EMPTY',
    "version" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Bed_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Bed_roomId_label_key" ON "Bed"("roomId", "label");

-- Admission
CREATE TABLE IF NOT EXISTS "Admission" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "patientId" TEXT NOT NULL,
    "admitDate" TIMESTAMP(3) NOT NULL,
    "plannedDischargeDate" TIMESTAMP(3),
    "dischargeDate" TIMESTAMP(3),
    "attendingDoctorId" TEXT NOT NULL,
    "currentBedId" TEXT,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'ADMITTED',
    "syncConflictFlag" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Admission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Admission_currentBedId_key" ON "Admission"("currentBedId");

-- BedAssignment
CREATE TABLE IF NOT EXISTS "BedAssignment" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "admissionId" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3),
    "changedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BedAssignment_pkey" PRIMARY KEY ("id")
);

-- ProcedureCatalog
CREATE TABLE IF NOT EXISTS "ProcedureCatalog" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "defaultUnitPrice" DECIMAL(12,2) NOT NULL,
    "requiredFields" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "ProcedureCatalog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProcedureCatalog_name_key" ON "ProcedureCatalog"("name");

-- ProcedurePlan
CREATE TABLE IF NOT EXISTS "ProcedurePlan" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "admissionId" TEXT NOT NULL,
    "procedureCatalogId" TEXT NOT NULL,
    "scheduleRule" JSONB NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "ProcedurePlan_pkey" PRIMARY KEY ("id")
);

-- ProcedureExecution
CREATE TABLE IF NOT EXISTS "ProcedureExecution" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "planId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "executedById" TEXT,
    "status" "ProcedureStatus" NOT NULL DEFAULT 'SCHEDULED',
    "appliedUnitPrice" DECIMAL(12,2),
    "quantity" DECIMAL(10,4),
    "dose" TEXT,
    "detailsJson" JSONB,
    "notes" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "ProcedureExecution_pkey" PRIMARY KEY ("id")
);

-- Doctor
CREATE TABLE IF NOT EXISTS "Doctor" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "userId" TEXT,
    "emrDoctorId" TEXT,
    "name" TEXT NOT NULL,
    "specialty" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Doctor_emrDoctorId_key" ON "Doctor"("emrDoctorId");

-- ClinicRoom
CREATE TABLE IF NOT EXISTS "ClinicRoom" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "doctorId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "ClinicRoom_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClinicRoom_name_key" ON "ClinicRoom"("name");

-- Appointment
CREATE TABLE IF NOT EXISTS "Appointment" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "emrAppointmentId" TEXT,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "clinicRoomId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "source" "AppointmentSource" NOT NULL DEFAULT 'INTERNAL',
    "conflictFlag" BOOLEAN NOT NULL DEFAULT false,
    "conflictResolvedBy" TEXT,
    "conflictResolvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_emrAppointmentId_key" ON "Appointment"("emrAppointmentId");

-- HomecareVisit
CREATE TABLE IF NOT EXISTS "HomecareVisit" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "patientId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" "VisitStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "HomecareVisit_pkey" PRIMARY KEY ("id")
);

-- Questionnaire
CREATE TABLE IF NOT EXISTS "Questionnaire" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "visitId" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'NORMAL',
    "riskReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Questionnaire_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Questionnaire_idempotencyKey_key" ON "Questionnaire"("idempotencyKey");

-- LabResult
CREATE TABLE IF NOT EXISTS "LabResult" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "patientId" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "testName" TEXT NOT NULL,
    "analyte" TEXT NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "unit" TEXT,
    "refLow" DECIMAL(12,4),
    "refHigh" DECIMAL(12,4),
    "flag" "LabFlag" NOT NULL DEFAULT 'NORMAL',
    "flagReason" TEXT,
    "sourceFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "LabResult_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LabResult_patientId_collectedAt_idx" ON "LabResult"("patientId", "collectedAt");

-- UploadedFile
CREATE TABLE IF NOT EXISTS "UploadedFile" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "originalName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

-- AiReport
CREATE TABLE IF NOT EXISTS "AiReport" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "patientId" TEXT NOT NULL,
    "visitId" TEXT,
    "labBatchId" TEXT,
    "status" "AiReportStatus" NOT NULL DEFAULT 'DRAFT',
    "draftText" TEXT,
    "reviewedText" TEXT,
    "reviewChecks" JSONB,
    "approvedText" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceFileId" TEXT,
    "outputFileId" TEXT,
    "stampedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "AiReport_pkey" PRIMARY KEY ("id")
);

-- ReportDelivery
CREATE TABLE IF NOT EXISTS "ReportDelivery" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "reportId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'SYSTEM',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackAt" TIMESTAMP(3),
    CONSTRAINT "ReportDelivery_pkey" PRIMARY KEY ("id")
);

-- InboxItem
CREATE TABLE IF NOT EXISTS "InboxItem" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "ownerId" TEXT NOT NULL,
    "type" "InboxItemType" NOT NULL,
    "status" "InboxItemStatus" NOT NULL DEFAULT 'UNREAD',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "InboxItem_pkey" PRIMARY KEY ("id")
);

-- InboxEscalation
CREATE TABLE IF NOT EXISTS "InboxEscalation" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "inboxItemId" TEXT NOT NULL,
    "escalatedToId" TEXT NOT NULL,
    "escalatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    CONSTRAINT "InboxEscalation_pkey" PRIMARY KEY ("id")
);

-- Import
CREATE TABLE IF NOT EXISTS "Import" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "filePath" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileType" "ImportFileType" NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "statsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Import_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Import_fileHash_key" ON "Import"("fileHash");

-- ImportError
CREATE TABLE IF NOT EXISTS "ImportError" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "importId" TEXT NOT NULL,
    "errorCode" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sheetName" TEXT,
    "rowNumber" INTEGER,
    "rawRowJson" JSONB,
    "detailsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportError_pkey" PRIMARY KEY ("id")
);

-- PatientIdentityConflict
CREATE TABLE IF NOT EXISTS "PatientIdentityConflict" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "importId" TEXT NOT NULL,
    "emrPatientId" TEXT NOT NULL,
    "beforeJson" JSONB NOT NULL,
    "afterJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientIdentityConflict_pkey" PRIMARY KEY ("id")
);

-- AuditLog
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- MobileAccessToken
CREATE TABLE IF NOT EXISTS "MobileAccessToken" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "visitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MobileAccessToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MobileAccessToken_token_key" ON "MobileAccessToken"("token");

-- ChatSession
CREATE TABLE IF NOT EXISTS "ChatSession" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- ChatMessage
CREATE TABLE IF NOT EXISTS "ChatMessage" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- ──────────────────────────────────────────────
-- PART 3: FOREIGN KEY 제약조건
-- ──────────────────────────────────────────────
DO $$ BEGIN ALTER TABLE "Department" ADD CONSTRAINT "Department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "DepartmentPermission" ADD CONSTRAINT "DepartmentPermission_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "UserDepartment" ADD CONSTRAINT "UserDepartment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "UserDepartment" ADD CONSTRAINT "UserDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Room" ADD CONSTRAINT "Room_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Bed" ADD CONSTRAINT "Bed_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Admission" ADD CONSTRAINT "Admission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Admission" ADD CONSTRAINT "Admission_attendingDoctorId_fkey" FOREIGN KEY ("attendingDoctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Admission" ADD CONSTRAINT "Admission_currentBedId_fkey" FOREIGN KEY ("currentBedId") REFERENCES "Bed"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "BedAssignment" ADD CONSTRAINT "BedAssignment_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "BedAssignment" ADD CONSTRAINT "BedAssignment_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ProcedurePlan" ADD CONSTRAINT "ProcedurePlan_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ProcedurePlan" ADD CONSTRAINT "ProcedurePlan_procedureCatalogId_fkey" FOREIGN KEY ("procedureCatalogId") REFERENCES "ProcedureCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ProcedureExecution" ADD CONSTRAINT "ProcedureExecution_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProcedurePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ProcedureExecution" ADD CONSTRAINT "ProcedureExecution_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ClinicRoom" ADD CONSTRAINT "ClinicRoom_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicRoomId_fkey" FOREIGN KEY ("clinicRoomId") REFERENCES "ClinicRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "HomecareVisit" ADD CONSTRAINT "HomecareVisit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "HomecareVisit" ADD CONSTRAINT "HomecareVisit_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Questionnaire" ADD CONSTRAINT "Questionnaire_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "HomecareVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "UploadedFile" ADD CONSTRAINT "UploadedFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AiReport" ADD CONSTRAINT "AiReport_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AiReport" ADD CONSTRAINT "AiReport_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "HomecareVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AiReport" ADD CONSTRAINT "AiReport_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AiReport" ADD CONSTRAINT "AiReport_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "UploadedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AiReport" ADD CONSTRAINT "AiReport_outputFileId_fkey" FOREIGN KEY ("outputFileId") REFERENCES "UploadedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ReportDelivery" ADD CONSTRAINT "ReportDelivery_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AiReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "InboxEscalation" ADD CONSTRAINT "InboxEscalation_inboxItemId_fkey" FOREIGN KEY ("inboxItemId") REFERENCES "InboxItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ImportError" ADD CONSTRAINT "ImportError_importId_fkey" FOREIGN KEY ("importId") REFERENCES "Import"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PatientIdentityConflict" ADD CONSTRAINT "PatientIdentityConflict_importId_fkey" FOREIGN KEY ("importId") REFERENCES "Import"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PatientIdentityConflict" ADD CONSTRAINT "PatientIdentityConflict_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ──────────────────────────────────────────────
-- PART 4: pgvector (실패해도 나머지에 영향 없음)
-- ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "Embedding" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "vector" vector(768) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Embedding_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Embedding_entityType_entityId_idx" ON "Embedding"("entityType", "entityId");

-- ============================================================
-- PART 5: 시드 데이터
-- ============================================================

-- 5-1. 부서 (Department)
INSERT INTO "Department" ("id", "name", "code") VALUES
  ('dept-director',  '원장실',     'DIRECTOR'),
  ('dept-nursing',   '간호부',     'NURSING'),
  ('dept-admin',     '원무과',     'ADMIN_OFFICE'),
  ('dept-homecare',  '가정방문팀', 'HOMECARE'),
  ('dept-medical',   '진료과',     'MEDICAL')
ON CONFLICT ("code") DO NOTHING;

-- 5-2. 사용자 (User)
-- 비밀번호:
--   admin    / admin1234
--   doctor1  / doctor1234
--   nurse1   / nurse1234
--   staff1   / staff1234
--   homecare1/ homecare1234
INSERT INTO "User" ("id", "loginId", "passwordHash", "name", "isSuperAdmin") VALUES
  ('user-admin',    'admin',     '$2a$12$/11kIfmRHSBn2Pn1RCo4lu4hDCJHgUTSjiPi9V.JqAHUkI46jhOG.', '시스템관리자', true),
  ('user-doctor1',  'doctor1',   '$2a$12$ScVwfqPDOrNRXr4Ey8lyiOAgqLWjWIvqnUn41ZDMzU1DDW8OH6FgO', '김의사',       false),
  ('user-nurse1',   'nurse1',    '$2a$12$eXPgWkTn8eUQQwsMwQdYX.1JxQazHxet5c8u.N1CsOT05AEynnF7q', '이간호사',     false),
  ('user-staff1',   'staff1',    '$2a$12$jD89mAocgUYkjVtNvg..5OYaCvfb764aTiwc/eyaPJ9HtKxzXpiuK', '박직원',       false),
  ('user-homecare1','homecare1', '$2a$12$lO8YwbLXPlNzx0loqahxxuqCceNPfo/fqFWRPVj4EvQtSqMJtU1Vq', '최방문',       false)
ON CONFLICT ("loginId") DO NOTHING;

-- 5-3. 사용자-부서 배정 (UserDepartment)
INSERT INTO "UserDepartment" ("userId", "departmentId", "role", "isPrimary") VALUES
  ('user-doctor1',   'dept-medical',   'DOCTOR',         true),
  ('user-nurse1',    'dept-nursing',   'HEAD_NURSE',     true),
  ('user-staff1',    'dept-admin',     'STAFF',          true),
  ('user-homecare1', 'dept-homecare',  'HOMECARE_STAFF', true)
ON CONFLICT ("userId", "departmentId") DO NOTHING;

-- 5-4. 부서 권한 (DepartmentPermission)

-- 원장실 (DIRECTOR): 전체 권한 (15 resources × 4 actions = 60 rows)
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

-- 5-5. 병동 / 호실 / 베드
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

-- 5-6. 처치 카탈로그 (ProcedureCatalog)
INSERT INTO "ProcedureCatalog" ("name", "category", "defaultUnitPrice") VALUES
  ('수액주사',  '주사', 15000),
  ('상처소독',  '처치', 8000),
  ('물리치료',  '재활', 20000)
ON CONFLICT ("name") DO NOTHING;

-- 5-7. 의사 마스터 (Doctor)
INSERT INTO "Doctor" ("id", "userId", "name", "specialty") VALUES
  ('doc-kim', 'user-doctor1', '김의사', '내과')
ON CONFLICT DO NOTHING;

-- 5-8. 진료실 (ClinicRoom)
INSERT INTO "ClinicRoom" ("id", "name", "doctorId") VALUES
  ('clinic-1', '1진료실', 'doc-kim')
ON CONFLICT ("name") DO NOTHING;

-- ============================================================
-- 완료! 테이블 24개 + 시드 데이터 삽입 완료
-- ============================================================
