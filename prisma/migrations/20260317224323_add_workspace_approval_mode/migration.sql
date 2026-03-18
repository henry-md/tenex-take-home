-- CreateEnum
CREATE TYPE "WorkspaceApprovalMode" AS ENUM ('SAFE', 'BULK_EMAIL_ONLY', 'DANGEROUS');

-- CreateTable
CREATE TABLE "WorkspaceApprovalPreference" (
    "ownerEmail" TEXT NOT NULL,
    "mode" "WorkspaceApprovalMode" NOT NULL DEFAULT 'SAFE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceApprovalPreference_pkey" PRIMARY KEY ("ownerEmail")
);
