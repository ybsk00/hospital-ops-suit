-- ============================================================
-- 서울온케어 그룹웨어 - 초기 스키마 마이그레이션
-- Supabase SQL Editor에서 실행하세요
-- ============================================================

-- Enums
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'DEPT_ADMIN', 'DOCTOR', 'HEAD_NURSE', 'NURSE', 'STAFF', 'HOMECARE_STAFF', 'VIEWER');
CREATE TYPE "PermissionResource" AS ENUM ('BEDS', 'ADMISSIONS', 'PROCEDURES', 'APPOINTMENTS', 'HOMECARE_VISITS', 'QUESTIONNAIRES', 'LAB_RESULTS', 'AI_REPORTS', 'INBOX', 'AUDIT_LOGS', 'IMPORTS', 'USERS', 'DEPARTMENTS', 'CHATBOT', 'DASHBOARD');
CREATE TYPE "PermissionAction" AS ENUM ('READ', 'WRITE', 'DELETE', 'APPROVE', 'EXPORT', 'ADMIN');
CREATE TYPE "PatientStatus" AS ENUM ('ACTIVE', 'DECEASED', 'TRANSFERRED', 'INACTIVE');
CREATE TYPE "BedStatus" AS ENUM ('EMPTY', 'OCCUPIED', 'RESERVED', 'CLEANING', 'ISOLATION', 'OUT_OF_ORDER');
CREATE TYPE "AdmissionStatus" AS ENUM ('ADMITTED', 'DISCHARGE_PLANNED', 'TRANSFER_PLANNED', 'ON_LEAVE', 'DISCHARGED', 'OTHER');
CREATE TYPE "ProcedureStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED');
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'CHANGED');
CREATE TYPE "AppointmentSource" AS ENUM ('EMR', 'INTERNAL');
CREATE TYPE "VisitStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "RiskLevel" AS ENUM ('NORMAL', 'ORANGE', 'RED');
CREATE TYPE "LabFlag" AS ENUM ('NORMAL', 'HIGH', 'LOW', 'UNDETERMINED');
CREATE TYPE "AiReportStatus" AS ENUM ('DRAFT', 'AI_REVIEWED', 'APPROVED', 'REJECTED', 'SENT', 'ACKED');
CREATE TYPE "InboxItemType" AS ENUM ('RED_ALERT', 'ORANGE_ALERT', 'LAB_ABNORMAL', 'REPORT_PENDING', 'SYNC_CONFLICT', 'MANUAL_FLAG', 'BATCH_FAILURE');
CREATE TYPE "InboxItemStatus" AS ENUM ('UNREAD', 'IN_REVIEW', 'RESOLVED');
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAIL', 'QUARANTINED');
CREATE TYPE "ImportFileType" AS ENUM ('INPATIENT', 'OUTPATIENT', 'LAB');

-- ============================================================
-- Department
-- ============================================================
CREATE TABLE "Department" (
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
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");
ALTER TABLE "Department" ADD CONSTRAINT "Department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- DepartmentPermission
-- ============================================================
CREATE TABLE "DepartmentPermission" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "departmentId" TEXT NOT NULL,
    "resource" "PermissionResource" NOT NULL,
    "action" "PermissionAction" NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'OWN_DEPT',
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DepartmentPermission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DepartmentPermission_departmentId_resource_action_key" ON "DepartmentPermission"("departmentId", "resource", "action");
ALTER TABLE "DepartmentPermission" ADD CONSTRAINT "DepartmentPermission_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- User
-- ============================================================
CREATE TABLE "User" (
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
CREATE UNIQUE INDEX "User_loginId_key" ON "User"("loginId");

-- ============================================================
-- UserDepartment
-- ============================================================
CREATE TABLE "UserDepartment" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserDepartment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserDepartment_userId_departmentId_key" ON "UserDepartment"("userId", "departmentId");
ALTER TABLE "UserDepartment" ADD CONSTRAINT "UserDepartment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserDepartment" ADD CONSTRAINT "UserDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Patient
-- ============================================================
CREATE TABLE "Patient" (
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
CREATE UNIQUE INDEX "Patient_emrPatientId_key" ON "Patient"("emrPatientId");

-- ============================================================
-- Ward / Room / Bed
-- ============================================================
CREATE TABLE "Ward" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "floor" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Ward_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Ward_name_key" ON "Ward"("name");

CREATE TABLE "Room" (
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
CREATE UNIQUE INDEX "Room_wardId_name_key" ON "Room"("wardId", "name");
ALTER TABLE "Room" ADD CONSTRAINT "Room_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Bed" (
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
CREATE UNIQUE INDEX "Bed_roomId_label_key" ON "Bed"("roomId", "label");
ALTER TABLE "Bed" ADD CONSTRAINT "Bed_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Admission / BedAssignment
-- ============================================================
CREATE TABLE "Admission" (
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
CREATE UNIQUE INDEX "Admission_currentBedId_key" ON "Admission"("currentBedId");
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_attendingDoctorId_fkey" FOREIGN KEY ("attendingDoctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_currentBedId_fkey" FOREIGN KEY ("currentBedId") REFERENCES "Bed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BedAssignment" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "admissionId" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3),
    "changedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BedAssignment_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "BedAssignment" ADD CONSTRAINT "BedAssignment_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BedAssignment" ADD CONSTRAINT "BedAssignment_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- ProcedureCatalog / ProcedurePlan / ProcedureExecution
-- ============================================================
CREATE TABLE "ProcedureCatalog" (
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
CREATE UNIQUE INDEX "ProcedureCatalog_name_key" ON "ProcedureCatalog"("name");

CREATE TABLE "ProcedurePlan" (
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
ALTER TABLE "ProcedurePlan" ADD CONSTRAINT "ProcedurePlan_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcedurePlan" ADD CONSTRAINT "ProcedurePlan_procedureCatalogId_fkey" FOREIGN KEY ("procedureCatalogId") REFERENCES "ProcedureCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProcedureExecution" (
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
ALTER TABLE "ProcedureExecution" ADD CONSTRAINT "ProcedureExecution_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProcedurePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcedureExecution" ADD CONSTRAINT "ProcedureExecution_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Doctor / ClinicRoom / Appointment
-- ============================================================
CREATE TABLE "Doctor" (
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
CREATE UNIQUE INDEX "Doctor_emrDoctorId_key" ON "Doctor"("emrDoctorId");

CREATE TABLE "ClinicRoom" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "doctorId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "ClinicRoom_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClinicRoom_name_key" ON "ClinicRoom"("name");
ALTER TABLE "ClinicRoom" ADD CONSTRAINT "ClinicRoom_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Appointment" (
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
CREATE UNIQUE INDEX "Appointment_emrAppointmentId_key" ON "Appointment"("emrAppointmentId");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicRoomId_fkey" FOREIGN KEY ("clinicRoomId") REFERENCES "ClinicRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- HomecareVisit / Questionnaire
-- ============================================================
CREATE TABLE "HomecareVisit" (
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
ALTER TABLE "HomecareVisit" ADD CONSTRAINT "HomecareVisit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HomecareVisit" ADD CONSTRAINT "HomecareVisit_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Questionnaire" (
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
CREATE UNIQUE INDEX "Questionnaire_idempotencyKey_key" ON "Questionnaire"("idempotencyKey");
ALTER TABLE "Questionnaire" ADD CONSTRAINT "Questionnaire_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "HomecareVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- LabResult
-- ============================================================
CREATE TABLE "LabResult" (
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
CREATE INDEX "LabResult_patientId_collectedAt_idx" ON "LabResult"("patientId", "collectedAt");
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- UploadedFile
-- ============================================================
CREATE TABLE "UploadedFile" (
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
ALTER TABLE "UploadedFile" ADD CONSTRAINT "UploadedFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- AiReport / ReportDelivery
-- ============================================================
CREATE TABLE "AiReport" (
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
ALTER TABLE "AiReport" ADD CONSTRAINT "AiReport_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiReport" ADD CONSTRAINT "AiReport_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "HomecareVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiReport" ADD CONSTRAINT "AiReport_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiReport" ADD CONSTRAINT "AiReport_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "UploadedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiReport" ADD CONSTRAINT "AiReport_outputFileId_fkey" FOREIGN KEY ("outputFileId") REFERENCES "UploadedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ReportDelivery" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "reportId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'SYSTEM',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackAt" TIMESTAMP(3),
    CONSTRAINT "ReportDelivery_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ReportDelivery" ADD CONSTRAINT "ReportDelivery_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AiReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- InboxItem / InboxEscalation
-- ============================================================
CREATE TABLE "InboxItem" (
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
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InboxEscalation" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "inboxItemId" TEXT NOT NULL,
    "escalatedToId" TEXT NOT NULL,
    "escalatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    CONSTRAINT "InboxEscalation_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "InboxEscalation" ADD CONSTRAINT "InboxEscalation_inboxItemId_fkey" FOREIGN KEY ("inboxItemId") REFERENCES "InboxItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Import / ImportError / PatientIdentityConflict
-- ============================================================
CREATE TABLE "Import" (
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
CREATE UNIQUE INDEX "Import_fileHash_key" ON "Import"("fileHash");

CREATE TABLE "ImportError" (
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
ALTER TABLE "ImportError" ADD CONSTRAINT "ImportError_importId_fkey" FOREIGN KEY ("importId") REFERENCES "Import"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PatientIdentityConflict" (
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
ALTER TABLE "PatientIdentityConflict" ADD CONSTRAINT "PatientIdentityConflict_importId_fkey" FOREIGN KEY ("importId") REFERENCES "Import"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientIdentityConflict" ADD CONSTRAINT "PatientIdentityConflict_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- AuditLog
-- ============================================================
CREATE TABLE "AuditLog" (
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
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- MobileAccessToken
-- ============================================================
CREATE TABLE "MobileAccessToken" (
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
CREATE UNIQUE INDEX "MobileAccessToken_token_key" ON "MobileAccessToken"("token");

-- ============================================================
-- ChatSession / ChatMessage (RAG 챗봇)
-- ============================================================
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Embedding (pgvector - RAG)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "Embedding" (
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
CREATE INDEX "Embedding_entityType_entityId_idx" ON "Embedding"("entityType", "entityId");
CREATE INDEX "Embedding_vector_idx" ON "Embedding" USING ivfflat ("vector" vector_cosine_ops) WITH (lists = 100);
