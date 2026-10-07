-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('ORDERED', 'WAITING_PAYMENT', 'WAITING_SHIPMENT', 'IN_TRANSIT', 'READY_FOR_PICKUP', 'RECEIVED', 'HANDED_OVER', 'CANCELLED');

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'ORDERED';

-- CreateTable
CREATE TABLE "SupplierOfferItem" (
    "id" TEXT NOT NULL,
    "supplierOfferId" TEXT NOT NULL,
    "taskItemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "inStock" BOOLEAN,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierOfferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "taskItemId" TEXT,
    "supplierOfferItemId" TEXT,
    "name" TEXT NOT NULL,
    "partNumber" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierOfferItem_taskItemId_idx" ON "SupplierOfferItem"("taskItemId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierOfferItem_supplierOfferId_taskItemId_key" ON "SupplierOfferItem"("supplierOfferId", "taskItemId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_taskItemId_idx" ON "PurchaseOrderItem"("taskItemId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_supplierOfferItemId_idx" ON "PurchaseOrderItem"("supplierOfferItemId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- AddForeignKey
ALTER TABLE "SupplierOfferItem" ADD CONSTRAINT "SupplierOfferItem_supplierOfferId_fkey" FOREIGN KEY ("supplierOfferId") REFERENCES "SupplierOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOfferItem" ADD CONSTRAINT "SupplierOfferItem_taskItemId_fkey" FOREIGN KEY ("taskItemId") REFERENCES "TaskItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_taskItemId_fkey" FOREIGN KEY ("taskItemId") REFERENCES "TaskItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_supplierOfferItemId_fkey" FOREIGN KEY ("supplierOfferItemId") REFERENCES "SupplierOfferItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill PurchaseOrderStatus from legacy lifecycle timestamps.
-- Проверяем этапы от самого позднего к самому раннему.
UPDATE "PurchaseOrder"
SET "status" = CASE
  WHEN "cancelledAt" IS NOT NULL
    THEN 'CANCELLED'::"PurchaseOrderStatus"
  WHEN "handedOverAt" IS NOT NULL
    THEN 'HANDED_OVER'::"PurchaseOrderStatus"
  WHEN "receivedAt" IS NOT NULL
    THEN 'RECEIVED'::"PurchaseOrderStatus"
  WHEN "readyForPickupAt" IS NOT NULL
    THEN 'READY_FOR_PICKUP'::"PurchaseOrderStatus"
  WHEN "shippedAt" IS NOT NULL
    THEN 'IN_TRANSIT'::"PurchaseOrderStatus"
  WHEN "paidAt" IS NOT NULL
    THEN 'WAITING_SHIPMENT'::"PurchaseOrderStatus"
  WHEN "sentToPaymentAt" IS NOT NULL
    THEN 'WAITING_PAYMENT'::"PurchaseOrderStatus"
  ELSE 'ORDERED'::"PurchaseOrderStatus"
END;

