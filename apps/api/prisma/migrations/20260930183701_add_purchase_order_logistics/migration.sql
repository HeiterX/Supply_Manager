-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "expectedDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "handedOverAt" TIMESTAMP(3),
ADD COLUMN     "handedOverTo" TEXT,
ADD COLUMN     "readyForPickupAt" TIMESTAMP(3),
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "trackingNumber" TEXT;
