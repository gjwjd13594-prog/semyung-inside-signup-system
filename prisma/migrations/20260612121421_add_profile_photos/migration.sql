-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "datingVisible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "photoRejectReason" TEXT,
ADD COLUMN     "photoStatus" "PhotoStatus" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "ProfilePhoto" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "phash" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfilePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfilePhoto_userId_idx" ON "ProfilePhoto"("userId");

-- CreateIndex
CREATE INDEX "ProfilePhoto_sha256_idx" ON "ProfilePhoto"("sha256");

-- AddForeignKey
ALTER TABLE "ProfilePhoto" ADD CONSTRAINT "ProfilePhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
