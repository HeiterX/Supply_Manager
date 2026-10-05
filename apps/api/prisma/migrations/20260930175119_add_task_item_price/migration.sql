-- AlterTable
ALTER TABLE "TaskItem" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'RUB',
ADD COLUMN     "unitPrice" DECIMAL(14,2);
