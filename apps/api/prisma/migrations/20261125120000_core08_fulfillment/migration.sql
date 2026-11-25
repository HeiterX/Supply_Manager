-- CreateEnum
CREATE TYPE "FulfillmentEventKind" AS ENUM ('RECEIPT', 'RETURN', 'HANDOVER', 'DISCREPANCY', 'RESOLUTION');

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "ledgerEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "dueOn" DATE,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "comment" TEXT,
    "documentId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paidOn" DATE NOT NULL,
    "reference" TEXT NOT NULL,
    "comment" TEXT,
    "documentId" TEXT,
    "actorId" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "shippedOn" DATE,
    "expectedOn" DATE,
    "arrivedOn" DATE,
    "shortClosedAt" TIMESTAMP(3),
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "comment" TEXT,
    "actorId" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentEvent" (
    "id" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "shipmentItemId" TEXT,
    "kind" "FulfillmentEventKind" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "occurredOn" DATE NOT NULL,
    "comment" TEXT,
    "reason" TEXT,
    "documentId" TEXT,
    "actorId" TEXT NOT NULL,
    "resolvesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FulfillmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentOperation" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "orderId" TEXT,
    "actorId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FulfillmentOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_purchaseOrderId_number_key" ON "Invoice"("purchaseOrderId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_invoiceId_reference_key" ON "Payment"("invoiceId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_purchaseOrderId_number_key" ON "Shipment"("purchaseOrderId", "number");

-- CreateIndex
CREATE INDEX "ShipmentItem_purchaseOrderItemId_idx" ON "ShipmentItem"("purchaseOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentItem_shipmentId_purchaseOrderItemId_key" ON "ShipmentItem"("shipmentId", "purchaseOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentEvent_resolvesId_key" ON "FulfillmentEvent"("resolvesId");

-- CreateIndex
CREATE INDEX "FulfillmentEvent_purchaseOrderItemId_idx" ON "FulfillmentEvent"("purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "FulfillmentEvent_shipmentItemId_idx" ON "FulfillmentEvent"("shipmentItemId");

-- CreateIndex
CREATE INDEX "FulfillmentOperation_taskId_createdAt_idx" ON "FulfillmentOperation"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentOperation_taskId_key_key" ON "FulfillmentOperation"("taskId", "key");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentEvent" ADD CONSTRAINT "FulfillmentEvent_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentEvent" ADD CONSTRAINT "FulfillmentEvent_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "ShipmentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentEvent" ADD CONSTRAINT "FulfillmentEvent_resolvesId_fkey" FOREIGN KEY ("resolvesId") REFERENCES "FulfillmentEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentOperation" ADD CONSTRAINT "FulfillmentOperation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep direct writes within the same basic invariants as the application.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_positive_amount" CHECK ("amount" > 0),
  ADD CONSTRAINT "Invoice_due_on_or_after_issue" CHECK ("dueOn" IS NULL OR "dueOn" >= "issuedOn");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_positive_amount" CHECK ("amount" > 0);
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_positive_quantity" CHECK ("quantity" > 0);
ALTER TABLE "FulfillmentEvent" ADD CONSTRAINT "FulfillmentEvent_positive_quantity" CHECK ("quantity" > 0),
  ADD CONSTRAINT "FulfillmentEvent_resolution_reference" CHECK (("kind" = 'RESOLUTION') = ("resolvesId" IS NOT NULL));
