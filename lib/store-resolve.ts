import "server-only"
import { cache } from "react"
import { prisma } from "@/lib/prisma"

/// หา "ร้าน" จากค่าที่เดินทางออกนอกระบบ (Phase 13) — ที่เดียวที่อนุญาตให้ค้นข้ามร้านได้
///
/// ฝั่งลูกค้าไม่มี session/cookie มีแค่ qrToken ใน URL · ธนาคารมีแค่ ref1 ใน callback
/// ทั้งสองค่า unique ทั้งระบบ (ไม่ใช่ต่อร้าน) จึงชี้ร้านได้จากค่าเดียว — หลังจากนี้ทุก query
/// ต้องผ่าน forStore(storeId) ตามปกติ

/// planExpiresAt (Phase 14b) — ฝั่งลูกค้าต้องรู้ว่าร้าน "ยังขายได้" ไหมตั้งแต่ตอนหาร้าน (null = ยังไม่มีแพ็กเกจ)
export type ResolvedStore = { storeId: string; slug: string; status: "ACTIVE" | "SUSPENDED"; planExpiresAt: Date | null }

/// `cache()` — หน้า/layout/route ฝั่งลูกค้าเรียกซ้ำหลายจุดในคำขอเดียว ยิง query ครั้งเดียวพอ
export const findStoreByQrToken = cache(async (qrToken: string): Promise<ResolvedStore | null> => {
  const qr = await prisma.qRCode.findUnique({
    where: { token: qrToken },
    select: { store: { select: { id: true, slug: true, status: true, planExpiresAt: true } } },
  })
  if (!qr) return null
  return { storeId: qr.store.id, slug: qr.store.slug, status: qr.store.status, planExpiresAt: qr.store.planExpiresAt }
})

export async function findStoreByPaymentRef1(ref1: string): Promise<ResolvedStore | null> {
  const intent = await prisma.paymentIntent.findUnique({
    where: { ref1 },
    select: { store: { select: { id: true, slug: true, status: true, planExpiresAt: true } } },
  })
  if (!intent) return null
  return { storeId: intent.store.id, slug: intent.store.slug, status: intent.store.status, planExpiresAt: intent.store.planExpiresAt }
}

/// คำเชิญเข้าร้าน (Phase 14a) — ลิงก์ในอีเมลมีแค่ token จึงต้องหาร้านจาก hash ของมันเช่นเดียวกัน
export async function findStoreByInviteTokenHash(tokenHash: string): Promise<ResolvedStore | null> {
  const invite = await prisma.storeInvite.findUnique({
    where: { tokenHash },
    select: { store: { select: { id: true, slug: true, status: true, planExpiresAt: true } } },
  })
  if (!invite) return null
  return { storeId: invite.store.id, slug: invite.store.slug, status: invite.store.status, planExpiresAt: invite.store.planExpiresAt }
}

/// ตอบรับคำเชิญจากหน้า /no-store ด้วย id (ผู้ใช้สมัครผ่านลิงก์เชิญแล้วผ่านการยืนยันอีเมลจน URL หาย)
export async function findStoreByInviteId(inviteId: string): Promise<ResolvedStore | null> {
  const invite = await prisma.storeInvite.findUnique({
    where: { id: inviteId },
    select: { store: { select: { id: true, slug: true, status: true, planExpiresAt: true } } },
  })
  if (!invite) return null
  return { storeId: invite.store.id, slug: invite.store.slug, status: invite.store.status, planExpiresAt: invite.store.planExpiresAt }
}

export type PendingInviteForUser = {
  id: string
  storeId: string
  storeName: string
  role: "OWNER" | "STAFF"
  inviterName: string
  expiresAt: Date
}

/// คำเชิญที่ค้างอยู่ของอีเมลนี้ (ทุกร้าน) — ข้อมูล "ของตัวผู้ใช้" ไม่ใช่ของร้าน จึงค้นข้ามร้านได้ที่นี่
/// ใช้แสดงบน /no-store และ /onboarding ให้คนที่ถูกเชิญกดเข้าร่วมได้แม้ลิงก์ในอีเมลหายไประหว่างสมัคร
export async function listPendingInvitesForEmail(email: string): Promise<PendingInviteForUser[]> {
  const rows = await prisma.storeInvite.findMany({
    where: {
      email: email.trim().toLowerCase(),
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      store: { status: "ACTIVE" },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      storeId: true,
      role: true,
      expiresAt: true,
      store: { select: { name: true } },
      invitedBy: { select: { name: true } },
    },
  })
  return rows.map((r) => ({
    id: r.id,
    storeId: r.storeId,
    storeName: r.store.name,
    role: r.role,
    inviterName: r.invitedBy.name,
    expiresAt: r.expiresAt,
  }))
}

/// callback ของ SCB แบบต่อร้าน (Phase 15c) — URL มี token ของร้าน หาร้านจาก StorePaymentConfig.scbWebhookToken (unique)
export async function findStoreByScbWebhookToken(token: string): Promise<ResolvedStore | null> {
  if (!token) return null
  const config = await prisma.storePaymentConfig.findUnique({
    where: { scbWebhookToken: token },
    select: { store: { select: { id: true, slug: true, status: true, planExpiresAt: true } } },
  })
  if (!config) return null
  return { storeId: config.store.id, slug: config.store.slug, status: config.store.status, planExpiresAt: config.store.planExpiresAt }
}

/// ทดสอบการเชื่อมต่อ SCB (Phase 15c) — ref1 ของ QR 1 บาทที่รอ callback อยู่ unique ทั้งระบบเหมือน PaymentIntent.ref1
export async function findStoreByScbTestRef1(ref1: string): Promise<ResolvedStore | null> {
  const config = await prisma.storePaymentConfig.findUnique({
    where: { scbTestRef1: ref1 },
    select: { store: { select: { id: true, slug: true, status: true, planExpiresAt: true } } },
  })
  if (!config) return null
  return { storeId: config.store.id, slug: config.store.slug, status: config.store.status, planExpiresAt: config.store.planExpiresAt }
}
