-- DropIndex
DROP INDEX "PurchaseOrder_supplierOfferId_key";

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierOfferId_idx" ON "PurchaseOrder"("supplierOfferId");
