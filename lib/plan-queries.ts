import "server-only"
import { prisma } from "@/lib/prisma"
import { toNumber } from "@/lib/format"

/// แพ็กเกจค่าใช้งาน (Phase 14b) — ข้อมูลอ้างอิงของแพลตฟอร์ม ไม่มี storeId จึงไม่อยู่ใน lib/queries.ts
/// (ไฟล์นั้นบังคับให้ทุก query ผ่าน forStore) · อ่านได้ทั้งหน้า /billing ของร้านและ /admin/plans

export type PlanOption = {
  id: string
  code: string
  name: string
  tier: "S" | "M" | "L" | "XL"
  tableLimit: number
  durationDays: number
  ratePerDay: number
  discountPercent: number
  price: number
  sortOrder: number
}

/// แพ็กเกจที่ขายอยู่ (version ล่าสุดที่ isActive) — ข้อมูลอ้างอิงของแพลตฟอร์ม ไม่มี storeId (SubscriptionPlan ไม่ scoped)
/// ตัด TRIAL ออกเพราะรับผ่าน claimTrial() ไม่ใช่ซื้อ
export async function listActivePlans(): Promise<PlanOption[]> {
  const rows = await prisma.subscriptionPlan.findMany({
    where: { isActive: true, code: { not: "TRIAL" } },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  })
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    tier: p.tier,
    tableLimit: p.tableLimit,
    durationDays: p.durationDays,
    ratePerDay: toNumber(p.ratePerDay),
    discountPercent: toNumber(p.discountPercent),
    price: toNumber(p.price),
    sortOrder: p.sortOrder,
  }))
}


/// ร้านในรายการนี้ร้านไหน "เคยรับสิทธิ์ทดลองฟรี 7 วัน" ไปแล้วบ้าง (2026-09-17)
///
/// สิทธิ์ทดลองผูกกับเลขพร้อมเพย์และใช้ได้ครั้งเดียวทั้งแพลตฟอร์ม (`TrialClaim` ตั้งใจไม่ scoped) —
/// เจ้าของที่รับทดลองไปแล้วที่ร้านแรก พอสร้างสาขาที่ 2 จะรับซ้ำด้วยเลขเดิมไม่ได้ ต้องบอกตั้งแต่ตอนสร้าง
/// ไม่ใช่ปล่อยให้สร้างเสร็จแล้วค่อยเจอตอนกดรับทดลอง · รับ storeIds ที่ผู้เรียกยืนยันแล้วว่าเป็นของผู้ใช้
/// (ไม่มีข้อมูลอื่นหลุด — คืนแค่ storeId ที่มีแถวอยู่)
export async function listStoresWithTrialClaim(storeIds: string[]): Promise<string[]> {
  if (storeIds.length === 0) return []
  const rows = await prisma.trialClaim.findMany({
    where: { storeId: { in: storeIds } },
    select: { storeId: true },
  })
  return rows.map((r) => r.storeId)
}

/// ร้านในรายการนี้ร้านไหน "ยังอยู่ในช่วงทดลอง" — มีสิทธิ์ทดลอง 7 วันแล้วแต่ยังไม่เคยจ่ายแพ็กเกจจริง (2026-09-17)
///
/// กติกาจากเจ้าของระบบ: **ห้ามสร้างร้าน/สาขาเพิ่มระหว่างทดลองใช้งาน** — ต้องเลือกแพ็กเกจและชำระเงินให้ร้านแรกก่อน
/// (กันคนวนเปิดร้านใหม่ใช้ฟรีไปเรื่อย ๆ และกันเจ้าของสร้างสาขาแล้วเปิดใช้งานไม่ได้เพราะรับทดลองซ้ำไม่ได้)
/// "จ่ายจริง" = มีแถว PAID ที่ไม่ใช่ TRIAL (RENEWAL/UPGRADE หรือ CUSTOM ที่ผู้ดูแลเติมให้ — รวมร้านเดิมที่ backfill)
export async function listTrialOnlyStores(storeIds: string[]): Promise<string[]> {
  if (storeIds.length === 0) return []
  const rows = await prisma.storeSubscription.findMany({
    where: { storeId: { in: storeIds }, status: "PAID" },
    select: { storeId: true, kind: true },
  })
  const trial = new Set<string>()
  const paid = new Set<string>()
  for (const row of rows) {
    if (row.kind === "TRIAL") trial.add(row.storeId)
    else paid.add(row.storeId)
  }
  return [...trial].filter((id) => !paid.has(id))
}
