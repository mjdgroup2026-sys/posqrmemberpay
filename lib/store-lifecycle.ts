import "server-only"
import { forStore, type StoreTx } from "@/lib/db"

/// ปิดร้าน / เปิดร้านอีกครั้ง / ลบร้านถาวร (2026-09-30) — **ที่เดียวที่เปลี่ยน status เป็น CLOSED และที่เดียวที่ลบแถว store**
///
/// ตัดสินใจกับเจ้าของระบบ 2026-09-30:
///   - ร้านที่ "เคยใช้งาน" ลบไม่ได้ — ปิดได้อย่างเดียว (ข้อมูลอยู่ครบ เปิดกลับได้)
///   - ร้านที่เคยรับแค่สิทธิ์ทดลองลบได้ — แถว StoreSubscription(TRIAL) หายไปกับร้าน (ข้อยกเว้นของกติกาข้อ 9)
///     แต่ TrialClaim ไม่มี FK และไม่ถูกลบ จึงเอาเลขพร้อมเพย์เดิมไปรับสิทธิ์ทดลองซ้ำไม่ได้
///   - ร้านที่ปิดแล้ว เจ้าของดูข้อมูลไม่ได้จนกว่าจะเปิดร้านอีกครั้ง

/// สิ่งที่ทำให้ร้าน "เคยใช้งาน" — มีอย่างใดอย่างหนึ่ง = ลบไม่ได้
export type StoreUsage = {
  sales: number
  orders: number
  stockMoves: number
  stockDocuments: number
  bookings: number
  members: number
  /// ค่าใช้งานที่จ่ายจริงหรือยื่นจ่ายแล้วรอยืนยัน (RENEWAL/UPGRADE ที่ไม่ใช่ VOID) — ทดลอง/ผู้ดูแลเติมวันไม่นับ
  payments: number
}

export const USAGE_LABEL: Record<keyof StoreUsage, string> = {
  sales: "บิลขาย",
  orders: "ออร์เดอร์",
  stockMoves: "ความเคลื่อนไหวสต็อก",
  stockDocuments: "เอกสารคลัง",
  bookings: "การจองคิว",
  members: "สมาชิกสะสมแต้ม",
  payments: "การชำระค่าใช้งาน",
}

export function isStoreUsed(usage: StoreUsage): boolean {
  return Object.values(usage).some((count) => count > 0)
}

/// "บิลขาย 3 · ออร์เดอร์ 5" — เฉพาะหัวข้อที่มี
export function describeUsage(usage: StoreUsage): string {
  return (Object.keys(usage) as (keyof StoreUsage)[])
    .filter((key) => usage[key] > 0)
    .map((key) => `${USAGE_LABEL[key]} ${usage[key].toLocaleString("th-TH")}`)
    .join(" · ")
}

async function usageIn(tx: StoreTx): Promise<StoreUsage> {
  const [sales, orders, stockMoves, stockDocuments, bookings, members, payments] = await Promise.all([
    tx.sale.count(),
    tx.mobileOrder.count(),
    tx.stockTransaction.count(),
    tx.stockDocument.count(),
    tx.booking.count(),
    tx.member.count(),
    tx.storeSubscription.count({ where: { kind: { in: ["RENEWAL", "UPGRADE"] }, status: { not: "VOID" } } }),
  ])
  return { sales, orders, stockMoves, stockDocuments, bookings, members, payments }
}

export async function getStoreUsage(storeId: string): Promise<StoreUsage> {
  return forStore(storeId).$transaction((tx) => usageIn(tx))
}

export class StoreLifecycleError extends Error {
  constructor(readonly reason: string) {
    super("STORE_LIFECYCLE")
  }
}

/// ปิดร้าน — ได้เฉพาะร้านที่ ACTIVE (ร้านที่ผู้ดูแลระงับไว้ เจ้าของปิด/เปิดเองไม่ได้)
/// ต้องไม่มีโต๊ะ/ห้องที่ยังเปิดบิลอยู่ — ปิดร้านแล้วพนักงานเข้าไปปิดบิลไม่ได้ ลูกค้าที่นั่งอยู่จะจ่ายไม่ได้
export async function closeStoreRow(storeId: string, userId: string, reason: string): Promise<void> {
  const db = forStore(storeId)
  const openBills = await db.tableSession.count({ where: { status: { in: ["OPEN", "AWAITING_BILL"] } } })
  if (openBills > 0) {
    throw new StoreLifecycleError(`ยังมีโต๊ะ/ห้องที่เปิดบิลอยู่ ${openBills} บิล — ปิดบิลหรือยกเลิกให้ครบก่อนปิดร้าน`)
  }
  const updated = await db.store.updateMany({
    where: { id: storeId, status: "ACTIVE" },
    data: { status: "CLOSED", closedAt: new Date(), closedById: userId, closeReason: reason },
  })
  if (updated.count === 1) return
  const store = await db.store.findUnique({ where: { id: storeId }, select: { status: true } })
  if (!store) throw new StoreLifecycleError("ไม่พบร้านนี้")
  if (store.status === "CLOSED") throw new StoreLifecycleError("ร้านนี้ปิดไปแล้ว")
  throw new StoreLifecycleError("ร้านนี้ถูกผู้ดูแลระบบระงับอยู่ — ปิดร้านเองไม่ได้ กรุณาติดต่อผู้ดูแลระบบ")
}

/// เปิดร้านอีกครั้ง — ได้เฉพาะร้านที่ CLOSED
export async function reopenStoreRow(storeId: string): Promise<void> {
  const db = forStore(storeId)
  const updated = await db.store.updateMany({
    where: { id: storeId, status: "CLOSED" },
    data: { status: "ACTIVE", closedAt: null, closedById: null, closeReason: null },
  })
  if (updated.count !== 1) throw new StoreLifecycleError("ร้านนี้ไม่ได้อยู่ในสถานะปิด")
}

/// ลบร้านถาวร — เฉพาะร้านที่ไม่เคยใช้งาน (ACTIVE หรือ CLOSED · ร้านที่ถูกระงับลบไม่ได้)
///
/// ล็อกแถว store ด้วย FOR UPDATE ก่อนนับการใช้งาน: บิล/ออร์เดอร์ที่กำลัง insert ถือ KEY SHARE lock บนแถวนี้ (FK)
/// จึงต้องรอกันเสมอ — commit ก่อนเรา = เรานับเจอแล้วปฏิเสธ · มาหลังเรา = insert ล้มเพราะร้านหายไปแล้ว ไม่มีข้อมูลค้างครึ่ง ๆ
///
/// ลำดับการลบ: ลบเฉพาะข้อมูลตั้งค่า/ตัวอย่างที่ FK เป็น RESTRICT ไปหา store เอง (ลูกก่อนแม่) แล้วลบแถว store ซึ่ง cascade ที่เหลือ
/// (settings · สมาชิก/บทบาท · คำเชิญ · แพ็กเกจทดลอง · รูป · พนักงานนวด/กะ · ประเภทครัว · บัญชีรับเงิน)
/// ตั้งใจ **ไม่** สั่งลบบิล/ออร์เดอร์/สต็อก/การจอง/สมาชิก — ถ้าการนับข้างบนพลาด FK RESTRICT ของตารางพวกนั้นจะล้มทั้งทรานแซคชันเอง
export async function deleteUnusedStore(storeId: string): Promise<void> {
  await forStore(storeId).$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string }[]>`
      SELECT "status"::text AS "status" FROM "store" WHERE "id" = ${storeId} FOR UPDATE`
    const status = locked[0]?.status
    if (!status) throw new StoreLifecycleError("ไม่พบร้านนี้")
    if (status === "SUSPENDED") throw new StoreLifecycleError("ร้านนี้ถูกผู้ดูแลระบบระงับอยู่ — ลบไม่ได้ กรุณาติดต่อผู้ดูแลระบบ")

    const usage = await usageIn(tx)
    if (isStoreUsed(usage)) {
      throw new StoreLifecycleError(`ร้านนี้มีข้อมูลการใช้งานแล้ว (${describeUsage(usage)}) — ลบไม่ได้ ใช้ "ปิดร้าน" แทน`)
    }

    await tx.notification.deleteMany({})
    await tx.paymentIntent.deleteMany({})
    // รอบปิดยอดที่ไม่มีบิล (ปิดรอบ 1 ได้แม้ไม่มีบิล) — มีบิลเมื่อไหร่ก็นับเป็นการใช้งานไปแล้ว
    await tx.cashierClosing.deleteMany({})
    await tx.tableSession.deleteMany({})
    await tx.qRCode.deleteMany({})
    // โต๊ะที่รวมกันอ้างถึงกันเอง — ปลดก่อนลบ
    await tx.table.updateMany({ data: { primaryTableId: null } })
    await tx.table.deleteMany({})
    await tx.menuItem.deleteMany({})
    await tx.modifierGroup.deleteMany({})
    await tx.product.deleteMany({})
    await tx.category.deleteMany({})
    await tx.store.delete({ where: { id: storeId } })
  })
}
