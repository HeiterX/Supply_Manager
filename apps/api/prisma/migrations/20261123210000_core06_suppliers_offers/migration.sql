-- CORE-06 — backward-compatible supplier directory and quotation history.
-- Legacy suppliers and quotations remain untouched. Nullable normalizedName
-- intentionally allows existing duplicates to be resolved manually later.
CREATE TYPE "SupplierDirectoryStatus" AS ENUM ('ACTIVE', 'PAUSED', 'BLOCKED');

ALTER TABLE "Supplier"
  ADD COLUMN "normalizedName" TEXT,
  ADD COLUMN "taxId" TEXT,
  ADD COLUMN "legalAddress" TEXT,
  ADD COLUMN "bankDetails" TEXT,
  ADD COLUMN "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "status" "SupplierDirectoryStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "responsibleId" TEXT;

CREATE UNIQUE INDEX "Supplier_normalizedName_key" ON "Supplier"("normalizedName");
CREATE UNIQUE INDEX "Supplier_taxId_key" ON "Supplier"("taxId");
CREATE INDEX "Supplier_status_idx" ON "Supplier"("status");
CREATE INDEX "Supplier_responsibleId_idx" ON "Supplier"("responsibleId");
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_responsibleId_fkey"
  FOREIGN KEY ("responsibleId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SupplierChange" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupplierChange_supplierId_createdAt_idx"
  ON "SupplierChange"("supplierId", "createdAt");
ALTER TABLE "SupplierChange" ADD CONSTRAINT "SupplierChange_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierOffer"
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "validUntil" TIMESTAMP(3),
  ADD COLUMN "paymentTerms" TEXT,
  ADD COLUMN "deliveryTerms" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "decisionReason" TEXT,
  ADD COLUMN "decidedById" TEXT,
  ADD COLUMN "decidedAt" TIMESTAMP(3);

-- Historical quotes had RUB-only semantics; keep them correctly labelled.
UPDATE "SupplierOffer" SET "currency" = 'RUB' WHERE "price" IS NOT NULL;
CREATE INDEX "SupplierOffer_validUntil_idx" ON "SupplierOffer"("validUntil");

CREATE TABLE "SupplierOfferRevision" (
  "id" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierOfferRevision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupplierOfferRevision_offerId_version_idx"
  ON "SupplierOfferRevision"("offerId", "version");
ALTER TABLE "SupplierOfferRevision" ADD CONSTRAINT "SupplierOfferRevision_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "SupplierOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SupplierOfferDocument" (
  "id" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "originalName" TEXT NOT NULL,
  "storageName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierOfferDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupplierOfferDocument_storageName_key"
  ON "SupplierOfferDocument"("storageName");
CREATE INDEX "SupplierOfferDocument_offerId_createdAt_idx"
  ON "SupplierOfferDocument"("offerId", "createdAt");
ALTER TABLE "SupplierOfferDocument" ADD CONSTRAINT "SupplierOfferDocument_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "SupplierOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
