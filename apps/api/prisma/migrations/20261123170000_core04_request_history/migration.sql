-- Назначение ответственного
ALTER TABLE "PurchaseRequest"
ADD COLUMN "assignedToId" TEXT;

CREATE INDEX "PurchaseRequest_assignedToId_idx"
ON "PurchaseRequest"("assignedToId");

ALTER TABLE "PurchaseRequest"
ADD CONSTRAINT "PurchaseRequest_assignedToId_fkey"
FOREIGN KEY ("assignedToId")
REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- История решений по заявкам
CREATE TABLE "PurchaseRequestHistory" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" "PurchaseRequestStatus",
    "toStatus" "PurchaseRequestStatus" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRequestHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseRequestHistory_requestId_createdAt_idx"
ON "PurchaseRequestHistory"("requestId", "createdAt");

ALTER TABLE "PurchaseRequestHistory"
ADD CONSTRAINT "PurchaseRequestHistory_requestId_fkey"
FOREIGN KEY ("requestId")
REFERENCES "PurchaseRequest"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
