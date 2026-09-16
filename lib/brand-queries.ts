import "server-only"
import { prisma } from "@/lib/prisma"
import { toNumber } from "@/lib/format"
import type { PlanTier, StoreStatus, SubscriptionStatus } from "@/generated/prisma/client"

/// ชั้นอ่านของ "เจ้าของแบรนด์" (Phase 14c) — ที่ค้นข้ามร้านแห่งที่ 4 นอกเหนือจาก store-resolve / admin-queries / plan-queries
/// (ดูกติกาข้อ 5 ใน CLAUDE.md) · ขอบเขตของ tenant ที่นี่คือ **brand.ownerId = userId** — ทุกฟังก์ชันรับ userId
/// แล้วกรองด้วยเงื่อนไขนี้เสมอ ไม่รับ brandId จากผู้ใช้ตรง ๆ (1 คน = 1 แบรนด์) · อ่านอย่างเดียว
/// รายงานยอดขายรายสาขาไม่อยู่ที่นี่ — หน้า /brand/reports เรียก query เดิมใน lib/queries.ts ซ้ำต่อ storeId แล้วรวมในโค้ด

export type BrandStoreRow = {
  id: string
  slug: string
  name: string
  status: StoreStatus
  planTier: PlanTier | null
  tableLimit: number
  planExpiresAt: Date | null
  tableCount: number
  /// คำขอค่าใช้งานที่ค้างอยู่ของสาขานี้ (เดี่ยวหรือในใบรวม) — ขอในใบรวมใบใหม่ไม่ได้จนกว่าจะเคลียร์
  pendingRequestRef: string | null
  pendingInBatch: boolean
}

export type BrandBatchItem = {
  subscriptionId: string
  storeId: string
  storeName: string
  tier: PlanTier
  days: number
  amount: number
  periodEnd: Date
  status: SubscriptionStatus
}

export type BrandBatchRow = {
  id: string
  requestRef: string
  amount: number
  status: SubscriptionStatus
  paymentReference: string | null
  createdAt: Date
  paidAt: Date | null
  voidedAt: Date | null
  note: string | null
  items: BrandBatchItem[]
}

export type BrandOverview = {
  brand: { id: string; name: string; createdAt: Date } | null
  /// สาขาใต้แบรนด์ (เรียงตามวันที่สร้าง)
  stores: BrandStoreRow[]
  /// ร้านที่ผู้ใช้เป็น OWNER (StoreMember) และยังไม่อยู่ใต้แบรนด์ใด — ดึงเข้าแบรนด์ได้
  attachable: { id: string; name: string; slug: string }[]
  /// ใบจ่ายรวมที่รอผู้ดูแลยืนยัน (มีได้ครั้งละ 1 ใบ)
  pendingBatch: BrandBatchRow | null
  /// ประวัติใบจ่ายรวมทั้งหมด (ใหม่สุดก่อน)
  batches: BrandBatchRow[]
}

const BATCH_SELECT = {
  id: true,
  requestRef: true,
  amount: true,
  status: true,
  paymentReference: true,
  createdAt: true,
  paidAt: true,
  voidedAt: true,
  note: true,
  items: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      storeId: true,
      tier: true,
      days: true,
      amount: true,
      periodEnd: true,
      status: true,
      store: { select: { name: true } },
    },
  },
} as const

function toBatchRow(b: {
  id: string
  requestRef: string
  amount: { toString(): string }
  status: SubscriptionStatus
  paymentReference: string | null
  createdAt: Date
  paidAt: Date | null
  voidedAt: Date | null
  note: string | null
  items: {
    id: string
    storeId: string
    tier: PlanTier
    days: number
    amount: { toString(): string }
    periodEnd: Date
    status: SubscriptionStatus
    store: { name: string }
  }[]
}): BrandBatchRow {
  return {
    id: b.id,
    requestRef: b.requestRef,
    amount: toNumber(b.amount),
    status: b.status,
    paymentReference: b.paymentReference,
    createdAt: b.createdAt,
    paidAt: b.paidAt,
    voidedAt: b.voidedAt,
    note: b.note,
    items: b.items.map((i) => ({
      subscriptionId: i.id,
      storeId: i.storeId,
      storeName: i.store.name,
      tier: i.tier,
      days: i.days,
      amount: toNumber(i.amount),
      periodEnd: i.periodEnd,
      status: i.status,
    })),
  }
}

export async function getBrandOverview(userId: string): Promise<BrandOverview> {
  const [brand, attachableRows] = await Promise.all([
    prisma.brand.findFirst({
      where: { ownerId: userId },
      select: {
        id: true,
        name: true,
        createdAt: true,
        stores: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            slug: true,
            name: true,
            status: true,
            planTier: true,
            tableLimit: true,
            planExpiresAt: true,
            _count: { select: { tables: true } },
            subscriptions: {
              where: { status: "PENDING" },
              take: 1,
              orderBy: { createdAt: "desc" },
              select: { requestRef: true, batchId: true },
            },
          },
        },
        batches: { orderBy: { createdAt: "desc" }, select: BATCH_SELECT },
      },
    }),
    prisma.storeMember.findMany({
      where: { userId, role: "OWNER", store: { brandId: null } },
      orderBy: { createdAt: "asc" },
      select: { store: { select: { id: true, name: true, slug: true } } },
    }),
  ])

  const batches = brand ? brand.batches.map(toBatchRow) : []
  return {
    brand: brand ? { id: brand.id, name: brand.name, createdAt: brand.createdAt } : null,
    stores: brand
      ? brand.stores.map((s) => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
          status: s.status,
          planTier: s.planTier,
          tableLimit: s.tableLimit,
          planExpiresAt: s.planExpiresAt,
          tableCount: s._count.tables,
          pendingRequestRef: s.subscriptions[0]?.requestRef ?? null,
          pendingInBatch: Boolean(s.subscriptions[0]?.batchId),
        }))
      : [],
    attachable: attachableRows.map((r) => r.store),
    pendingBatch: batches.find((b) => b.status === "PENDING") ?? null,
    batches,
  }
}

/// สาขาใต้แบรนด์ของผู้ใช้ — ไว้ให้ /brand/reports วน query เดิมของ lib/queries.ts ต่อ storeId
export async function listBrandStores(userId: string): Promise<{ id: string; name: string; slug: string; status: StoreStatus }[]> {
  const brand = await prisma.brand.findFirst({
    where: { ownerId: userId },
    select: { stores: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, slug: true, status: true } } },
  })
  return brand?.stores ?? []
}
