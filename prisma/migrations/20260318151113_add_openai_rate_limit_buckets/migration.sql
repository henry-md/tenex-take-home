-- CreateEnum
CREATE TYPE "OpenAIRateLimitWindow" AS ENUM ('MINUTE', 'DAY');

-- CreateTable
CREATE TABLE "OpenAIRateLimitBucket" (
    "ownerEmail" TEXT NOT NULL,
    "windowType" "OpenAIRateLimitWindow" NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenAIRateLimitBucket_pkey" PRIMARY KEY ("ownerEmail","windowType","windowStart")
);

-- CreateIndex
CREATE INDEX "OpenAIRateLimitBucket_windowType_windowStart_idx" ON "OpenAIRateLimitBucket"("windowType", "windowStart");
