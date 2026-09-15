-- Phase 14a — คำเชิญเข้าร้านทางอีเมล (StoreInvite)
-- additive อย่างเดียว: ตารางใหม่ + index + FK ไม่แตะตารางเดิม (จึงให้ Prisma ร่าง SQL ได้ แล้วตรวจด้วยตา)
-- เก็บ tokenHash (SHA-256) ไม่เก็บ token ดิบ — ลิงก์เชิญคือ credential ชั่วคราว

-- CreateTable
CREATE TABLE "store_invite" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "StoreRole" NOT NULL DEFAULT 'STAFF',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_invite_tokenHash_key" ON "store_invite"("tokenHash");

-- CreateIndex
CREATE INDEX "store_invite_storeId_idx" ON "store_invite"("storeId");

-- CreateIndex
CREATE INDEX "store_invite_email_idx" ON "store_invite"("email");

-- AddForeignKey
ALTER TABLE "store_invite" ADD CONSTRAINT "store_invite_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_invite" ADD CONSTRAINT "store_invite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_invite" ADD CONSTRAINT "store_invite_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

