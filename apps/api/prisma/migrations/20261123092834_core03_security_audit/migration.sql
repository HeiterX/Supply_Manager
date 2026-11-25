-- CreateTable
CREATE TABLE "SecurityAuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecurityAuditEvent_actorId_createdAt_idx" ON "SecurityAuditEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityAuditEvent_targetUserId_createdAt_idx" ON "SecurityAuditEvent"("targetUserId", "createdAt");
