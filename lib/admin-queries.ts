import "server-only"
import { prisma } from "@/lib/prisma"
import { toNumber } from "@/lib/format"
import type { PaymentMode } from "@/generated/prisma/client"

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

// ───────────────────── ค่าใช้งานแบบต่ออายุ (Phase 14b) ─────────────────────

export type AdminStorePlanRow = AdminStoreRow & {
  planTier: "S" | "M" | "L" | "XL" | null
  tableLimit: number
  planExpiresAt: Date | null
  pendingCount: number
}

export type AdminStoreFilter = "all" | "expiring" | "expired" | "full" | "pending" | "suspended"

/// รายชื่อร้านพร้อมข้อมูลแพ็กเกจ + ตัวกรอง "ใกล้หมด ≤ 7 วัน / หมดแล้ว / โต๊ะเต็มเพดาน / รอยืนยัน / ถูกระงับ"
export async function listStoresWithPlanForAdmin(filter: AdminStoreFilter = "all"): Promise<AdminStorePlanRow[]> {
  const [base, plans, pendings] = await Promise.all([
    listStoresForAdmin(),
    prisma.store.findMany({ select: { id: true, planTier: true, tableLimit: true, planExpiresAt: true } }),
    prisma.storeSubscription.groupBy({ by: ["storeId"], where: { status: "PENDING" }, _count: { _all: true } }),
  ])
  const planById = new Map(plans.map((p) => [p.id, p]))
  const pendingById = new Map(pendings.map((p) => [p.storeId, p._count._all]))
  const now = Date.now()
  const sevenDays = now + 7 * 24 * 60 * 60 * 1000

  const rows: AdminStorePlanRow[] = base.map((row) => {
    const plan = planById.get(row.id)
    return {
      ...row,
      planTier: plan?.planTier ?? null,
      tableLimit: plan?.tableLimit ?? 0,
      planExpiresAt: plan?.planExpiresAt ?? null,
      pendingCount: pendingById.get(row.id) ?? 0,
    }
  })

  switch (filter) {
    case "expiring":
      return rows.filter((r) => r.planExpiresAt && r.planExpiresAt.getTime() > now && r.planExpiresAt.getTime() <= sevenDays)
    case "expired":
      return rows.filter((r) => !r.planExpiresAt || r.planExpiresAt.getTime() <= now)
    case "full":
      return rows.filter((r) => r.tableCount >= r.tableLimit)
    case "pending":
      return rows.filter((r) => r.pendingCount > 0)
    case "suspended":
      return rows.filter((r) => r.status === "SUSPENDED")
    default:
      return rows
  }
}

export type AdminStoreDetail = {
  id: string
  slug: string
  name: string
  status: "ACTIVE" | "SUSPENDED"
  createdAt: Date
  planTier: "S" | "M" | "L" | "XL" | null
  tableLimit: number
  planExpiresAt: Date | null
  tableCount: number
  memberCount: number
  ownerEmails: string[]
  promptPayIdSet: boolean
  trialClaimed: boolean
  /// วิธีรับเงิน (Phase 15a) — SCB_BILLER ตั้งได้เฉพาะผู้ดูแล
  paymentMode: PaymentMode
}

export async function getStoreForAdmin(storeId: string): Promise<AdminStoreDetail | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      createdAt: true,
      planTier: true,
      tableLimit: true,
      planExpiresAt: true,
      paymentMode: true,
      paymentConfig: { select: { promptPayId: true } },
      _count: { select: { tables: true, members: true } },
      members: { where: { role: "OWNER" }, select: { user: { select: { email: true } } } },
    },
  })
  if (!store) return null
  const trialClaimed = (await prisma.storeSubscription.count({ where: { storeId, kind: "TRIAL" } })) > 0
  return {
    id: store.id,
    slug: store.slug,
    name: store.name,
    status: store.status,
    createdAt: store.createdAt,
    planTier: store.planTier,
    tableLimit: store.tableLimit,
    planExpiresAt: store.planExpiresAt,
    tableCount: store._count.tables,
    memberCount: store._count.members,
    ownerEmails: store.members.map((m) => m.user.email),
    promptPayIdSet: Boolean(store.paymentConfig?.promptPayId),
    trialClaimed,
    paymentMode: store.paymentMode,
  }
}

export type AdminLedgerRow = {
  id: string
  kind: "RENEWAL" | "UPGRADE" | "TRIAL" | "CUSTOM"
  status: "PENDING" | "PAID" | "VOID"
  tier: "S" | "M" | "L" | "XL"
  tableLimit: number
  days: number
  amount: number
  requestRef: string
  paymentReference: string | null
  periodStart: Date
  periodEnd: Date
  paidAt: Date | null
  voidedAt: Date | null
  note: string | null
  createdAt: Date
  reversed: boolean
  planCode: string | null
}

/// ledger ค่าใช้งานของร้านสำหรับหน้า /admin/stores/[id] — ทุกแถวรวม VOID/ชดเชย
export async function listStoreLedgerForAdmin(storeId: string): Promise<AdminLedgerRow[]> {
  const rows = await prisma.storeSubscription.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    include: { reversal: { select: { id: true } }, plan: { select: { code: true, version: true } } },
  })
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    tier: r.tier,
    tableLimit: r.tableLimit,
    days: r.days,
    amount: toNumber(r.amount),
    requestRef: r.requestRef,
    paymentReference: r.paymentReference,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    paidAt: r.paidAt,
    voidedAt: r.voidedAt,
    note: r.note,
    createdAt: r.createdAt,
    reversed: r.reversal !== null,
    planCode: r.plan ? `${r.plan.code} v${r.plan.version}` : null,
  }))
}

/// คำขอที่รอยืนยันทุกร้าน — กล่องงานของผู้ดูแล
export async function listPendingSubscriptionsForAdmin() {
  const rows = await prisma.storeSubscription.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: { store: { select: { id: true, name: true, slug: true } } },
  })
  return rows.map((r) => ({
    id: r.id,
    storeId: r.store.id,
    storeName: r.store.name,
    storeSlug: r.store.slug,
    kind: r.kind,
    tier: r.tier,
    days: r.days,
    amount: toNumber(r.amount),
    requestRef: r.requestRef,
    createdAt: r.createdAt,
  }))
}

export type PlanVersionRow = {
  id: string
  code: string
  version: number
  name: string
  tier: "S" | "M" | "L" | "XL"
  tableLimit: number
  durationDays: number
  ratePerDay: number
  discountPercent: number
  price: number
  isActive: boolean
  sortOrder: number
  createdAt: Date
  /// จำนวนรายการที่ร้านซื้อด้วย version นี้ — บอกว่าแถวถูกอ้างอยู่ (ห้ามลบ)
  usedCount: number
}

/// ทุก version ของทุกแพ็กเกจ (active + superseded) — หน้า /admin/plans
export async function listPlanVersionsForAdmin(): Promise<PlanVersionRow[]> {
  const rows = await prisma.subscriptionPlan.findMany({
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { version: "desc" }],
    include: { _count: { select: { subscriptions: true } } },
  })
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    version: p.version,
    name: p.name,
    tier: p.tier,
    tableLimit: p.tableLimit,
    durationDays: p.durationDays,
    ratePerDay: toNumber(p.ratePerDay),
    discountPercent: toNumber(p.discountPercent),
    price: toNumber(p.price),
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt,
    usedCount: p._count.subscriptions,
  }))
}

// ───────────────────── ใบจ่ายรวมของแบรนด์ (Phase 14c) ─────────────────────

export type AdminBatchItem = {
  subscriptionId: string
  storeId: string
  storeName: string
  storeSlug: string
  tier: "S" | "M" | "L" | "XL"
  tableLimit: number
  tableCount: number
  days: number
  amount: number
  requestRef: string
  status: "PENDING" | "PAID" | "VOID"
  periodStart: Date
  periodEnd: Date
}

export type AdminBatchDetail = {
  id: string
  requestRef: string
  amount: number
  status: "PENDING" | "PAID" | "VOID"
  paymentReference: string | null
  createdAt: Date
  paidAt: Date | null
  voidedAt: Date | null
  note: string | null
  brand: { id: string; name: string; ownerName: string; ownerEmail: string }
  items: AdminBatchItem[]
}

/// ใบจ่ายรวมที่รอยืนยันทุกแบรนด์ — โผล่ในกล่องงานของผู้ดูแลคู่กับคำขอเดี่ยว
export async function listPendingBatchesForAdmin() {
  const rows = await prisma.subscriptionBatch.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      requestRef: true,
      amount: true,
      createdAt: true,
      brand: { select: { name: true } },
      _count: { select: { items: true } },
    },
  })
  return rows.map((b) => ({
    id: b.id,
    requestRef: b.requestRef,
    amount: toNumber(b.amount),
    createdAt: b.createdAt,
    brandName: b.brand.name,
    storeCount: b._count.items,
  }))
}

export async function getBatchForAdmin(batchId: string): Promise<AdminBatchDetail | null> {
  const b = await prisma.subscriptionBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      requestRef: true,
      amount: true,
      status: true,
      paymentReference: true,
      createdAt: true,
      paidAt: true,
      voidedAt: true,
      note: true,
      brand: { select: { id: true, name: true, owner: { select: { name: true, email: true } } } },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          storeId: true,
          tier: true,
          tableLimit: true,
          days: true,
          amount: true,
          requestRef: true,
          status: true,
          periodStart: true,
          periodEnd: true,
          store: { select: { name: true, slug: true, _count: { select: { tables: true } } } },
        },
      },
    },
  })
  if (!b) return null
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
    brand: { id: b.brand.id, name: b.brand.name, ownerName: b.brand.owner.name, ownerEmail: b.brand.owner.email },
    items: b.items.map((i) => ({
      subscriptionId: i.id,
      storeId: i.storeId,
      storeName: i.store.name,
      storeSlug: i.store.slug,
      tier: i.tier,
      tableLimit: i.tableLimit,
      tableCount: i.store._count.tables,
      days: i.days,
      amount: toNumber(i.amount),
      requestRef: i.requestRef,
      status: i.status,
      periodStart: i.periodStart,
      periodEnd: i.periodEnd,
    })),
  }
}
