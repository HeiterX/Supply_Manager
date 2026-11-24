-- CORE-07: non-destructive idempotency keys and versioned order audit.
-- Existing orders retain version=1 and null idempotency keys.
ALTER TABLE "PurchaseOrder"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestFingerprint" TEXT;

CREATE UNIQUE INDEX "PurchaseOrder_taskId_idempotencyKey_key"
  ON "PurchaseOrder"("taskId", "idempotencyKey");

CREATE TABLE "PurchaseOrderRevision" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "actorId" TEXT,
  "before" JSONB,
  "after" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseOrderRevision_purchaseOrderId_version_idx"
  ON "PurchaseOrderRevision"("purchaseOrderId", "version");
CREATE INDEX "PurchaseOrderRevision_createdAt_idx"
  ON "PurchaseOrderRevision"("createdAt");
ALTER TABLE "PurchaseOrderRevision"
  ADD CONSTRAINT "PurchaseOrderRevision_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
