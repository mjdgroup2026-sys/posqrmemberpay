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

