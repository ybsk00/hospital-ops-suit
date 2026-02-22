-- Phase 9: 입원현황 + 외래예약 (Google Sheets 미러)
-- WardBed, WardAdmission, WardWaitingMemo, OutpatientAppointment

-- CreateEnum
CREATE TYPE "WardType" AS ENUM ('SINGLE', 'DOUBLE', 'QUAD');

-- CreateEnum
CREATE TYPE "BedPos" AS ENUM ('SINGLE', 'DOOR', 'MIDDLE', 'INNER_LEFT', 'INNER_RIGHT', 'INNER', 'WINDOW');

-- CreateEnum
CREATE TYPE "WardAdmissionStatus" AS ENUM ('ADMITTED', 'PLANNED', 'WAITING', 'DISCHARGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WardSheetRegion" AS ENUM ('CURRENT', 'PLANNED', 'SIDE_MEMO');

-- CreateEnum
CREATE TYPE "UpdateSource" AS ENUM ('SHEET', 'WEB');

-- CreateTable WardBed
CREATE TABLE "WardBed" (
    "id" TEXT NOT NULL,
    "bedKey" TEXT NOT NULL,
    "wardType" "WardType" NOT NULL,
    "roomNumber" TEXT NOT NULL,
    "bedPosition" "BedPos" NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WardBed_pkey" PRIMARY KEY ("id")
);

-- CreateTable WardAdmission
CREATE TABLE "WardAdmission" (
    "id" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "patientId" TEXT,
    "patientNameRaw" TEXT,
    "diagnosis" TEXT,
    "admitDate" TIMESTAMP(3),
    "dischargeDate" TIMESTAMP(3),
    "dischargeTime" TEXT,
    "status" "WardAdmissionStatus" NOT NULL DEFAULT 'ADMITTED',
    "isPlanned" BOOLEAN NOT NULL DEFAULT false,
    "memoRaw" TEXT,
    "note" TEXT,
    "sheetTab" TEXT NOT NULL,
    "sheetA1" TEXT NOT NULL,
    "sheetRegion" "WardSheetRegion" NOT NULL,
    "sheetLineIndex" INTEGER NOT NULL DEFAULT 0,
    "sheetSyncedAt" TIMESTAMP(3),
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "needsSheetWriteback" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdatedSource" "UpdateSource" NOT NULL DEFAULT 'SHEET',
    "sheetLockedUntil" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WardAdmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable WardWaitingMemo
CREATE TABLE "WardWaitingMemo" (
    "id" TEXT NOT NULL,
    "wardType" "WardType" NOT NULL,
    "content" TEXT NOT NULL,
    "parsedItems" JSONB,
    "sheetTab" TEXT,
    "sheetA1" TEXT,
    "sheetSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WardWaitingMemo_pkey" PRIMARY KEY ("id")
);

-- CreateTable OutpatientAppointment
CREATE TABLE "OutpatientAppointment" (
    "id" TEXT NOT NULL,
    "appointmentDate" TIMESTAMP(3) NOT NULL,
    "timeSlot" TEXT NOT NULL,
    "doctorCode" TEXT,
    "slotIndex" INTEGER NOT NULL,
    "patientId" TEXT,
    "patientNameRaw" TEXT,
    "isNewPatient" BOOLEAN NOT NULL DEFAULT false,
    "phoneNumber" TEXT,
    "treatmentContent" TEXT,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "rawCellValue" TEXT,
    "sheetTab" TEXT NOT NULL,
    "sheetA1Name" TEXT NOT NULL,
    "sheetA1Doctor" TEXT,
    "sheetA1Phone" TEXT,
    "sheetA1Content" TEXT,
    "sourceKey" TEXT,
    "sheetSyncedAt" TIMESTAMP(3),
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "needsSheetWriteback" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdatedSource" "UpdateSource" NOT NULL DEFAULT 'SHEET',
    "sheetLockedUntil" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutpatientAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WardBed_bedKey_key" ON "WardBed"("bedKey");

-- CreateIndex
CREATE INDEX "WardAdmission_bedId_status_idx" ON "WardAdmission"("bedId", "status");

-- CreateIndex
CREATE INDEX "WardAdmission_admitDate_dischargeDate_idx" ON "WardAdmission"("admitDate", "dischargeDate");

-- CreateIndex
CREATE UNIQUE INDEX "WardAdmission_bedId_sheetTab_sheetA1_sheetRegion_sheetLineIndex_deletedAt_key" ON "WardAdmission"("bedId", "sheetTab", "sheetA1", "sheetRegion", "sheetLineIndex", "deletedAt");

-- CreateIndex
CREATE INDEX "OutpatientAppointment_appointmentDate_timeSlot_doctorCode_slotIndex_idx" ON "OutpatientAppointment"("appointmentDate", "timeSlot", "doctorCode", "slotIndex");

-- CreateIndex
CREATE INDEX "OutpatientAppointment_appointmentDate_status_idx" ON "OutpatientAppointment"("appointmentDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OutpatientAppointment_sheetTab_sheetA1Name_deletedAt_key" ON "OutpatientAppointment"("sheetTab", "sheetA1Name", "deletedAt");

-- AddForeignKey
ALTER TABLE "WardAdmission" ADD CONSTRAINT "WardAdmission_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "WardBed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WardAdmission" ADD CONSTRAINT "WardAdmission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutpatientAppointment" ADD CONSTRAINT "OutpatientAppointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
