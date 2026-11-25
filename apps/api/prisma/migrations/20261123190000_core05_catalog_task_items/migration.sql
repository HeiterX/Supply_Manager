-- CORE-05: non-destructive shared catalog and task-item audit.
-- All existing TaskItem rows remain valid without a catalog reference.
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "partNumber" TEXT,
    "normalizedPartNumber" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Без категории',
    "unit" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "fingerprint" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogItem_fingerprint_key" ON "CatalogItem"("fingerprint");
CREATE INDEX "CatalogItem_normalizedName_idx" ON "CatalogItem"("normalizedName");
CREATE INDEX "CatalogItem_normalizedPartNumber_idx" ON "CatalogItem"("normalizedPartNumber");
CREATE INDEX "CatalogItem_category_idx" ON "CatalogItem"("category");

ALTER TABLE "TaskItem"
    ADD COLUMN "catalogItemId" TEXT,
    ADD COLUMN "sourceRequestItemId" TEXT,
    ADD COLUMN "originalSnapshot" JSONB,
    ADD COLUMN "technicalParameters" JSONB,
    ADD COLUMN "requiredAt" TIMESTAMP(3);

CREATE INDEX "TaskItem_catalogItemId_idx" ON "TaskItem"("catalogItemId");
CREATE INDEX "TaskItem_sourceRequestItemId_idx" ON "TaskItem"("sourceRequestItemId");

ALTER TABLE "TaskItem"
    ADD CONSTRAINT "TaskItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId")
    REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskItem"
    ADD CONSTRAINT "TaskItem_sourceRequestItemId_fkey" FOREIGN KEY ("sourceRequestItemId")
    REFERENCES "PurchaseRequestItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TaskItemChange" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "taskItemId" TEXT,
    "itemLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskItemChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskItemChange_taskId_createdAt_idx" ON "TaskItemChange"("taskId", "createdAt");
CREATE INDEX "TaskItemChange_taskItemId_idx" ON "TaskItemChange"("taskItemId");
ALTER TABLE "TaskItemChange"
    ADD CONSTRAINT "TaskItemChange_taskId_fkey" FOREIGN KEY ("taskId")
    REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskItemChange"
    ADD CONSTRAINT "TaskItemChange_taskItemId_fkey" FOREIGN KEY ("taskItemId")
    REFERENCES "TaskItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
