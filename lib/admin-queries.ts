import "server-only"
import { prisma } from "@/lib/prisma"
import { toNumber } from "@/lib/format"

/// ชั้นอ่านข้อมูลของ "ผู้ดูแลแพลตฟอร์ม" (Phase 14a) — ค้นข้ามทุกร้านโดยตั้งใจ
///
/// แยกจาก lib/queries.ts เพราะไฟล์นั้นบังคับให้ทุก query ผ่าน forStore(storeId) (ESLint + เทส isolation)
/// ส่วนที่นี่ต้องเห็นทุกร้าน · ผู้เรียกทุกตัวต้องผ่าน requirePlatformAdmin() ก่อนเสมอ
/// **อ่านอย่างเดียว** — ผู้ดูแลแพลตฟอร์มไม่แก้ข้อมูลในร้าน (แก้ได้แค่สถานะร้านผ่าน app/actions/admin.ts)

export type AdminStoreRow = {
  id: string
  slug: string
  name: string
  status: "ACTIVE" | "SUSPENDED"
  createdAt: Date
  memberCount: number
  ownerEmails: string[]
  tableCount: number
  saleCount: number
  /// ยอดขายรวมของบิลที่ไม่ถูก void — คำนวณจากทุกช่องทาง
  totalSales: number
  lastSaleAt: Date | null
}

export async function listStoresForAdmin(): Promise<AdminStoreRow[]> {
  const stores = await prisma.store.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      createdAt: true,
      _count: { select: { members: true, tables: true } },
      members: { where: { role: "OWNER" }, select: { user: { select: { email: true } } } },
    },
  })

  // ยอดขาย/จำนวนบิลรวมต่อร้านใน query เดียว — ไม่วน N+1
  const sales = await prisma.sale.groupBy({
    by: ["storeId"],
    where: { status: "COMPLETED" },
    _count: { _all: true },
    _sum: { total: true },
    _max: { createdAt: true },
  })
  const salesByStore = new Map(sales.map((s) => [s.storeId, s]))

  return stores.map((store) => {
    const agg = salesByStore.get(store.id)
    return {
      id: store.id,
      slug: store.slug,
      name: store.name,
      status: store.status,
      createdAt: store.createdAt,
      memberCount: store._count.members,
      ownerEmails: store.members.map((m) => m.user.email),
      tableCount: store._count.tables,
      saleCount: agg?._count._all ?? 0,
      totalSales: agg?._sum.total ? toNumber(agg._sum.total) : 0,
      lastSaleAt: agg?._max.createdAt ?? null,
    }
  })
}
