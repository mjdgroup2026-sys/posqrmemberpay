import "server-only"
import { forStore } from "@/lib/db"
import { findStoreByQrToken } from "@/lib/store-resolve"
import { toNumber } from "@/lib/format"
import { businessDayRange, businessDateOnly } from "@/lib/day"
import { computeBillTotals, SYSTEM_USER_ID } from "@/lib/close-session"
import type { PaymentMethodValue } from "@/lib/types"
import type { PermissionAction as PermissionActionValue, Prisma, ResourceKey } from "@/generated/prisma/client"

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export type ProductListItem = {
  id: string
  sku: string
  name: string
  categoryId: string
  category: string
  unit: string
  quantity: number
  reorderPoint: number
  price: number
  isLow: boolean
}

export async function listProducts(storeId: string, params: { search?: string; category?: string } = {}) {
  const db = forStore(storeId)
  const search = params.search?.trim()
  const category = params.category?.trim()

  const rows = await db.product.findMany({
    where: {
      ...(category && category !== "all" ? { categoryId: category } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { sku: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { category: { select: { name: true } } },
  })

  return rows.map<ProductListItem>((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    categoryId: p.categoryId,
    category: p.category.name,
    unit: p.unit,
    quantity: p.quantity,
    reorderPoint: p.reorderPoint,
    price: toNumber(p.price),
    isLow: p.quantity <= p.reorderPoint,
  }))
}

export type ProductOption = {
  id: string
  sku: string
  name: string
  unit: string
  quantity: number
  price: number
  categoryId: string
  category: string
}

export async function listProductOptions(storeId: string): Promise<ProductOption[]> {
  const db = forStore(storeId)
  const rows = await db.product.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      sku: true,
      name: true,
      unit: true,
      quantity: true,
      price: true,
      categoryId: true,
      category: { select: { name: true } },
    },
  })
  return rows.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    unit: p.unit,
    quantity: p.quantity,
    price: toNumber(p.price),
    categoryId: p.categoryId,
    category: p.category.name,
  }))
}

/// หมวดหมู่ทั้งหมด (master data) — ใช้เป็นตัวเลือกใน dropdown ทุกหน้า
export async function listCategoryOptions(storeId: string) {
  const db = forStore(storeId)
  return db.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })
}

/// หมวดหมู่พร้อมจำนวนสินค้าที่ผูกอยู่ — หน้า /categories ใช้ตัดสินใจว่าลบได้ไหม
export async function listCategoriesWithCount(storeId: string) {
  const db = forStore(storeId)
  const rows = await db.category.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { products: true } },
    },
  })
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    productCount: c._count.products,
  }))
}

export async function getLowStockCount(storeId: string) {
  const db = forStore(storeId)
  const rows = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "product"
    WHERE "storeId" = ${storeId} AND "quantity" <= "reorderPoint"
  `
  return Number(rows[0]?.count ?? 0)
}

export async function getLowStockProducts(storeId: string, limit = 50) {
  const db = forStore(storeId)
  const rows = await db.$queryRaw<
    { id: string; sku: string; name: string; unit: string; quantity: number; reorderPoint: number }[]
  >`
    SELECT "id", "sku", "name", "unit", "quantity", "reorderPoint"
    FROM "product"
    WHERE "storeId" = ${storeId} AND "quantity" <= "reorderPoint"
    ORDER BY ("quantity" - "reorderPoint") ASC, "name" ASC
    LIMIT ${limit}
  `
  return rows
}

export async function getDashboardStats(storeId: string) {
  const db = forStore(storeId)
  const { start, end } = businessDayRange()

  const [productCount, agg, lowStockCount, todaySales] = await Promise.all([
    db.product.count(),
    db.$queryRaw<{ total: string | null }[]>`
      SELECT COALESCE(SUM("quantity" * "price"), 0)::text AS total FROM "product" WHERE "storeId" = ${storeId}
    `,
    getLowStockCount(storeId),
    db.sale.aggregate({
      where: { status: "COMPLETED", createdAt: { gte: start, lt: end } },
      _sum: { total: true },
      _count: { _all: true },
    }),
  ])

  return {
    productCount,
    stockValue: toNumber(agg[0]?.total ?? 0),
    lowStockCount,
    todaySalesTotal: toNumber(todaySales._sum.total ?? 0),
    todayBillCount: todaySales._count._all,
  }
}

export async function getRecentTransactions(storeId: string, limit = 8) {
  const db = forStore(storeId)
  const rows = await db.stockTransaction.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { product: { select: { name: true, sku: true, unit: true } } },
  })
  return rows.map((t) => ({
    id: t.id,
    type: t.type,
    quantity: t.quantity,
    note: t.note,
    createdAt: t.createdAt,
    productName: t.product.name,
    productSku: t.product.sku,
    unit: t.product.unit,
  }))
}

export async function listTransactions(storeId: string, limit = 100) {
  const db = forStore(storeId)
  const rows = await db.stockTransaction.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { product: { select: { name: true, sku: true, unit: true } } },
  })
  return rows.map((t) => ({
    id: t.id,
    type: t.type,
    quantity: t.quantity,
    note: t.note,
    createdAt: t.createdAt,
    productName: t.product.name,
    productSku: t.product.sku,
    unit: t.product.unit,
  }))
}

/// สรุปการเคลื่อนไหว 30 วันย้อนหลัง สำหรับหน้า /reports
export async function getMovementReport(storeId: string) {
  const db = forStore(storeId)
  const rows = await db.$queryRaw<{ day: Date; type: string; total: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS day, "type", SUM("quantity")::bigint AS total
    FROM "stock_transaction"
    WHERE "storeId" = ${storeId} AND "createdAt" >= now() - interval '30 days'
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `

  const byDay = new Map<string, { day: string; stockIn: number; stockOut: number }>()
  for (const r of rows) {
    const key = new Date(r.day).toISOString().slice(0, 10)
    const entry = byDay.get(key) ?? { day: key, stockIn: 0, stockOut: 0 }
    if (r.type === "IN") entry.stockIn = Number(r.total)
    else entry.stockOut = Number(r.total)
    byDay.set(key, entry)
  }

  return Array.from(byDay.values())
}

export async function getTopMovedProducts(storeId: string, limit = 5) {
  const db = forStore(storeId)
  const rows = await db.$queryRaw<{ name: string; sku: string; total: bigint }[]>`
    SELECT p."name", p."sku", SUM(t."quantity")::bigint AS total
    FROM "stock_transaction" t
    JOIN "product" p ON p."id" = t."productId"
    WHERE t."storeId" = ${storeId} AND t."type" = 'OUT' AND t."createdAt" >= now() - interval '30 days'
    GROUP BY p."name", p."sku"
    ORDER BY total DESC
    LIMIT ${limit}
  `
  return rows.map((r) => ({ name: r.name, sku: r.sku, total: Number(r.total) }))
}

/// พนักงานในร้าน (Phase 13) — อ่านจาก StoreMember ของร้านที่ทำงานอยู่ ไม่ใช่ตาราง user ทั้งระบบ
export async function listUsers(storeId: string) {
  const db = forStore(storeId)
  const rows = await db.storeMember.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      roleId: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, emailVerified: true, createdAt: true } },
      permissionRole: { select: { name: true, isSystem: true } },
    },
  })
  return rows.map((m) => ({
    id: m.user.id,
    membershipId: m.id,
    name: m.user.name,
    email: m.user.email,
    emailVerified: m.user.emailVerified,
    createdAt: m.user.createdAt,
    joinedAt: m.createdAt,
    storeRole: m.role,
    roleId: m.roleId,
    role: m.permissionRole,
  }))
}

// ───────────────────────────── POS (Phase 2.5) ─────────────────────────────

export type SaleListItem = {
  id: string
  saleNumber: string
  status: "COMPLETED" | "VOIDED"
  subtotal: number
  discount: number
  total: number
  paymentMethod: PaymentMethodValue
  amountReceived: number
  changeDue: number
  note: string | null
  createdAt: Date
  cashierName: string
  /// ช่องทางที่ออกบิล — บิลจาก MJD Mobile Order ปนอยู่ในตารางเดียวกับบิลหน้าร้าน (กติกาข้อ 8)
  channel: "RETAIL_POS" | "MOBILE_ORDER"
  /// รหัสโต๊ะของบิล Mobile Order — บิลหน้าร้านเป็น null
  tableCode: string | null
  voidedAt: Date | null
  voidReason: string | null
  voidedByName: string | null
  canVoid: boolean
  items: {
    id: string
    name: string
    sku: string
    unit: string
    quantity: number
    unitPrice: number
    subtotal: number
  }[]
}

/// บิลขายพร้อมรายการสินค้า — หน้า /pos/history ใช้ทั้งตารางและ dialog รายละเอียด
export async function listSales(storeId: string, params: { from?: string; to?: string; status?: string; search?: string; limit?: number } = {},): Promise<SaleListItem[]> {
  const db = forStore(storeId)
  const status = params.status === "COMPLETED" || params.status === "VOIDED" ? params.status : undefined
  const from = params.from ? new Date(`${params.from}T00:00:00.000+07:00`) : undefined
  // to เป็นวันที่แบบ inclusive — บวกอีกวันแล้วใช้ lt เพื่อกินทั้งวันสุดท้าย
  const to = params.to ? new Date(new Date(`${params.to}T00:00:00.000+07:00`).getTime() + 86_400_000) : undefined
  const search = params.search?.trim()

  const rows = await db.sale.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      ...(search ? { saleNumber: { contains: search, mode: "insensitive" as const } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 200,
    include: {
      cashier: { select: { name: true } },
      voidedBy: { select: { name: true } },
      session: { select: { table: { select: { code: true } } } },
      items: { include: { product: { select: { sku: true, unit: true } } } },
    },
  })

  const { start, end } = businessDayRange()
  // ปิดยอดของแคชเชียร์คนไหนไปแล้วบ้างในวันนี้ — บิลของคนนั้นกด void ไม่ได้อีก (F9)
  const closings = await db.cashierClosing.findMany({
    where: { closingDate: businessDateOnly() },
    select: { cashierId: true },
  })
  const closedCashiers = new Set(closings.map((c) => c.cashierId))

  return rows.map((sale) => ({
    id: sale.id,
    saleNumber: sale.saleNumber,
    status: sale.status,
    subtotal: toNumber(sale.subtotal),
    discount: toNumber(sale.discount),
    total: toNumber(sale.total),
    paymentMethod: sale.paymentMethod,
    amountReceived: toNumber(sale.amountReceived),
    changeDue: toNumber(sale.changeDue),
    note: sale.note,
    createdAt: sale.createdAt,
    cashierName: sale.cashier.name,
    channel: sale.channel,
    tableCode: sale.session?.table.code ?? null,
    voidedAt: sale.voidedAt,
    voidReason: sale.voidReason,
    voidedByName: sale.voidedBy?.name ?? null,
    canVoid:
      sale.status === "COMPLETED" &&
      sale.createdAt >= start &&
      sale.createdAt < end &&
      !closedCashiers.has(sale.cashierId),
    items: sale.items.map((item) => ({
      id: item.id,
      // ชื่อเป็น snapshot ในแถวเอง — บิลจาก Mobile Order ไม่มี product ให้ join (Phase 10)
      name: item.name,
      sku: item.product?.sku ?? "",
      unit: item.product?.unit ?? "",
      quantity: item.quantity,
      unitPrice: toNumber(item.unitPrice),
      subtotal: toNumber(item.subtotal),
    })),
  }))
}

export async function getSaleById(storeId: string, id: string): Promise<SaleListItem | null> {
  const db = forStore(storeId)
  const sale = await db.sale.findUnique({ where: { id }, select: { saleNumber: true } })
  if (!sale) return null
  const rows = await listSales(storeId, { search: sale.saleNumber, limit: 1 })
  return rows[0] ?? null
}

export async function getRecentSales(storeId: string, limit = 6) {
  const db = forStore(storeId)
  const rows = await db.sale.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { cashier: { select: { name: true } }, _count: { select: { items: true } } },
  })
  return rows.map((s) => ({
    id: s.id,
    saleNumber: s.saleNumber,
    status: s.status,
    total: toNumber(s.total),
    paymentMethod: s.paymentMethod,
    createdAt: s.createdAt,
    cashierName: s.cashier.name,
    itemCount: s._count.items,
  }))
}

/// ยอดขายรายวันย้อนหลัง 30 วัน (นับเฉพาะบิล COMPLETED)
export async function getSalesReport(storeId: string) {
  const db = forStore(storeId)
  const rows = await db.$queryRaw<{ day: Date; total: string; bills: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS day,
           COALESCE(SUM("total"), 0)::text AS total,
           COUNT(*)::bigint AS bills
    FROM "sale"
    WHERE "storeId" = ${storeId} AND "status" = 'COMPLETED' AND "createdAt" >= now() - interval '30 days'
    GROUP BY 1
    ORDER BY 1 ASC
  `
  return rows.map((r) => ({
    day: new Date(r.day).toISOString().slice(0, 10),
    total: toNumber(r.total),
    bills: Number(r.bills),
  }))
}

/// รายการขายดี 30 วัน — นับทั้งสินค้าหน้าร้านและเมนูของ MJD Mobile Order ในลิสต์เดียวกัน
/// (ยอดขายทั้งสองช่องทางลง Sale ชุดเดียวกันตามกติกาข้อ 8 รายงานจึงต้องเห็นครบทั้งคู่)
export async function getTopSellingProducts(storeId: string, limit = 5) {
  const db = forStore(storeId)
  const rows = await db.$queryRaw<{ name: string; sku: string; qty: bigint; revenue: string }[]>`
    SELECT i."name" AS name,
           COALESCE(MAX(p."sku"), '') AS sku,
           SUM(i."quantity")::bigint AS qty,
           COALESCE(SUM(i."subtotal"), 0)::text AS revenue
    FROM "sale_item" i
    JOIN "sale" s ON s."id" = i."saleId"
    LEFT JOIN "product" p ON p."id" = i."productId"
    WHERE s."storeId" = ${storeId} AND s."status" = 'COMPLETED' AND s."createdAt" >= now() - interval '30 days'
    GROUP BY i."name"
    ORDER BY qty DESC
    LIMIT ${limit}
  `
  return rows.map((r) => ({
    name: r.name,
    sku: r.sku,
    quantity: Number(r.qty),
    revenue: toNumber(r.revenue),
  }))
}

export async function getPaymentBreakdown(storeId: string) {
  const db = forStore(storeId)
  const rows = await db.sale.groupBy({
    by: ["paymentMethod"],
    where: { status: "COMPLETED", createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    _sum: { total: true },
    _count: { _all: true },
  })
  return rows.map((r) => ({
    paymentMethod: r.paymentMethod as PaymentMethodValue,
    total: toNumber(r._sum.total ?? 0),
    bills: r._count._all,
  }))
}

export type ClosingSummary = {
  totalSales: number
  totalCash: number
  totalTransfer: number
  totalQR: number
  /// พร้อมเพย์/บัตร จากช่องทาง MJD Mobile Order (Phase 10) — แยกถังไว้ ไม่ปนกับ QR หน้าร้าน
  totalCard: number
  billCount: number
  voidedCount: number
}

/// สรุปยอดวันนี้ของแคชเชียร์คนหนึ่ง — คำนวณสดจาก Sale จริงเสมอ ไม่มีการกรอกเอง
export async function getTodaySalesSummary(storeId: string, cashierId: string): Promise<ClosingSummary> {
  const db = forStore(storeId)
  const { start, end } = businessDayRange()

  const [byMethod, voidedCount] = await Promise.all([
    db.sale.groupBy({
      by: ["paymentMethod"],
      where: { cashierId, status: "COMPLETED", createdAt: { gte: start, lt: end } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    db.sale.count({ where: { cashierId, status: "VOIDED", voidedAt: { gte: start, lt: end } } }),
  ])

  const summary: ClosingSummary = {
    totalSales: 0,
    totalCash: 0,
    totalTransfer: 0,
    totalQR: 0,
    totalCard: 0,
    billCount: 0,
    voidedCount,
  }

  for (const row of byMethod) {
    const value = toNumber(row._sum.total ?? 0)
    summary.totalSales += value
    summary.billCount += row._count._all
    if (row.paymentMethod === "CASH") summary.totalCash += value
    else if (row.paymentMethod === "TRANSFER") summary.totalTransfer += value
    else if (row.paymentMethod === "QR") summary.totalQR += value
    else summary.totalCard += value
  }

  return summary
}

export async function getTodayClosing(storeId: string, cashierId: string) {
  const db = forStore(storeId)
  const row = await db.cashierClosing.findUnique({
    where: { storeId_cashierId_closingDate: { storeId, cashierId, closingDate: businessDateOnly() } },
  })
  if (!row) return null
  return {
    id: row.id,
    closingDate: row.closingDate,
    totalSales: toNumber(row.totalSales),
    totalCash: toNumber(row.totalCash),
    totalTransfer: toNumber(row.totalTransfer),
    totalQR: toNumber(row.totalQR),
    totalCard: toNumber(row.totalCard),
    billCount: row.billCount,
    voidedCount: row.voidedCount,
    countedCash: toNumber(row.countedCash),
    difference: toNumber(row.difference),
    note: row.note,
    closedAt: row.closedAt,
  }
}

export async function listClosings(storeId: string, params: { cashierId?: string; limit?: number } = {}) {
  const db = forStore(storeId)
  const rows = await db.cashierClosing.findMany({
    where: params.cashierId ? { cashierId: params.cashierId } : {},
    orderBy: [{ closingDate: "desc" }, { closedAt: "desc" }],
    take: params.limit ?? 60,
    include: { cashier: { select: { name: true } } },
  })
  return rows.map((row) => ({
    id: row.id,
    cashierName: row.cashier.name,
    closingDate: row.closingDate,
    totalSales: toNumber(row.totalSales),
    totalCash: toNumber(row.totalCash),
    totalTransfer: toNumber(row.totalTransfer),
    totalQR: toNumber(row.totalQR),
    totalCard: toNumber(row.totalCard),
    billCount: row.billCount,
    voidedCount: row.voidedCount,
    countedCash: toNumber(row.countedCash),
    difference: toNumber(row.difference),
    note: row.note,
    closedAt: row.closedAt,
  }))
}

// ───────────────────── MJD Mobile Order (Phase 6–7) ─────────────────────

export type TableCardStatus =
  | "EMPTY"
  | "OPEN_NO_ORDER"
  | "ORDERED"
  | "AWAITING_BILL"
  | "OCCUPIED_MERGED"

export type TableCard = {
  id: string
  code: string
  status: TableCardStatus
  sessionId: string | null
  /// เวลาเปิดโต๊ะ — หน้า UI คำนวณ "เปิดมาแล้วกี่นาที" สดจากค่านี้ทุกครั้งที่ render (ห้ามเก็บเป็นฟิลด์)
  openedAt: Date | null
  total: number
  itemCount: number
  primaryTableId: string | null
  primaryTableCode: string | null
  mergedTableCodes: string[]
  pendingNotification: { id: string; type: "CALL_STAFF" | "CHECK_BILL"; reason: string | null } | null
}

/// ยอดสดต่อ session (ไม่รวมรายการที่ยกเลิก) — ใช้ raw SQL เพราะ Prisma groupBy ข้ามความสัมพันธ์ไม่ได้
/// ⚠️ raw SQL ไม่ผ่าน @@map — ชื่อตารางต้องเป็นชื่อจริงในฐาน (table_session, mobile_order, …)
async function liveSessionTotals(storeId: string) {
  const rows = await forStore(storeId).$queryRaw<{ sessionId: string; total: string; items: bigint }[]>`
    SELECT s."id" AS "sessionId",
           COALESCE(SUM(i."unitPrice" * i."quantity"), 0)::text AS total,
           COUNT(i."id")::bigint AS items
    FROM "table_session" s
    LEFT JOIN "mobile_order" o ON o."tableSessionId" = s."id"
    LEFT JOIN "mobile_order_item" i ON i."mobileOrderId" = o."id" AND i."status" <> 'CANCELLED'
    WHERE s."storeId" = ${storeId} AND s."status" IN ('OPEN', 'AWAITING_BILL')
    GROUP BY s."id"
  `
  return new Map(rows.map((r) => [r.sessionId, { total: toNumber(r.total), items: Number(r.items) }]))
}

export async function listTableOverview(storeId: string): Promise<TableCard[]> {
  const db = forStore(storeId)
  const [tables, sessions, totals, notifications] = await Promise.all([
    db.table.findMany({ orderBy: { code: "asc" } }),
    db.tableSession.findMany({
      where: { status: { in: ["OPEN", "AWAITING_BILL"] } },
      orderBy: { openedAt: "desc" },
      select: { id: true, tableId: true, openedAt: true, status: true },
    }),
    liveSessionTotals(storeId),
    db.notification.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true, reason: true, tableSessionId: true },
    }),
  ])

  const sessionByTable = new Map(sessions.map((s) => [s.tableId, s]))
  const notificationBySession = new Map<string, (typeof notifications)[number]>()
  for (const n of notifications) {
    if (!notificationBySession.has(n.tableSessionId)) notificationBySession.set(n.tableSessionId, n)
  }
  const codeById = new Map(tables.map((t) => [t.id, t.code]))
  const mergedByPrimary = new Map<string, string[]>()
  for (const t of tables) {
    if (!t.primaryTableId) continue
    mergedByPrimary.set(t.primaryTableId, [...(mergedByPrimary.get(t.primaryTableId) ?? []), t.code])
  }

  return tables.map<TableCard>((t) => {
    const session = sessionByTable.get(t.id) ?? null
    const totalsRow = session ? totals.get(session.id) : undefined
    const notification = session ? (notificationBySession.get(session.id) ?? null) : null

    return {
      id: t.id,
      code: t.code,
      status: t.status,
      sessionId: session?.id ?? null,
      openedAt: session?.openedAt ?? null,
      total: totalsRow?.total ?? 0,
      itemCount: totalsRow?.items ?? 0,
      primaryTableId: t.primaryTableId,
      primaryTableCode: t.primaryTableId ? (codeById.get(t.primaryTableId) ?? null) : null,
      mergedTableCodes: mergedByPrimary.get(t.id) ?? [],
      pendingNotification: notification
        ? { id: notification.id, type: notification.type, reason: notification.reason }
        : null,
    }
  })
}

export type NotificationCard = {
  id: string
  type: "CALL_STAFF" | "CHECK_BILL"
  reason: string | null
  status: "PENDING" | "ACKNOWLEDGED"
  createdAt: Date
  acknowledgedAt: Date | null
  acknowledgedByName: string | null
  tableId: string
  tableCode: string
  /// เวลาเปิดโต๊ะของ session ที่แจ้งเตือนมา — คนละอันกับ createdAt ของการแจ้งเตือนเอง (F12)
  openedAt: Date
  sessionTotal: number
}

export async function listNotifications(storeId: string, limit = 60): Promise<NotificationCard[]> {
  const db = forStore(storeId)
  const [rows, totals] = await Promise.all([
    db.notification.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: limit,
      include: {
        acknowledgedBy: { select: { name: true } },
        session: {
          select: {
            id: true,
            openedAt: true,
            table: { select: { id: true, code: true } },
          },
        },
      },
    }),
    liveSessionTotals(storeId),
  ])

  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    reason: n.reason,
    status: n.status,
    createdAt: n.createdAt,
    acknowledgedAt: n.acknowledgedAt,
    acknowledgedByName: n.acknowledgedBy?.name ?? null,
    tableId: n.session.table.id,
    tableCode: n.session.table.code,
    openedAt: n.session.openedAt,
    sessionTotal: totals.get(n.session.id)?.total ?? 0,
  }))
}

export async function getPendingNotificationCount(storeId: string) {
  const db = forStore(storeId)
  const [notifications, awaitingCallback] = await Promise.all([
    db.notification.count({ where: { status: "PENDING" } }),
    countPaymentsAwaitingCallback(storeId),
  ])
  // รวมเข้า badge เดียวกัน — ถ้าไม่รวม พนักงานจะไม่มีวันรู้ว่ามีเรื่องต้องดู จนกว่าจะบังเอิญเปิดหน้านี้
  return notifications + awaitingCallback
}

/// เวลาที่ยอมให้ callback ของธนาคารมาช้าได้ ก่อนจะเตือนพนักงานให้ไปตรวจเอง
///
/// ปกติ callback มาถึงในไม่กี่วินาที (วัดจริง 2026-09-09 ได้ 514 มิลลิวินาที) เกิน 5 นาที
/// จึงถือว่าผิดปกติแล้ว
///
/// ขยับจาก 3 เป็น 5 นาทีหลังทดสอบชำระเงินรอบ 2026-09-10 — ลูกค้าใช้เวลาเปิดแอปธนาคารและยืนยัน
/// ตัวตนเกิน 3 นาทีได้ตามปกติ พนักงานจึงเห็นใบเตือนทั้งที่ยังไม่มีอะไรผิด
const CALLBACK_GRACE_MS = 5 * 60 * 1000

/// เงื่อนไข "ออก QR ไปแล้วแต่ยังไม่มี callback กลับมา"
///
/// สถานะยัง PENDING แปลว่าไม่มีอะไรมาปิดใบนี้เลย — callback ที่ปิดบิลสำเร็จจะเปลี่ยนเป็น PAID
/// ส่วนเคสยอดไม่ตรง/ปิดบิลไม่ได้จะเป็น FAILED พร้อม Notification ของตัวเองอยู่แล้ว จึงไม่ซ้ำกัน
/// · ใบที่ลูกค้าสั่งเพิ่มจนต้องออก QR ใหม่จะถูกปิดเป็น EXPIRED ก็ไม่เข้าเงื่อนไขนี้เช่นกัน
function awaitingCallbackWhere(): Prisma.PaymentIntentWhereInput {
  return {
    status: "PENDING",
    createdAt: { lte: new Date(Date.now() - CALLBACK_GRACE_MS) },
    session: { status: { in: ["OPEN", "AWAITING_BILL"] } },
  }
}

export type PaymentAwaitingCallback = {
  intentId: string
  /// เลขอ้างอิงที่ส่งไปกับ QR — พนักงานใช้ตัวนี้ค้นรายการในแอปธนาคารได้โดยตรง
  ref1: string
  tableId: string
  tableCode: string
  amount: number
  issuedAt: Date
}

/// โต๊ะที่ออก QR ให้ลูกค้าไปแล้วเกิน 5 นาที แต่ธนาคารยังไม่ยิง callback กลับมา
///
/// **ไม่ใช่ Notification ในฐานข้อมูล แต่คำนวณสดทุกครั้งที่เปิดหน้า** — ตั้งใจให้เป็นแบบนี้เพราะ
/// เงื่อนไขนี้หายเองได้ (callback มาถึงทีหลัง / พนักงานปิดบิลมือ / โต๊ะถูกยกเลิก) ถ้าเขียนเป็นแถว
/// ในตารางจะต้องมีคนคอยตามลบ แล้วสุดท้ายพนักงานจะเห็นใบค้างที่แก้ไปแล้วเต็มหน้าจอ
///
/// ⚠️ **แค่เตือน ห้ามปิดบิลและห้ามยิงถามธนาคาร** — ตามการตัดสินใจ 2026-09-09 ว่าเงินเข้าต้อง
/// ยืนยันด้วย callback ของธนาคารเท่านั้น คนที่ตัดสินใจว่าเงินเข้าจริงหรือไม่คือพนักงาน
export async function listPaymentsAwaitingCallback(storeId: string): Promise<PaymentAwaitingCallback[]> {
  const db = forStore(storeId)
  const rows = await db.paymentIntent.findMany({
    where: awaitingCallbackWhere(),
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      ref1: true,
      amount: true,
      createdAt: true,
      session: { select: { table: { select: { id: true, code: true } } } },
    },
  })

  return rows.map((row) => ({
    intentId: row.id,
    ref1: row.ref1,
    tableId: row.session.table.id,
    tableCode: row.session.table.code,
    amount: toNumber(row.amount),
    issuedAt: row.createdAt,
  }))
}

export async function countPaymentsAwaitingCallback(storeId: string): Promise<number> {
  const db = forStore(storeId)
  return db.paymentIntent.count({ where: awaitingCallbackWhere() })
}

/// นานแค่ไหนที่ยังขึ้นป้าย "ชำระเงินแล้ว" ให้พนักงานเห็นบนหน้าจอ
///
/// ต้องนานพอให้พนักงานที่เดินไปเก็บโต๊ะอื่นกลับมาแล้วยังเห็นทัน แต่ไม่นานจนป้ายเก่าท่วมจอ ·
/// ขยับจาก 15 เป็น 30 นาทีเมื่อ 2026-09-10 เพราะเคสจ่ายช้า (ลูกค้าจ่ายหลัง QR หมดอายุ)
/// กว่าพนักงานจะกลับมาดูจอก็เลย 15 นาทีไปแล้ว แล้วป้ายหายไปก่อนที่จะมีใครได้เห็น
const PAID_NOTICE_WINDOW_MS = 30 * 60 * 1000

export type CustomerPaidBill = {
  saleId: string
  saleNumber: string
  tableId: string | null
  tableCode: string
  total: number
  paymentMethod: PaymentMethodValue
  /// เวลาที่บิลถูกปิด = เวลาที่ธนาคารยืนยันว่าเงินเข้า (callback ปิดบิลในทรานแซคชันเดียวกัน)
  paidAt: Date
  /// ระบบปิดบิลให้เองหลังธนาคารยืนยัน (true) หรือพนักงานกดปิดเอง (false)
  autoClosed: boolean
  /// ชื่อพนักงานที่กดปิดบิล — null เมื่อระบบปิดให้เอง
  closedByName: string | null
}

/// บิลของ MJD Mobile Order ที่ปิดไปแล้วภายใน 30 นาทีที่ผ่านมา — ทั้งที่ระบบปิดเองและพนักงานกดปิด
///
/// มีไว้เพราะพอบิลถูกปิด โต๊ะจะกลับเป็น "ว่าง" ทันที — พนักงานที่เฝ้าหน้าผังโต๊ะจึงเห็นแค่โต๊ะ
/// หายไปเฉย ๆ ไม่มีอะไรบอกว่าลูกค้าจ่ายครบแล้วหรือแค่ลุกไป
/// ป้ายนี้ตอบให้ชัดว่า "โต๊ะไหน จ่ายเมื่อกี่โมง ยอดเท่าไร บิลเลขอะไร ใครเป็นคนปิด"
///
/// **คำนวณสดเหมือน `listPaymentsAwaitingCallback(storeId)`** ไม่เขียนแถวลงตาราง `Notification` —
/// ป้ายนี้ไม่มีอะไรให้พนักงานต้องกดรับทราบ มันหายเองเมื่อพ้นช่วงเวลา
///
/// ⚠️ **เดิมกรองเฉพาะบิลที่ระบบปิดเอง (`cashierId = SYSTEM_USER_ID`) ด้วยเหตุผลว่า "บิลที่พนักงาน
/// กดปิดเอง คนกดรู้อยู่แล้ว" — ผิด** เจ้าของระบบเจอจริง 2026-09-10 ว่าเคส QR หมดอายุแล้วลูกค้า
/// จ่ายช้ามักจบด้วยพนักงานกดปิดเอง (เห็นเตือน "รอธนาคารยืนยัน" → เช็กแอปธนาคาร → กดปิด)
/// จอเลยไม่ขึ้นอะไรเลยทั้งที่ลูกค้าจ่ายแล้ว · และคนที่กดปิดกับคนที่เฝ้าจอมักเป็นคนละคน
/// จึงต้องขึ้นทุกบิล แล้วบอกให้ชัดแทนว่าใครเป็นคนปิด
export async function listCustomerPaidBills(storeId: string, limit = 12): Promise<CustomerPaidBill[]> {
  const db = forStore(storeId)
  const rows = await db.sale.findMany({
    where: {
      channel: "MOBILE_ORDER",
      status: "COMPLETED",
      createdAt: { gte: new Date(Date.now() - PAID_NOTICE_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      saleNumber: true,
      total: true,
      paymentMethod: true,
      createdAt: true,
      cashierId: true,
      cashier: { select: { name: true } },
      session: { select: { table: { select: { id: true, code: true } } } },
    },
  })

  return rows.map((row) => {
    const autoClosed = row.cashierId === SYSTEM_USER_ID
    return {
      saleId: row.id,
      saleNumber: row.saleNumber,
      tableId: row.session?.table.id ?? null,
      // บิลของช่องทางนี้ผูกกับโต๊ะเสมอ — ที่เผื่อไว้คือกรณีข้อมูลเก่าที่ session ถูกลบทิ้ง
      tableCode: row.session?.table.code ?? "-",
      total: toNumber(row.total),
      paymentMethod: row.paymentMethod as PaymentMethodValue,
      paidAt: row.createdAt,
      autoClosed,
      closedByName: autoClosed ? null : (row.cashier?.name ?? null),
    }
  })
}

export type OrderItemRow = {
  id: string
  menuItemName: string
  quantity: number
  unitPrice: number
  subtotal: number
  note: string | null
  status: "AWAITING_KITCHEN" | "COOKING" | "READY" | "SERVED" | "CANCELLED"
  options: { groupName: string; optionName: string; priceDelta: number }[]
  cancelReason: string | null
}

export type TableDetail = {
  tableId: string
  tableCode: string
  status: TableCardStatus
  sessionId: string
  openedAt: Date
  sessionStatus: "OPEN" | "AWAITING_BILL" | "CLOSED" | "CANCELLED"
  qrType: "STATIC" | "DYNAMIC" | null
  mergedTableCodes: string[]
  total: number
  hasKDS: boolean
  orders: {
    id: string
    orderNumber: number
    submittedAt: Date
    printedAt: Date | null
    items: OrderItemRow[]
  }[]
  notifications: { id: string; type: "CALL_STAFF" | "CHECK_BILL"; reason: string | null; createdAt: Date }[]
}

/// แปลง JSON snapshot ของ modifier ให้เป็นรูปแบบที่หน้าจอใช้ได้ — ข้อมูลเก่าอาจว่างหรือผิดรูป
function parseOptions(raw: unknown): { groupName: string; optionName: string; priceDelta: number }[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return []
    const record = entry as Record<string, unknown>
    if (typeof record.optionName !== "string") return []
    return [
      {
        groupName: typeof record.groupName === "string" ? record.groupName : "",
        optionName: record.optionName,
        priceDelta: toNumber(record.priceDelta ?? 0),
      },
    ]
  })
}

export async function getTableDetail(storeId: string, tableId: string): Promise<TableDetail | null> {
  const db = forStore(storeId)
  const table = await db.table.findUnique({
    where: { id: tableId },
    select: { id: true, code: true, status: true, primaryTableId: true },
  })
  if (!table) return null

  // โต๊ะรองไม่มี session ของตัวเอง — ทุกอย่างอยู่ที่โต๊ะหลัก
  const targetId = table.primaryTableId ?? table.id

  const [session, settings, merged] = await Promise.all([
    db.tableSession.findFirst({
      where: { tableId: targetId, status: { in: ["OPEN", "AWAITING_BILL"] } },
      orderBy: { openedAt: "desc" },
      include: {
        table: { select: { id: true, code: true, status: true } },
        qrCode: { select: { type: true } },
        orders: {
          orderBy: { orderNumber: "asc" },
          include: {
            items: {
              orderBy: { createdAt: "asc" },
              include: { menuItem: { select: { name: true } } },
            },
          },
        },
        notifications: {
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
          select: { id: true, type: true, reason: true, createdAt: true },
        },
      },
    }),
    db.storeSettings.findUnique({ where: { storeId }, select: { hasKDS: true } }),
    db.table.findMany({ where: { primaryTableId: targetId }, select: { code: true } }),
  ])

  if (!session) return null

  const orders = session.orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    submittedAt: order.submittedAt,
    printedAt: order.printedAt,
    items: order.items.map<OrderItemRow>((item) => ({
      id: item.id,
      menuItemName: item.menuItem.name,
      quantity: item.quantity,
      unitPrice: toNumber(item.unitPrice),
      subtotal: toNumber(item.unitPrice) * item.quantity,
      note: item.note,
      status: item.status,
      options: parseOptions(item.selectedOptionsSnapshot),
      cancelReason: item.cancelReason,
    })),
  }))

  const total = orders
    .flatMap((o) => o.items)
    .filter((i) => i.status !== "CANCELLED")
    .reduce((sum, i) => sum + i.subtotal, 0)

  return {
    tableId: session.table.id,
    tableCode: session.table.code,
    status: session.table.status,
    sessionId: session.id,
    openedAt: session.openedAt,
    sessionStatus: session.status,
    qrType: session.qrCode?.type ?? null,
    mergedTableCodes: merged.map((m) => m.code),
    total: Math.round((total + Number.EPSILON) * 100) / 100,
    hasKDS: settings?.hasKDS ?? false,
    orders,
  notifications: session.notifications,
  }
}

export type KitchenTicket = {
  orderId: string
  orderNumber: number
  tableCode: string
  submittedAt: Date
  printedAt: Date | null
  items: OrderItemRow[]
}

/// ทิกเก็ตครัว — รวมเฉพาะรายการที่ยังไม่จบ (ยกเลิก/เสิร์ฟแล้วไม่ต้องแสดงบน KDS)
export async function listKitchenTickets(storeId: string): Promise<KitchenTicket[]> {
  const db = forStore(storeId)
  const orders = await db.mobileOrder.findMany({
    where: {
      session: { status: { in: ["OPEN", "AWAITING_BILL"] } },
      items: { some: { status: { in: ["AWAITING_KITCHEN", "COOKING", "READY"] } } },
    },
    orderBy: { submittedAt: "asc" },
    include: {
      session: { select: { table: { select: { code: true } } } },
      items: {
        where: { status: { in: ["AWAITING_KITCHEN", "COOKING", "READY"] } },
        orderBy: { createdAt: "asc" },
        include: { menuItem: { select: { name: true } } },
      },
    },
  })

  return orders.map((order) => ({
    orderId: order.id,
    orderNumber: order.orderNumber,
    tableCode: order.session.table.code,
    submittedAt: order.submittedAt,
    printedAt: order.printedAt,
    items: order.items.map<OrderItemRow>((item) => ({
      id: item.id,
      menuItemName: item.menuItem.name,
      quantity: item.quantity,
      unitPrice: toNumber(item.unitPrice),
      subtotal: toNumber(item.unitPrice) * item.quantity,
      note: item.note,
      status: item.status,
      options: parseOptions(item.selectedOptionsSnapshot),
      cancelReason: item.cancelReason,
    })),
  }))
}

export async function getStoreSettings(storeId: string) {
  const db = forStore(storeId)
  const settings = await db.storeSettings.findUnique({ where: { storeId } })
  if (!settings) return null
  return {
    id: settings.id,
    storeName: settings.storeName,
    logoUrl: settings.logoUrl,
    coverImageUrl: settings.coverImageUrl,
    themeColor: settings.themeColor,
    hasKDS: settings.hasKDS,
    serviceChargePercent: toNumber(settings.serviceChargePercent),
    crmEnabled: settings.crmEnabled,
  }
}

// ───────────────────── ฝั่งลูกค้า (Phase 9) ─────────────────────

export type CustomerSession =
  | {
      ok: true
      /// ร้านเจ้าของ QR (Phase 13) — หน้าลูกค้าใช้ค่านี้เรียก query อื่นต่อ
      storeId: string
      sessionId: string
      tableId: string
      tableCode: string
      openedAt: Date
      awaitingBill: boolean
    }
  | { ok: false; reason: "QR_NOT_FOUND" | "QR_INVALIDATED" | "NO_SESSION" | "STORE_SUSPENDED" }

/// แปลง QR token เป็น session ที่ใช้งานอยู่ — ทุกหน้าฝั่งลูกค้าเรียกตัวนี้ก่อนเสมอ
/// ไม่สร้าง session ใหม่ที่นี่ (การสร้างอยู่ที่ server action `openTableSession` เท่านั้น)
/// ไม่รับ storeId เพราะฝั่งลูกค้ายังไม่รู้ร้าน — token คือตัวบอกร้าน (lib/store-resolve.ts)
export async function resolveCustomerSession(qrToken: string): Promise<CustomerSession> {
  const store = await findStoreByQrToken(qrToken)
  if (!store) return { ok: false, reason: "QR_NOT_FOUND" }
  if (store.status === "SUSPENDED") return { ok: false, reason: "STORE_SUSPENDED" }
  const storeId = store.storeId
  const db = forStore(storeId)
  const qr = await db.qRCode.findUnique({
    where: { token: qrToken },
    select: { id: true, status: true, tableId: true, table: { select: { primaryTableId: true } } },
  })
  if (!qr) return { ok: false, reason: "QR_NOT_FOUND" }
  if (qr.status === "INVALIDATED") return { ok: false, reason: "QR_INVALIDATED" }

  const targetTableId = qr.table.primaryTableId ?? qr.tableId

  const session = await db.tableSession.findFirst({
    where: { tableId: targetTableId, status: { in: ["OPEN", "AWAITING_BILL"] } },
    orderBy: { openedAt: "desc" },
    select: { id: true, openedAt: true, status: true, table: { select: { id: true, code: true } } },
  })
  if (!session) return { ok: false, reason: "NO_SESSION" }

  return {
    ok: true,
    storeId,
    sessionId: session.id,
    tableId: session.table.id,
    tableCode: session.table.code,
    openedAt: session.openedAt,
    awaitingBill: session.status === "AWAITING_BILL",
  }
}

export type MenuOption = { id: string; name: string; priceDelta: number }
export type MenuModifierGroup = {
  id: string
  name: string
  selectionType: "SINGLE" | "MULTIPLE"
  required: boolean
  options: MenuOption[]
}
export type MenuItemCard = {
  id: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  isFeatured: boolean
  modifierGroups: MenuModifierGroup[]
}

function toMenuCard(item: {
  id: string
  name: string
  description: string | null
  price: unknown
  imageUrl: string | null
  isFeatured: boolean
  modifierGroups: {
    id: string
    name: string
    selectionType: "SINGLE" | "MULTIPLE"
    required: boolean
    options: { id: string; name: string; priceDelta: unknown }[]
  }[]
}): MenuItemCard {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    price: toNumber(item.price),
    imageUrl: item.imageUrl,
    isFeatured: item.isFeatured,
    modifierGroups: item.modifierGroups.map((group) => ({
      id: group.id,
      name: group.name,
      selectionType: group.selectionType,
      required: group.required,
      options: group.options.map((option) => ({
        id: option.id,
        name: option.name,
        priceDelta: toNumber(option.priceDelta),
      })),
    })),
  }
}

const MENU_INCLUDE = {
  modifierGroups: {
    orderBy: { sortOrder: "asc" as const },
    include: { options: { orderBy: { sortOrder: "asc" as const } } },
  },
}

export async function listMenu(storeId: string): Promise<{ featured: MenuItemCard[]; all: MenuItemCard[] }> {
  const db = forStore(storeId)
  const items = await db.menuItem.findMany({
    where: { isActive: true },
    orderBy: [{ isFeatured: "desc" }, { featuredSortOrder: "asc" }, { name: "asc" }],
    include: MENU_INCLUDE,
  })

  const cards = items.map(toMenuCard)
  return {
    featured: cards.filter((c) => c.isFeatured).slice(0, 6),
    all: cards,
  }
}

export async function getMenuItem(storeId: string, id: string): Promise<MenuItemCard | null> {
  const db = forStore(storeId)
  const item = await db.menuItem.findFirst({
    where: { id, isActive: true },
    include: MENU_INCLUDE,
  })
  return item ? toMenuCard(item) : null
}

export type CustomerOrderView = {
  sessionId: string
  tableCode: string
  awaitingBill: boolean
  total: number
  orders: {
    id: string
    orderNumber: number
    submittedAt: Date
    items: OrderItemRow[]
  }[]
}

/// สถานะออร์เดอร์ที่ลูกค้าเห็น — หน้า /order/[qrToken]/status โพลตัวนี้เป็นรอบ ๆ
export async function getCustomerOrderView(storeId: string, sessionId: string): Promise<CustomerOrderView | null> {
  const db = forStore(storeId)
  const session = await db.tableSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      table: { select: { code: true } },
      orders: {
        orderBy: { orderNumber: "asc" },
        include: {
          items: { orderBy: { createdAt: "asc" }, include: { menuItem: { select: { name: true } } } },
        },
      },
    },
  })
  if (!session) return null

  const orders = session.orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    submittedAt: order.submittedAt,
    items: order.items.map<OrderItemRow>((item) => ({
      id: item.id,
      menuItemName: item.menuItem.name,
      quantity: item.quantity,
      unitPrice: toNumber(item.unitPrice),
      subtotal: toNumber(item.unitPrice) * item.quantity,
      note: item.note,
      status: item.status,
      options: parseOptions(item.selectedOptionsSnapshot),
      cancelReason: item.cancelReason,
    })),
  }))

  const total = orders
    .flatMap((o) => o.items)
    .filter((i) => i.status !== "CANCELLED")
    .reduce((sum, i) => sum + i.subtotal, 0)

  return {
    sessionId: session.id,
    tableCode: session.table.code,
    awaitingBill: session.status === "AWAITING_BILL",
    total: Math.round((total + Number.EPSILON) * 100) / 100,
    orders,
  }
}

export type QrCodeRow = {
  tableId: string
  tableCode: string
  tableStatus: TableCardStatus
  qrId: string | null
  token: string | null
  type: "STATIC" | "DYNAMIC" | null
  issuedAt: Date | null
  invalidatedCount: number
}

/// รายการ QR ต่อโต๊ะ — ใช้ได้พร้อมกันแค่ 1 ใบต่อโต๊ะ (ใบเก่าต้องถูก invalidate ก่อน)
export async function listQrCodes(storeId: string): Promise<QrCodeRow[]> {
  const db = forStore(storeId)
  const tables = await db.table.findMany({
    orderBy: { code: "asc" },
    include: {
      qrCodes: { orderBy: { issuedAt: "desc" } },
    },
  })

  return tables.map((table) => {
    const active = table.qrCodes.find((qr) => qr.status === "ACTIVE") ?? null
    return {
      tableId: table.id,
      tableCode: table.code,
      tableStatus: table.status,
      qrId: active?.id ?? null,
      token: active?.token ?? null,
      type: active?.type ?? null,
      issuedAt: active?.issuedAt ?? null,
      invalidatedCount: table.qrCodes.filter((qr) => qr.status === "INVALIDATED").length,
    }
  })
}

// ───────────────────── ชำระเงิน / ปิดบิล (Phase 10) ─────────────────────

export type BillingLine = {
  id: string
  name: string
  quantity: number
  unitPrice: number
  subtotal: number
  options: string[]
}

export type BillingView = {
  tableId: string
  tableCode: string
  sessionId: string
  sessionStatus: "OPEN" | "AWAITING_BILL"
  openedAt: Date
  mergedTableCodes: string[]
  storeName: string
  lines: BillingLine[]
  itemsTotal: number
  servicePercent: number
  serviceCharge: number
  total: number
}

/// ใบเสร็จของโต๊ะสำหรับหน้าปิดบิลฝั่งพนักงาน (F17) — ยอดคิดจาก `computeBillTotals` ตัวเดียวกับที่ปิดบิลจริง
/// รายการที่ถูกยกเลิกไม่เข้าบิล และรายการซ้ำ (ชื่อ+ตัวเลือก+ราคาเดียวกัน) ถูกยุบเป็นบรรทัดเดียว
export async function getBillingView(storeId: string, tableId: string): Promise<BillingView | null> {
  const db = forStore(storeId)
  const table = await db.table.findUnique({
    where: { id: tableId },
    select: { id: true, primaryTableId: true },
  })
  if (!table) return null

  // โต๊ะรองไม่มีบิลของตัวเอง — ปิดบิลที่โต๊ะหลักเสมอ
  const targetId = table.primaryTableId ?? table.id

  const [session, settings, merged] = await Promise.all([
    db.tableSession.findFirst({
      where: { tableId: targetId, status: { in: ["OPEN", "AWAITING_BILL"] } },
      orderBy: { openedAt: "desc" },
      select: {
        id: true,
        status: true,
        openedAt: true,
        table: { select: { id: true, code: true } },
        orders: {
          orderBy: { orderNumber: "asc" },
          select: {
            items: {
              where: { status: { not: "CANCELLED" } },
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                quantity: true,
                unitPrice: true,
                selectedOptionsSnapshot: true,
                menuItem: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    db.storeSettings.findUnique({
      where: { storeId },
      select: { storeName: true, serviceChargePercent: true },
    }),
    db.table.findMany({ where: { primaryTableId: targetId }, select: { code: true } }),
  ])

  if (!session) return null

  const raw = session.orders.flatMap((order) => order.items)

  // ยุบบรรทัดที่เหมือนกันทุกประการเพื่อให้ใบเสร็จอ่านง่าย — คีย์รวมตัวเลือกไว้ด้วยจึงไม่ยุบข้ามตัวเลือก
  const grouped = new Map<string, BillingLine>()
  for (const item of raw) {
    const options = parseOptions(item.selectedOptionsSnapshot).map((o) => o.optionName)
    const unitPrice = toNumber(item.unitPrice)
    const key = `${item.menuItem.name}|${unitPrice.toFixed(2)}|${options.join(",")}`
    const existing = grouped.get(key)
    if (existing) {
      existing.quantity += item.quantity
      existing.subtotal = round2(existing.unitPrice * existing.quantity)
      continue
    }
    grouped.set(key, {
      id: item.id,
      name: item.menuItem.name,
      quantity: item.quantity,
      unitPrice,
      subtotal: round2(unitPrice * item.quantity),
      options,
    })
  }

  const lines = [...grouped.values()]
  const servicePercent = toNumber(settings?.serviceChargePercent ?? 0)
  const totals = computeBillTotals(lines, servicePercent)

  return {
    tableId: session.table.id,
    tableCode: session.table.code,
    sessionId: session.id,
    sessionStatus: session.status as "OPEN" | "AWAITING_BILL",
    openedAt: session.openedAt,
    mergedTableCodes: merged.map((m) => m.code),
    storeName: settings?.storeName ?? "MJD Mobile Order",
    lines,
    itemsTotal: totals.itemsTotal,
    servicePercent,
    serviceCharge: totals.serviceCharge,
    total: totals.total,
  }
}

export type CustomerPaymentStatus =
  | {
      state: "UNPAID"
      storeId: string
      sessionId: string
      tableCode: string
      itemsTotal: number
      servicePercent: number
      serviceCharge: number
      total: number
      awaitingBill: boolean
    }
  | { state: "PAID"; tableCode: string; saleNumber: string; total: number; paidAt: Date }
  | { state: "UNKNOWN" }

/// สถานะการชำระเงินสำหรับหน้า `/order/[qrToken]/pay/*` และ endpoint ที่หน้านั้นโพล
///
/// ต่างจาก `resolveCustomerSession` ตรงที่ **ต้องตอบได้แม้ QR ถูก invalidate ไปแล้ว** — เพราะการปิดบิล
/// สำเร็จคือสิ่งที่ทำให้ DYNAMIC QR ใช้ไม่ได้ ถ้าใช้ resolver ตัวเดิม ลูกค้าจะเห็นหน้า error แทนหน้า "จ่ายสำเร็จ"
export async function getCustomerPaymentStatus(qrToken: string): Promise<CustomerPaymentStatus> {
  const store = await findStoreByQrToken(qrToken)
  if (!store) return { state: "UNKNOWN" }
  const storeId = store.storeId
  const db = forStore(storeId)
  const qr = await db.qRCode.findUnique({
    where: { token: qrToken },
    select: { tableId: true, table: { select: { primaryTableId: true } } },
  })
  if (!qr) return { state: "UNKNOWN" }

  const targetTableId = qr.table.primaryTableId ?? qr.tableId

  const session = await db.tableSession.findFirst({
    where: { tableId: targetTableId },
    orderBy: { openedAt: "desc" },
    select: {
      id: true,
      status: true,
      table: { select: { code: true } },
      sale: { select: { saleNumber: true, total: true, createdAt: true } },
      orders: {
        select: {
          items: {
            where: { status: { not: "CANCELLED" } },
            select: { quantity: true, unitPrice: true },
          },
        },
      },
    },
  })
  if (!session) return { state: "UNKNOWN" }

  if (session.sale) {
    return {
      state: "PAID",
      tableCode: session.table.code,
      saleNumber: session.sale.saleNumber,
      total: toNumber(session.sale.total),
      paidAt: session.sale.createdAt,
    }
  }

  if (session.status === "CLOSED" || session.status === "CANCELLED") return { state: "UNKNOWN" }

  const settings = await db.storeSettings.findUnique({
    where: { storeId },
    select: { serviceChargePercent: true },
  })
  const servicePercent = toNumber(settings?.serviceChargePercent ?? 0)
  const totals = computeBillTotals(
    session.orders
      .flatMap((order) => order.items)
      .map((item) => ({ quantity: item.quantity, unitPrice: toNumber(item.unitPrice) })),
    servicePercent,
  )

  return {
    state: "UNPAID",
    storeId,
    sessionId: session.id,
    tableCode: session.table.code,
    itemsTotal: totals.itemsTotal,
    servicePercent,
    serviceCharge: totals.serviceCharge,
    total: totals.total,
    awaitingBill: session.status === "AWAITING_BILL",
  }
}

// ───────────────────── ทิกเก็ตครัวแบบ PDF (Phase 8) ─────────────────────

export type KitchenTicketDoc = {
  orderId: string
  orderNumber: number
  tableCode: string
  mergedTableCodes: string[]
  submittedAt: Date
  printedAt: Date | null
  storeName: string
  items: { id: string; quantity: number; name: string; options: string[]; note: string | null }[]
}

/// ทิกเก็ตของออร์เดอร์เดียวสำหรับหน้าพิมพ์/บันทึกเป็น PDF
/// รายการที่ถูกยกเลิกไม่ขึ้นทิกเก็ต — ครัวต้องไม่เห็นของที่ไม่ต้องทำ
export async function getKitchenTicket(storeId: string, orderId: string): Promise<KitchenTicketDoc | null> {
  const db = forStore(storeId)
  const order = await db.mobileOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      submittedAt: true,
      printedAt: true,
      session: { select: { tableId: true, table: { select: { code: true } } } },
      items: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          quantity: true,
          note: true,
          selectedOptionsSnapshot: true,
          menuItem: { select: { name: true } },
        },
      },
    },
  })
  if (!order) return null

  const [settings, merged] = await Promise.all([
    db.storeSettings.findUnique({ where: { storeId }, select: { storeName: true } }),
    db.table.findMany({ where: { primaryTableId: order.session.tableId }, select: { code: true } }),
  ])

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    tableCode: order.session.table.code,
    mergedTableCodes: merged.map((m) => m.code),
    submittedAt: order.submittedAt,
    printedAt: order.printedAt,
    storeName: settings?.storeName ?? "MJD Mobile Order",
    items: order.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      name: item.menuItem.name,
      options: parseOptions(item.selectedOptionsSnapshot).map((o) => o.optionName),
      note: item.note,
    })),
  }
}

// ───────────────────── ตั้งค่าร้าน (Phase 12) ─────────────────────

export type FeaturableMenuItem = {
  id: string
  name: string
  price: number
  isActive: boolean
  isFeatured: boolean
  featuredSortOrder: number
}

/// เมนูทั้งหมดสำหรับหน้าตั้งค่า — รวมเมนูที่ปิดใช้งานไว้ด้วย เพื่อให้เห็นว่าอะไรถูกซ่อนอยู่
export async function listMenuForSettings(storeId: string): Promise<FeaturableMenuItem[]> {
  const db = forStore(storeId)
  const items = await db.menuItem.findMany({
    orderBy: [{ isFeatured: "desc" }, { featuredSortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      price: true,
      isActive: true,
      isFeatured: true,
      featuredSortOrder: true,
    },
  })
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    price: toNumber(item.price),
    isActive: item.isActive,
    isFeatured: item.isFeatured,
    featuredSortOrder: item.featuredSortOrder ?? 0,
  }))
}

/// จำนวนโต๊ะที่ยังเปิดอยู่ — หน้าตั้งค่าใช้บอกล่วงหน้าว่าสลับโหมดครัวได้หรือยัง
/// (ด่านจริงอยู่ใน `updateStoreSettings` ที่เช็คซ้ำในทรานแซคชันเดียวกับการเขียน)
export async function getOpenSessionCount(storeId: string): Promise<number> {
  const db = forStore(storeId)
  return db.tableSession.count({ where: { status: { in: ["OPEN", "AWAITING_BILL"] } } })
}

// ───────────────────── บทบาทและสิทธิ์ (§4) ─────────────────────

export type RoleRow = {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  userCount: number
  permissions: Partial<Record<ResourceKey, PermissionActionValue[]>>
}

export async function listRoles(storeId: string): Promise<RoleRow[]> {
  const db = forStore(storeId)
  const roles = await db.role.findMany({
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      isSystem: true,
      _count: { select: { members: true } },
      permissions: { select: { resource: true, actions: true } },
    },
  })

  return roles.map((role) => {
    const permissions: Partial<Record<ResourceKey, PermissionActionValue[]>> = {}
    for (const row of role.permissions) permissions[row.resource] = row.actions
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      userCount: role._count.members,
      permissions,
    }
  })
}

export async function listRoleOptions(storeId: string) {
  const db = forStore(storeId)
  return db.role.findMany({
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    select: { id: true, name: true, isSystem: true },
  })
}

// ───────────────── จัดการโต๊ะและเมนู (master data) ─────────────────

export type ManagedTable = {
  id: string
  code: string
  status: TableCardStatus
  mergedInto: string | null
  mergedCount: number
  sessionCount: number
  hasActiveQr: boolean
}

/// โต๊ะทั้งหมดพร้อมข้อมูลที่ใช้ตัดสินว่าแก้/ลบได้ไหม — หน้า /mobile-order/tables/manage
export async function listTablesForManage(storeId: string): Promise<ManagedTable[]> {
  const db = forStore(storeId)
  const tables = await db.table.findMany({
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      status: true,
      primaryTable: { select: { code: true } },
      _count: { select: { mergedTables: true, sessions: true } },
      qrCodes: { where: { status: "ACTIVE" }, select: { id: true }, take: 1 },
    },
  })

  return tables.map((table) => ({
    id: table.id,
    code: table.code,
    status: table.status,
    mergedInto: table.primaryTable?.code ?? null,
    mergedCount: table._count.mergedTables,
    sessionCount: table._count.sessions,
    hasActiveQr: table.qrCodes.length > 0,
  }))
}

export type ManagedMenuItem = {
  id: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  isActive: boolean
  isFeatured: boolean
  orderedCount: number
  modifierGroups: {
    name: string
    selectionType: "SINGLE" | "MULTIPLE"
    required: boolean
    options: { name: string; priceDelta: number }[]
  }[]
}

/// เมนูทั้งหมดพร้อมตัวเลือกเสริม — หน้า /mobile-order/menu
export async function listMenuForManage(storeId: string): Promise<ManagedMenuItem[]> {
  const db = forStore(storeId)
  const items = await db.menuItem.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      imageUrl: true,
      isActive: true,
      isFeatured: true,
      _count: { select: { orderItems: true, saleItems: true } },
      modifierGroups: {
        orderBy: { sortOrder: "asc" },
        select: {
          name: true,
          selectionType: true,
          required: true,
          options: { orderBy: { sortOrder: "asc" }, select: { name: true, priceDelta: true } },
        },
      },
    },
  })

  return items.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    price: toNumber(item.price),
    imageUrl: item.imageUrl,
    isActive: item.isActive,
    isFeatured: item.isFeatured,
    orderedCount: item._count.orderItems + item._count.saleItems,
    modifierGroups: item.modifierGroups.map((group) => ({
      name: group.name,
      selectionType: group.selectionType,
      required: group.required,
      options: group.options.map((option) => ({
        name: option.name,
        priceDelta: toNumber(option.priceDelta),
      })),
    })),
  }))
}
