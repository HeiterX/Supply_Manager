/*
  Warnings:

  - A unique constraint covering the columns `[selectedOfferId]` on the table `Task` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "selectedOfferId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Task_selectedOfferId_key" ON "Task"("selectedOfferId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_selectedOfferId_fkey" FOREIGN KEY ("selectedOfferId") REFERENCES "SupplierOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
