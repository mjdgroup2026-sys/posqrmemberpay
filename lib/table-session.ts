import "server-only"
import type { StoreTx } from "@/lib/db"
import type { TableSessionStatus } from "@/generated/prisma/client"
import type { RawClient } from "@/lib/sale-number"

/// "หา session ที่เปิดอยู่ของโต๊ะ หรือเปิดใหม่ให้" — ตรรกะเดียวที่ใช้ร่วมกันทุกทางเข้า (Phase 17b)
///
/// ทางเข้าที่เรียกตัวนี้: ลูกค้าสแกน QR · พนักงานกดเปิดโต๊ะบนผังโต๊ะ · พนักงานกดขายจากจอขายอาหาร
/// ห้ามลอกไปเขียนซ้ำ เพราะกติกาใน §3 (โต๊ะที่ถูกรวม / กันเปิดซ้ำตอนสแกนพร้อมกัน) ต้องเหมือนกันทุกทาง

/// สถานะ session ที่ยังถือว่า "โต๊ะเปิดอยู่"
export const LIVE_SESSION_STATUS: TableSessionStatus[] = ["OPEN", "AWAITING_BILL"]

export type LiveSessionStatus = Extract<TableSessionStatus, "OPEN" | "AWAITING_BILL">

export class SessionError extends Error {
  constructor(readonly reason: string) {
    super("SESSION_ERROR")
  }
}

export type OpenSessionOutcome = {
  sessionId: string
  tableId: string
  tableCode: string
  /// true = กลับเข้าบิลเดิมของโต๊ะ (ไม่ได้เปิดใหม่)
  reused: boolean
  /// สถานะของ session ที่ได้ — โต๊ะที่ขอเช็กบิลแล้วสั่งอาหารเพิ่มไม่ได้ (ผู้เรียกเป็นคนตัดสิน)
  status: LiveSessionStatus
}

export type OpenSessionInput = {
  tableId: string
  qrCodeId?: string
  /// เข้าบิลที่ระบุ (ห้องสปาที่มีหลายบิล · 2026-09-23) — ต้องเป็นบิลที่ยังเปิดอยู่ของโต๊ะ/ห้องนี้เท่านั้น
  sessionId?: string
  /// เปิดบิลใหม่แยกให้ลูกค้าอีกคน แม้ห้องนี้มีบิลเปิดอยู่แล้ว (เฉพาะ `Table.kind = ROOM`)
  /// — ร้านสปา: ลูกค้าคนละคนใช้ห้องเดียวกันคนละเวลา ต้องจ่ายแยกบิล · 1 บิล = 1 session ยังเป็นกติกาเดิม (ข้อ 8)
  newCustomer?: { label: string | null }
}

export async function openOrReuseSession(tx: StoreTx, storeId: string, input: OpenSessionInput): Promise<OpenSessionOutcome> {
  const table = await tx.table.findUnique({
    where: { id: input.tableId },
    select: { id: true, code: true, status: true, primaryTableId: true, kind: true },
  })
  if (!table) throw new SessionError("ไม่พบโต๊ะที่ต้องการเปิด")

  // โต๊ะรองที่ถูกรวมแล้ว — ทุกอย่างวิ่งไปที่ session ของโต๊ะหลัก
  const effectiveTableId = table.primaryTableId ?? table.id
  const effectiveTable =
    table.primaryTableId === null
      ? table
      : await tx.table.findUniqueOrThrow({
          where: { id: table.primaryTableId },
          select: { id: true, code: true, status: true, primaryTableId: true, kind: true },
        })

  // ── เข้าบิลที่เลือกไว้ (ห้องที่มีหลายบิล) ──
  if (input.sessionId) {
    const chosen = await tx.tableSession.findFirst({
      where: { id: input.sessionId, tableId: effectiveTableId, status: { in: LIVE_SESSION_STATUS } },
      select: { id: true, status: true },
    })
    if (!chosen) throw new SessionError("บิลที่เลือกถูกปิดหรือยกเลิกไปแล้ว กรุณาเลือกบิลใหม่")
    return { sessionId: chosen.id, tableId: effectiveTableId, tableCode: effectiveTable.code, reused: true, status: chosen.status as LiveSessionStatus }
  }

  // ── ลูกค้าใหม่ในห้องสปา = บิลใหม่แยก ──
  if (input.newCustomer) {
    if (effectiveTable.kind !== "ROOM") throw new SessionError("แยกบิลต่อลูกค้าได้เฉพาะห้องสปา — โต๊ะอาหารใช้บิลเดียวต่อโต๊ะ")
    if (table.primaryTableId !== null) {
      throw new SessionError(`ห้อง ${table.code} ถูกรวมกับ ${effectiveTable.code} อยู่ แยกบิลไม่ได้`)
    }
    // ล็อกแถวห้องก่อน — กันจังหวะที่บิลสุดท้ายของห้องกำลังปิด (คืนห้องเป็นว่าง) พร้อมกับที่บิลใหม่กำลังเปิด
    await lockTableRow(tx, storeId, effectiveTableId)
    // ห้องว่าง = จองห้องด้วย conditional update เดิม · ห้องมีบิลอยู่แล้ว = ไม่ต้องจอง แค่เพิ่มบิลใบใหม่
    // (ลูกค้าสองคนเข้าพร้อมกันได้สองบิลคือผลที่ต้องการ ไม่ใช่ race ที่ต้องกัน)
    await tx.table.updateMany({ where: { id: effectiveTableId, status: "EMPTY" }, data: { status: "OPEN_NO_ORDER" } })
    const created = await tx.tableSession.create({
      data: { storeId, tableId: effectiveTableId, qrCodeId: input.qrCodeId, customerLabel: input.newCustomer.label },
      select: { id: true },
    })
    return { sessionId: created.id, tableId: effectiveTableId, tableCode: effectiveTable.code, reused: false, status: "OPEN" }
  }

  const existing = await tx.tableSession.findFirst({
    where: { tableId: effectiveTableId, status: { in: LIVE_SESSION_STATUS } },
    orderBy: { openedAt: "desc" },
    select: { id: true, status: true },
  })
  if (existing) {
    return {
      sessionId: existing.id,
      tableId: effectiveTableId,
      tableCode: effectiveTable.code,
      reused: true,
      status: existing.status as LiveSessionStatus,
    }
  }

  if (table.primaryTableId !== null) {
    throw new SessionError(`โต๊ะ ${table.code} ถูกรวมกับโต๊ะ ${effectiveTable.code} อยู่ กรุณาแจ้งพนักงาน`)
  }

  // ★ conditional update — ด่านเดียวที่กันการสร้าง session ซ้ำตอนสแกน/กดขายพร้อมกันสองเครื่อง
  //   (pattern เดียวกับกันขายเกินสต็อกในกติกาข้อ 4)
  const claimed = await tx.table.updateMany({
    where: { id: effectiveTableId, status: "EMPTY" },
    data: { status: "OPEN_NO_ORDER" },
  })
  if (claimed.count === 0) {
    const again = await tx.tableSession.findFirst({
      where: { tableId: effectiveTableId, status: { in: LIVE_SESSION_STATUS } },
      orderBy: { openedAt: "desc" },
      select: { id: true, status: true },
    })
    if (again) {
      return {
        sessionId: again.id,
        tableId: effectiveTableId,
        tableCode: effectiveTable.code,
        reused: true,
        status: again.status as LiveSessionStatus,
      }
    }
    throw new SessionError(`โต๊ะ ${effectiveTable.code} ไม่พร้อมเปิด กรุณาแจ้งพนักงาน`)
  }

  const session = await tx.tableSession.create({
    data: { storeId, tableId: effectiveTableId, qrCodeId: input.qrCodeId },
    select: { id: true },
  })

  return {
    sessionId: session.id,
    tableId: effectiveTableId,
    tableCode: effectiveTable.code,
    reused: false,
    status: "OPEN",
  }
}

/// ล็อกแถวโต๊ะ/ห้องไว้จนจบทรานแซคชัน (2026-09-23) — ใช้คู่กับ `releaseTableIfIdle`
///
/// ห้องสปามีได้หลายบิลพร้อมกัน การ "คืนห้องเป็นว่าง" จึงต้องนับบิลที่ยังเปิดก่อน ถ้าสองบิลปิดพร้อมกัน
/// ต่างฝ่ายจะเห็นอีกใบยังเปิด (ยังไม่ commit) แล้วไม่มีใครคืนห้อง → ห้องค้างสถานะไม่ว่างทั้งที่ไม่มีบิล
/// ล็อกแถวนี้ทำให้ทรานแซคชันที่แตะห้องเดียวกันเรียงคิวกัน
/// ⚠️ raw SQL — ชื่อตารางจริง `restaurant_table` และต้องกรอง storeId เอง (กติกาข้อ 5)
export async function lockTableRow(tx: StoreTx, storeId: string, tableId: string): Promise<void> {
  const raw = tx as unknown as RawClient
  await raw.$queryRaw`
    SELECT "id" FROM "restaurant_table" WHERE "id" = ${tableId} AND "storeId" = ${storeId} FOR UPDATE
  `
}

/// คืนโต๊ะ/ห้อง (และโต๊ะที่รวมอยู่) เป็นว่าง **เมื่อไม่มีบิลเปิดค้างแล้วเท่านั้น** — เรียกหลังเปลี่ยนสถานะ session ของตัวเองแล้ว
///
/// โต๊ะอาหารมี session เดียวเสมอ จึงคืนทุกครั้งเหมือนเดิม · ห้องสปาที่ยังมีบิลของลูกค้าคนอื่นค้างอยู่ไม่ถูกคืน
/// คืนค่า true = คืนโต๊ะแล้ว (ผู้เรียกใช้ตัดสินเรื่อง QR ชั่วคราวต่อ)
export async function releaseTableIfIdle(tx: StoreTx, storeId: string, tableId: string): Promise<boolean> {
  await lockTableRow(tx, storeId, tableId)
  const stillOpen = await tx.tableSession.count({ where: { tableId, status: { in: LIVE_SESSION_STATUS } } })
  if (stillOpen > 0) return false

  // โต๊ะหลักและโต๊ะที่รวมอยู่กลับเป็นว่างพร้อมกันในทรานแซคชันเดียว
  await tx.table.updateMany({ where: { primaryTableId: tableId }, data: { primaryTableId: null, status: "EMPTY" } })
  await tx.table.update({ where: { id: tableId }, data: { status: "EMPTY" } })
  return true
}

/// บิลที่ยังเปิดของ "ลูกค้าคนเดิม" ในโต๊ะ/ห้องนี้ (2026-09-23) — ใช้ตอนเช็กอินคิวจอง
///
/// คนเดิม = ชื่อตรงกัน (ไม่สนช่องว่าง/ตัวพิมพ์) และถ้าทั้งสองฝั่งมีเบอร์โทร เบอร์ต้องตรงกันด้วย
/// เทียบทั้งป้ายของบิล (`customerLabel`) และชื่อในคิวจองที่เช็กอินเข้าบิลนั้นไปแล้ว (บิลเก่าก่อนมีป้าย)
/// ไม่เจอ = null → ผู้เรียกเปิดบิลใหม่แยก (ลูกค้าคนละคนต้องจ่ายแยกบิล)
export async function findCustomerSession(
  tx: StoreTx,
  tableId: string,
  customer: { name: string; phone: string | null },
): Promise<string | null> {
  const table = await tx.table.findUnique({ where: { id: tableId }, select: { id: true, primaryTableId: true } })
  if (!table) return null
  const norm = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "").toLowerCase()
  const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "")
  const name = norm(customer.name)
  const phone = digits(customer.phone)
  if (!name) return null

  const sessions = await tx.tableSession.findMany({
    where: { tableId: table.primaryTableId ?? table.id, status: { in: LIVE_SESSION_STATUS } },
    orderBy: { openedAt: "desc" },
    select: { id: true, customerLabel: true, bookings: { select: { customerName: true, customerPhone: true } } },
  })
  const phoneMatches = (other: string | null) => !phone || !digits(other) || digits(other) === phone
  const hit = sessions.find(
    (s) =>
      (norm(s.customerLabel) === name && s.bookings.every((b) => norm(b.customerName) !== name || phoneMatches(b.customerPhone))) ||
      s.bookings.some((b) => norm(b.customerName) === name && phoneMatches(b.customerPhone)),
  )
  return hit?.id ?? null
}
