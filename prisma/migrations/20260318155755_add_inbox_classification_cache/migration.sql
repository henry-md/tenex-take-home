-- CreateTable
CREATE TABLE "InboxClassificationCache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "cacheKeyHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "InboxClassificationCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboxClassificationCache_ownerId_updatedAt_idx" ON "InboxClassificationCache"("ownerId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboxClassificationCache_ownerId_cacheKeyHash_key" ON "InboxClassificationCache"("ownerId", "cacheKeyHash");

-- AddForeignKey
ALTER TABLE "InboxClassificationCache" ADD CONSTRAINT "InboxClassificationCache_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
