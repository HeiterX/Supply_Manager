-- CreateEnum
CREATE TYPE "SupplierOfferStatus" AS ENUM ('REQUESTED', 'WAITING_RESPONSE', 'OFFER_RECEIVED', 'NEGOTIATION', 'SELECTED', 'REJECTED');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierOffer" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "SupplierOfferStatus" NOT NULL DEFAULT 'REQUESTED',
    "price" DECIMAL(14,2),
    "deliveryPrice" DECIMAL(14,2),
    "deliveryDays" INTEGER,
    "inStock" BOOLEAN,
    "notes" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "SupplierOffer_taskId_idx" ON "SupplierOffer"("taskId");

-- CreateIndex
CREATE INDEX "SupplierOffer_supplierId_idx" ON "SupplierOffer"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierOffer_status_idx" ON "SupplierOffer"("status");

-- AddForeignKey
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
