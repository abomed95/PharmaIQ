-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "clientRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_pharmacyId_clientRef_key" ON "Purchase"("pharmacyId", "clientRef");

