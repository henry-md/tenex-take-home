-- CreateEnum
CREATE TYPE "OpenAIChatMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "OpenAIChatMessage" (
    "id" TEXT NOT NULL,
    "role" "OpenAIChatMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "OpenAIChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpenAIChatMessage_ownerId_createdAt_idx" ON "OpenAIChatMessage"("ownerId", "createdAt");

-- AddForeignKey
ALTER TABLE "OpenAIChatMessage" ADD CONSTRAINT "OpenAIChatMessage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
