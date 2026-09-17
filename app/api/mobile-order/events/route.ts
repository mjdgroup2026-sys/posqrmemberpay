import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/session"

/// เหตุการณ์ที่เกิดขึ้นหลังเวลา `since` — ให้เครื่อง POS/KDS ที่เน็ตหลุดชั่วคราวดึงของที่พลาดไปตอนต่อกลับ
/// (§8 Phase 8: ห้ามพึ่ง delivery guarantee ของ WebSocket อย่างเดียว มิฉะนั้นออร์เดอร์อาจ "หาย" จากมุมมอง POS)
///
///   GET /api/mobile-order/events?since=2026-09-03T10:00:00.000Z
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 })
  }

  const sinceParam = request.nextUrl.searchParams.get("since")
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 5 * 60_000)
  if (Number.isNaN(since.getTime())) {
    return NextResponse.json({ error: "รูปแบบเวลาไม่ถูกต้อง" }, { status: 400 })
  }

  const [orders, items, notifications, sessions] = await Promise.all([
    prisma.mobileOrder.findMany({
      where: { submittedAt: { gt: since } },
      orderBy: { submittedAt: "asc" },
      select: {
        id: true,
        orderNumber: true,
        submittedAt: true,
        printedAt: true,
        session: { select: { id: true, table: { select: { id: true, code: true } } } },
      },
    }),
    prisma.mobileOrderItem.findMany({
      where: { updatedAt: { gt: since } },
      orderBy: { updatedAt: "asc" },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        mobileOrderId: true,
        menuItem: { select: { name: true } },
      },
    }),
    prisma.notification.findMany({
      where: { createdAt: { gt: since } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        status: true,
        reason: true,
        createdAt: true,
        session: { select: { table: { select: { id: true, code: true } } } },
      },
    }),
    prisma.tableSession.findMany({
      where: { updatedAt: { gt: since } },
      orderBy: { updatedAt: "asc" },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        table: { select: { id: true, code: true } },
      },
    }),
  ])

  return NextResponse.json({
    since: since.toISOString(),
    now: new Date().toISOString(),
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      submittedAt: o.submittedAt,
      printedAt: o.printedAt,
      // ออร์เดอร์กลับบ้านไม่มีโต๊ะ (Phase 17c) — ปลายทางที่โพลอยู่ต้องรับ null ได้
      sessionId: o.session?.id ?? null,
      tableId: o.session?.table.id ?? null,
      tableCode: o.session?.table.code ?? null,
    })),
    items: items.map((i) => ({
      id: i.id,
      status: i.status,
      updatedAt: i.updatedAt,
      orderId: i.mobileOrderId,
      menuItemName: i.menuItem.name,
    })),
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      status: n.status,
      reason: n.reason,
      createdAt: n.createdAt,
      tableId: n.session.table.id,
      tableCode: n.session.table.code,
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      status: s.status,
      updatedAt: s.updatedAt,
      tableId: s.table.id,
      tableCode: s.table.code,
    })),
  })
}
