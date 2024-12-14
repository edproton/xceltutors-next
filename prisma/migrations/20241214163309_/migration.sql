-- CreateEnum
CREATE TYPE "Role" AS ENUM ('TUTOR', 'STUDENT', 'ADMIN', 'MODERATOR');

-- CreateEnum
CREATE TYPE "MFAType" AS ENUM ('TOTP', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "AuthenticationType" AS ENUM ('OAUTH', 'CREDENTIALS');

-- CreateEnum
CREATE TYPE "BookingType" AS ENUM ('FREE_MEETING', 'LESSON');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('AWAITING_TUTOR_CONFIRMATION', 'AWAITING_STUDENT_CONFIRMATION', 'AWAITING_PAYMENT', 'PAYMENT_FAILED', 'SCHEDULED', 'CANCELED', 'COMPLETED', 'REFUNDED', 'AWAITING_REFUND', 'REFUND_FAILED');

-- CreateEnum
CREATE TYPE "RecurrencePattern" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "WeekDay" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "RecurringTemplateStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "ProviderAccount" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "oauthProviderId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "imageUrl" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ProviderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialsProvider" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastFailedAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "lastPasswordAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "passwordHistory" JSONB,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaType" "MFAType",
    "mfaSecret" TEXT,
    "backupCodes" JSONB,
    "resetToken" TEXT,
    "resetTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CredentialsProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "image" TEXT,
    "name" TEXT NOT NULL,
    "roles" "Role"[],

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "authenticationType" "AuthenticationType" NOT NULL,
    "providerAccountId" INTEGER,
    "credentialsId" INTEGER,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringTemplate" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "hostId" INTEGER NOT NULL,
    "status" "RecurringTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "recurrencePattern" "RecurrencePattern" NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,

    CONSTRAINT "RecurringTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringTimeSlot" (
    "id" SERIAL NOT NULL,
    "weekDay" "WeekDay" NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "templateId" INTEGER NOT NULL,

    CONSTRAINT "RecurringTimeSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "subjectId" INTEGER NOT NULL,

    CONSTRAINT "Level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" SERIAL NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "levelId" INTEGER NOT NULL,
    "tutorId" INTEGER NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tutor" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "bio" TEXT NOT NULL,
    "mainSession" TEXT,
    "cardSession" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tutor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "type" "BookingType" NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "hostId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "recurringTemplateId" INTEGER,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT,
    "paymentIntentId" TEXT,
    "chargeId" TEXT,
    "sessionUrl" TEXT,
    "metadata" JSONB,
    "bookingId" INTEGER NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_BookingParticipants" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_BookingParticipants_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAccount_provider_oauthProviderId_key" ON "ProviderAccount"("provider", "oauthProviderId");

-- CreateIndex
CREATE UNIQUE INDEX "CredentialsProvider_userId_key" ON "CredentialsProvider"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CredentialsProvider_email_key" ON "CredentialsProvider"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CredentialsProvider_resetToken_key" ON "CredentialsProvider"("resetToken");

-- CreateIndex
CREATE INDEX "Session_providerAccountId_idx" ON "Session"("providerAccountId");

-- CreateIndex
CREATE INDEX "Session_credentialsId_idx" ON "Session"("credentialsId");

-- CreateIndex
CREATE INDEX "RecurringTemplate_hostId_idx" ON "RecurringTemplate"("hostId");

-- CreateIndex
CREATE INDEX "RecurringTimeSlot_weekDay_startTime_idx" ON "RecurringTimeSlot"("weekDay", "startTime");

-- CreateIndex
CREATE INDEX "RecurringTimeSlot_templateId_weekDay_idx" ON "RecurringTimeSlot"("templateId", "weekDay");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringTimeSlot_templateId_weekDay_startTime_key" ON "RecurringTimeSlot"("templateId", "weekDay", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_name_key" ON "Subject"("name");

-- CreateIndex
CREATE INDEX "Level_subjectId_idx" ON "Level"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Level_name_subjectId_key" ON "Level"("name", "subjectId");

-- CreateIndex
CREATE INDEX "Service_tutorId_idx" ON "Service"("tutorId");

-- CreateIndex
CREATE INDEX "Service_levelId_idx" ON "Service"("levelId");

-- CreateIndex
CREATE UNIQUE INDEX "Service_tutorId_levelId_key" ON "Service"("tutorId", "levelId");

-- CreateIndex
CREATE UNIQUE INDEX "Tutor_userId_key" ON "Tutor"("userId");

-- CreateIndex
CREATE INDEX "Tutor_userId_idx" ON "Tutor"("userId");

-- CreateIndex
CREATE INDEX "Booking_hostId_status_type_idx" ON "Booking"("hostId", "status", "type");

-- CreateIndex
CREATE INDEX "Booking_hostId_startTime_idx" ON "Booking"("hostId", "startTime");

-- CreateIndex
CREATE INDEX "Booking_hostId_status_startTime_idx" ON "Booking"("hostId", "status", "startTime");

-- CreateIndex
CREATE INDEX "Booking_status_startTime_idx" ON "Booking"("status", "startTime");

-- CreateIndex
CREATE INDEX "Booking_hostId_idx" ON "Booking"("hostId");

-- CreateIndex
CREATE INDEX "Booking_serviceId_idx" ON "Booking"("serviceId");

-- CreateIndex
CREATE INDEX "Booking_recurringTemplateId_idx" ON "Booking"("recurringTemplateId");

-- CreateIndex
CREATE INDEX "Booking_startTime_endTime_idx" ON "Booking"("startTime", "endTime");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_sessionId_key" ON "Payment"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentIntentId_key" ON "Payment"("paymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_bookingId_key" ON "Payment"("bookingId");

-- CreateIndex
CREATE INDEX "_BookingParticipants_B_index" ON "_BookingParticipants"("B");

-- AddForeignKey
ALTER TABLE "ProviderAccount" ADD CONSTRAINT "ProviderAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialsProvider" ADD CONSTRAINT "CredentialsProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "ProviderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_credentialsId_fkey" FOREIGN KEY ("credentialsId") REFERENCES "CredentialsProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringTemplate" ADD CONSTRAINT "RecurringTemplate_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringTimeSlot" ADD CONSTRAINT "RecurringTimeSlot_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecurringTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level" ADD CONSTRAINT "Level_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tutor" ADD CONSTRAINT "Tutor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "RecurringTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BookingParticipants" ADD CONSTRAINT "_BookingParticipants_A_fkey" FOREIGN KEY ("A") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BookingParticipants" ADD CONSTRAINT "_BookingParticipants_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
