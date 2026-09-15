import "server-only"
import { cache } from "react"
import { prisma } from "@/lib/prisma"

/// หา "ร้าน" จากค่าที่เดินทางออกนอกระบบ (Phase 13) — ที่เดียวที่อนุญาตให้ค้นข้ามร้านได้
///
/// ฝั่งลูกค้าไม่มี session/cookie มีแค่ qrToken ใน URL · ธนาคารมีแค่ ref1 ใน callback
/// ทั้งสองค่า unique ทั้งระบบ (ไม่ใช่ต่อร้าน) จึงชี้ร้านได้จากค่าเดียว — หลังจากนี้ทุก query
/// ต้องผ่าน forStore(storeId) ตามปกติ

export type ResolvedStore = { storeId: string; slug: string; status: "ACTIVE" | "SUSPENDED" }

/// `cache()` — หน้า/layout/route ฝั่งลูกค้าเรียกซ้ำหลายจุดในคำขอเดียว ยิง query ครั้งเดียวพอ
export const findStoreByQrToken = cache(async (qrToken: string): Promise<ResolvedStore | null> => {
  const qr = await prisma.qRCode.findUnique({
    where: { token: qrToken },
    select: { store: { select: { id: true, slug: true, status: true } } },
  })
  if (!qr) return null
  return { storeId: qr.store.id, slug: qr.store.slug, status: qr.store.status }
})

export async function findStoreByPaymentRef1(ref1: string): Promise<ResolvedStore | null> {
  const intent = await prisma.paymentIntent.findUnique({
    where: { ref1 },
    select: { store: { select: { id: true, slug: true, status: true } } },
  })
  if (!intent) return null
  return { storeId: intent.store.id, slug: intent.store.slug, status: intent.store.status }
}
