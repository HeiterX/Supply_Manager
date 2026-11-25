-- AlterTable
-- Legacy env-based bindings did not prove account ownership. Require secure relinking.
UPDATE "User" SET "telegramChatId" = NULL WHERE "telegramChatId" IS NOT NULL;

ALTER TABLE "User" ADD COLUMN     "telegramMuted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telegramUsername" TEXT;

-- CreateTable
CREATE TABLE "TelegramLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "chatId" TEXT,
    "username" TEXT,

    CONSTRAINT "TelegramLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramSubscription" (
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TelegramSubscription_pkey" PRIMARY KEY ("userId","category")
);

-- CreateTable
CREATE TABLE "TelegramUpdateReceipt" (
    "updateId" BIGINT NOT NULL,
    "callbackId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramUpdateReceipt_pkey" PRIMARY KEY ("updateId")
);

-- CreateTable
CREATE TABLE "TelegramRate" (
    "chatId" TEXT NOT NULL,
    "window" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TelegramRate_pkey" PRIMARY KEY ("chatId")
);

-- CreateTable
CREATE TABLE "TelegramButton" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "TelegramButton_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramDelivery" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "userId" TEXT,
    "chatId" TEXT NOT NULL,
    "category" TEXT,
    "procurementOnly" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT NOT NULL,
    "keyboard" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "messageId" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_tokenHash_key" ON "TelegramLink"("tokenHash");

-- CreateIndex
CREATE INDEX "TelegramLink_userId_idx" ON "TelegramLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramUpdateReceipt_callbackId_key" ON "TelegramUpdateReceipt"("callbackId");

-- CreateIndex
CREATE INDEX "TelegramDelivery_status_availableAt_idx" ON "TelegramDelivery"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramDelivery_eventKey_recipientKey_key" ON "TelegramDelivery"("eventKey", "recipientKey");

-- AddForeignKey
ALTER TABLE "TelegramLink" ADD CONSTRAINT "TelegramLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramSubscription" ADD CONSTRAINT "TelegramSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramDelivery" ADD CONSTRAINT "TelegramDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
