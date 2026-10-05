/*
  Warnings:

  - A unique constraint covering the columns `[currentPurchaseOrderId]` on the table `Task` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "PurchaseOrder_taskId_key";

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "currentPurchaseOrderId" TEXT;

-- CreateTable
CREATE TABLE "TaskItem" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partNumber" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskItem_taskId_idx" ON "TaskItem"("taskId");

-- CreateIndex
CREATE INDEX "TaskItem_name_idx" ON "TaskItem"("name");

-- CreateIndex
CREATE INDEX "PurchaseOrder_taskId_idx" ON "PurchaseOrder"("taskId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_cancelledAt_idx" ON "PurchaseOrder"("cancelledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_currentPurchaseOrderId_key" ON "Task"("currentPurchaseOrderId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_currentPurchaseOrderId_fkey" FOREIGN KEY ("currentPurchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskItem" ADD CONSTRAINT "TaskItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
