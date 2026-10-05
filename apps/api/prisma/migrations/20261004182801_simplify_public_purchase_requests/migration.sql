-- DropForeignKey
ALTER TABLE "PurchaseRequest" DROP CONSTRAINT "PurchaseRequest_requesterId_fkey";

-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "requesterName" TEXT,
ALTER COLUMN "requesterId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PurchaseRequestItem" ADD COLUMN     "photoMimeType" TEXT,
ADD COLUMN     "photoOriginalName" TEXT,
ADD COLUMN     "photoPath" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
