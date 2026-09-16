"use server"

import { revalidatePath } from "next/cache"
import { forStore, type StoreTx } from "@/lib/db"
import { requireSellingStore, storeErrorMessage, type StoreContext } from "@/lib/session"
import { requireStoreAccess } from "@/lib/permissions"
import { findStoreByQrToken } from "@/lib/store-resolve"
import { isPlanActive } from "@/lib/subscription"
import { assertTableCapacity, TableLimitExceeded } from "@/lib/table-limit"
import {
  openTableSchema,
  mergeTablesSchema,
  unmergeTableSchema,
  cancelSessionSchema,
  createTableSchema,
  bulkTableSchema,
  renameTableSchema,
  idSchema,
  firstIssueMessage,
  zodToFieldErrors,
} from "@/lib/validation"
import type { TableSessionStatus } from "@/generated/prisma/client"
import type { ActionResult, FieldErrors } from "@/lib/types"


/// สถานะ session ที่ยังถือว่า "โต๊ะเปิดอยู่"
const LIVE_SESSION_STATUS: TableSessionStatus[] = ["OPEN", "AWAITING_BILL"]

function revalidateTablePages() {
  revalidatePath("/mobile-order/tables")
  revalidatePath("/mobile-order/notifications")
  revalidatePath("/mobile-order/kitchen")
}

class TableAbort extends Error {
  constructor(readonly failure: { error: string; fieldErrors?: FieldErrors }) {
    super("TABLE_ABORT")
  }
}

export type OpenSessionResult = { sessionId: string; tableId: string; tableCode: string; reused: boolean }

/// เปิดโต๊ะ — ใช้ได้ทั้งตอนลูกค้าสแกน QR (qrToken) และตอนพนักงานกดเปิดเอง (tableId)
///
/// กติกา (§3 Table Session Lifecycle):
/// - สแกนซ้ำที่โต๊ะที่มี session OPEN/AWAITING_BILL อยู่แล้ว → คืน session เดิม ไม่สร้างซ้ำ
/// - โต๊ะที่ถูกรวมเข้าโต๊ะอื่น (primaryTableId != null) → เด้งไปที่ session ของโต๊ะหลัก
/// - QR ที่ INVALIDATED แล้ว → ไม่เปิดให้ ต้องให้พนักงานพิมพ์ใบใหม่
export async function openTableSession(formData: FormData): Promise<ActionResult<OpenSessionResult>> {
  // ลูกค้าที่สแกน QR ยังไม่ได้ล็อกอิน — ทางนี้จึงไม่บังคับ requireUser()
  // ส่วนการเปิดด้วย tableId (พนักงาน) บังคับล็อกอินเสมอ
  const parsed = openTableSchema.safeParse({
    tableId: formData.get("tableId") ?? undefined,
    qrToken: formData.get("qrToken") ?? undefined,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const { tableId, qrToken } = parsed.data

  // ร้านมาจากคนละที่ตามทางเข้า (Phase 13): ลูกค้า → qrToken ชี้ร้าน · พนักงาน → ร้านที่ทำงานอยู่
  let storeId: string
  if (qrToken) {
    const store = await findStoreByQrToken(qrToken)
    if (!store) return { ok: false, error: "ไม่พบ QR Code นี้ในระบบ กรุณาแจ้งพนักงาน" }
    if (store.status === "SUSPENDED") return { ok: false, error: "ร้านนี้ปิดรับออเดอร์ชั่วคราว" }
    // แพ็กเกจหมดอายุ (Phase 14b) — เปิดโต๊ะใหม่ไม่ได้ทั้งจากฝั่งลูกค้าและพนักงาน
    if (!isPlanActive(new Date(), store.planExpiresAt)) return { ok: false, error: "ร้านนี้ปิดรับออเดอร์ชั่วคราว" }
    storeId = store.storeId
  } else {
    try {
      // Phase 16: ต้องมีสิทธิ์เปิดโต๊ะ + แพ็กเกจยังไม่หมดอายุ (Phase 14b) — resolveStoreContext() cache ไว้ จึงไม่ยิง DB ซ้ำ
      await requireStoreAccess(["MO_TABLES", "ADD"])
      storeId = (await requireSellingStore()).storeId
    } catch (error) {
      return { ok: false, error: storeErrorMessage(error) }
    }
  }
  const db = forStore(storeId)

  try {
    const result = await db.$transaction(async (tx) => {
      let qrCodeId: string | undefined
      let targetTableId = tableId

      if (qrToken) {
        const qr = await tx.qRCode.findUnique({
          where: { token: qrToken },
          select: { id: true, tableId: true, status: true },
        })
        if (!qr) throw new TableAbort({ error: "ไม่พบ QR Code นี้ในระบบ กรุณาแจ้งพนักงาน" })
        if (qr.status === "INVALIDATED") {
          throw new TableAbort({ error: "QR Code นี้ใช้ไม่ได้แล้ว กรุณาแจ้งพนักงานให้เปิดโต๊ะใหม่" })
        }
        qrCodeId = qr.id
        targetTableId = qr.tableId
      }

      const table = await tx.table.findUnique({
        where: { id: targetTableId },
        select: { id: true, code: true, status: true, primaryTableId: true },
      })
      if (!table) throw new TableAbort({ error: "ไม่พบโต๊ะที่ต้องการเปิด" })

      // โต๊ะรองที่ถูกรวมแล้ว — ทุกอย่างวิ่งไปที่ session ของโต๊ะหลัก
      const effectiveTableId = table.primaryTableId ?? table.id
      const effectiveTable =
        table.primaryTableId === null
          ? table
          : await tx.table.findUniqueOrThrow({
              where: { id: table.primaryTableId },
              select: { id: true, code: true, status: true, primaryTableId: true },
            })

      const existing = await tx.tableSession.findFirst({
        where: { tableId: effectiveTableId, status: { in: LIVE_SESSION_STATUS } },
        orderBy: { openedAt: "desc" },
        select: { id: true },
      })
      if (existing) {
        return { sessionId: existing.id, tableId: effectiveTableId, tableCode: effectiveTable.code, reused: true }
      }

      if (table.primaryTableId !== null) {
        throw new TableAbort({ error: `โต๊ะ ${table.code} ถูกรวมกับโต๊ะ ${effectiveTable.code} อยู่ กรุณาแจ้งพนักงาน` })
      }

      // ★ conditional update — ด่านเดียวที่กันการสร้าง session ซ้ำตอนสแกนพร้อมกันสองเครื่อง
      //   (pattern เดียวกับกันขายเกินสต็อกในกติกาข้อ 4)
      const claimed = await tx.table.updateMany({
        where: { id: effectiveTableId, status: "EMPTY" },
        data: { status: "OPEN_NO_ORDER" },
      })
      if (claimed.count === 0) {
        const again = await tx.tableSession.findFirst({
          where: { tableId: effectiveTableId, status: { in: LIVE_SESSION_STATUS } },
          orderBy: { openedAt: "desc" },
          select: { id: true },
        })
        if (again) {
          return { sessionId: again.id, tableId: effectiveTableId, tableCode: effectiveTable.code, reused: true }
        }
        throw new TableAbort({ error: `โต๊ะ ${effectiveTable.code} ไม่พร้อมเปิด กรุณาแจ้งพนักงาน` })
      }

      const session = await tx.tableSession.create({
        data: { storeId, tableId: effectiveTableId, qrCodeId },
        select: { id: true },
      })

      return { sessionId: session.id, tableId: effectiveTableId, tableCode: effectiveTable.code, reused: false }
    })

    revalidateTablePages()
    return {
      ok: true,
      message: result.reused ? `กลับเข้าโต๊ะ ${result.tableCode}` : `เปิดโต๊ะ ${result.tableCode} เรียบร้อยแล้ว`,
      data: result,
    }
  } catch (error) {
    if (error instanceof TableAbort) return { ok: false, ...error.failure }
    return { ok: false, error: "เปิดโต๊ะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// รวมโต๊ะ — โต๊ะรองต้องว่างเท่านั้น และบิลทั้งหมดหลังจากนี้วิ่งเข้า session ของโต๊ะหลัก
export async function mergeTables(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_TABLES", "ADD"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = mergeTablesSchema.safeParse({
    primaryTableId: formData.get("primaryTableId") ?? "",
    secondaryTableId: formData.get("secondaryTableId") ?? "",
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const { primaryTableId, secondaryTableId } = parsed.data

  try {
    const codes = await db.$transaction(async (tx) => {
      const primary = await tx.table.findUnique({
        where: { id: primaryTableId },
        select: { id: true, code: true, primaryTableId: true },
      })
      if (!primary) throw new TableAbort({ error: "ไม่พบโต๊ะหลัก" })
      if (primary.primaryTableId !== null) {
        throw new TableAbort({ error: `โต๊ะ ${primary.code} ถูกรวมกับโต๊ะอื่นอยู่แล้ว ใช้เป็นโต๊ะหลักไม่ได้` })
      }

      const secondary = await tx.table.findUnique({
        where: { id: secondaryTableId },
        select: { id: true, code: true, status: true },
      })
      if (!secondary) throw new TableAbort({ error: "ไม่พบโต๊ะที่จะรวม" })

      const primarySession = await tx.tableSession.findFirst({
        where: { tableId: primaryTableId, status: { in: LIVE_SESSION_STATUS } },
        select: { id: true },
      })
      if (!primarySession) {
        throw new TableAbort({ error: `โต๊ะ ${primary.code} ยังไม่ได้เปิดใช้งาน — เปิดโต๊ะหลักก่อนจึงจะรวมโต๊ะได้` })
      }

      // ★ conditional update — โต๊ะรองต้องยังว่างอยู่จริง ณ วินาทีที่เขียน
      const merged = await tx.table.updateMany({
        where: { id: secondaryTableId, status: "EMPTY", primaryTableId: null },
        data: { primaryTableId, status: "OCCUPIED_MERGED" },
      })
      if (merged.count === 0) {
        throw new TableAbort({ error: `โต๊ะ ${secondary.code} ไม่ว่าง จึงรวมเข้ากับโต๊ะ ${primary.code} ไม่ได้` })
      }

      return { primary: primary.code, secondary: secondary.code }
    })

    revalidateTablePages()
    return { ok: true, message: `รวมโต๊ะ ${codes.secondary} เข้ากับโต๊ะ ${codes.primary} เรียบร้อยแล้ว` }
  } catch (error) {
    if (error instanceof TableAbort) return { ok: false, ...error.failure }
    return { ok: false, error: "รวมโต๊ะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// ยกเลิกการรวมโต๊ะ — ทำได้เฉพาะตอน session ของโต๊ะหลักยังไม่ปิดบิล
export async function unmergeTables(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_TABLES", "ADD"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = unmergeTableSchema.safeParse({
    secondaryTableId: formData.get("secondaryTableId") ?? "",
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  try {
    const code = await db.$transaction(async (tx) => {
      const secondary = await tx.table.findUnique({
        where: { id: parsed.data.secondaryTableId },
        select: { id: true, code: true, status: true, primaryTableId: true },
      })
      if (!secondary) throw new TableAbort({ error: "ไม่พบโต๊ะที่ต้องการยกเลิกการรวม" })
      if (secondary.primaryTableId === null) {
        throw new TableAbort({ error: `โต๊ะ ${secondary.code} ไม่ได้ถูกรวมกับโต๊ะไหนอยู่` })
      }

      const released = await tx.table.updateMany({
        where: { id: secondary.id, status: "OCCUPIED_MERGED" },
        data: { primaryTableId: null, status: "EMPTY" },
      })
      if (released.count === 0) {
        throw new TableAbort({ error: `โต๊ะ ${secondary.code} ถูกยกเลิกการรวมไปแล้ว` })
      }

      return secondary.code
    })

    revalidateTablePages()
    return { ok: true, message: `ยกเลิกการรวมโต๊ะ ${code} เรียบร้อยแล้ว` }
  } catch (error) {
    if (error instanceof TableAbort) return { ok: false, ...error.failure }
    return { ok: false, error: "ยกเลิกการรวมโต๊ะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// ยกเลิกโต๊ะทั้งชุด — คนละกลไกกับ void บิล (F6) เพราะยังไม่มีการจ่ายเงิน จึง **ไม่สร้าง Sale**
/// รายการอาหารที่ยังไม่เสิร์ฟถูกยกเลิกตามทั้งหมด และโต๊ะที่รวมอยู่กลับเป็นว่างพร้อมกันในทรานแซคชันเดียว
export async function cancelTableSession(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_TABLES", "DELETE"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const user = ctx.user
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = cancelSessionSchema.safeParse({
    sessionId: formData.get("sessionId") ?? "",
    reason: formData.get("reason") ?? "",
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const { sessionId, reason } = parsed.data

  try {
    const tableCode = await db.$transaction(async (tx) => {
      const session = await tx.tableSession.findUnique({
        where: { id: sessionId },
        select: { id: true, status: true, tableId: true, table: { select: { code: true } } },
      })
      if (!session) throw new TableAbort({ error: "ไม่พบโต๊ะที่ต้องการยกเลิก" })

      // ★ conditional update — กัน race กับการปิดบิล/ยกเลิกซ้ำจากอีกหน้าจอ
      const cancelled = await tx.tableSession.updateMany({
        where: { id: sessionId, status: { in: LIVE_SESSION_STATUS } },
        data: {
          status: "CANCELLED",
          closedAt: new Date(),
          closedById: user.id,
          cancelReason: reason,
        },
      })
      if (cancelled.count === 0) {
        throw new TableAbort({ error: `โต๊ะ ${session.table.code} ถูกปิดหรือยกเลิกไปแล้ว` })
      }

      // ยกเลิกรายการอาหารที่ยังไม่เสิร์ฟทั้งหมด (SERVED/CANCELLED ไปแล้วไม่แตะ)
      await tx.mobileOrderItem.updateMany({
        where: {
          order: { tableSessionId: sessionId },
          status: { in: ["AWAITING_KITCHEN", "COOKING", "READY"] },
        },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledById: user.id,
          cancelReason: reason,
        },
      })

      // คืนโต๊ะหลักและโต๊ะที่รวมอยู่ทั้งหมดเป็นว่างพร้อมกัน
      await tx.table.updateMany({
        where: { primaryTableId: session.tableId },
        data: { primaryTableId: null, status: "EMPTY" },
      })
      await tx.table.update({
        where: { id: session.tableId },
        data: { status: "EMPTY" },
      })

      return session.table.code
    })

    revalidateTablePages()
    return { ok: true, message: `ยกเลิกโต๊ะ ${tableCode} เรียบร้อยแล้ว (ไม่มีการออกบิล)` }
  } catch (error) {
    if (error instanceof TableAbort) return { ok: false, ...error.failure }
    return { ok: false, error: "ยกเลิกโต๊ะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

// ───────────────── จัดการโต๊ะ (master data) ─────────────────
//
// เดิมโต๊ะมาจาก `prisma/seed-mobile-order.ts` ทางเดียว — ร้านจริงต้องเพิ่ม/แก้/ลบเองได้
// จึงเพิ่มชุด action นี้ให้หน้า /mobile-order/tables/manage

/// โต๊ะที่ "ยุ่งอยู่" — ห้ามแก้รหัสหรือลบ เพราะรหัสถูกใช้อ้างบนทิกเก็ตครัวและใบเสร็จที่ออกไปแล้ว
async function assertTableIdle(
  tx: StoreTx,
  tableId: string,
) {
  const table = await tx.table.findUnique({
    where: { id: tableId },
    select: { code: true, status: true, primaryTableId: true, _count: { select: { mergedTables: true } } },
  })
  if (!table) throw new TableAbort({ error: "ไม่พบโต๊ะที่ต้องการแก้ไข" })

  const live = await tx.tableSession.count({
    where: { tableId, status: { in: LIVE_SESSION_STATUS } },
  })
  if (live > 0) throw new TableAbort({ error: `โต๊ะ ${table.code} กำลังเปิดอยู่ กรุณาปิดบิลก่อน` })
  if (table.primaryTableId !== null) {
    throw new TableAbort({ error: `โต๊ะ ${table.code} ถูกรวมกับโต๊ะอื่นอยู่ กรุณายกเลิกการรวมก่อน` })
  }
  if (table._count.mergedTables > 0) {
    throw new TableAbort({ error: `โต๊ะ ${table.code} มีโต๊ะอื่นรวมอยู่ กรุณายกเลิกการรวมก่อน` })
  }
  return table
}

export async function createTable(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_SETUP", "ADD"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = createTableSchema.safeParse({ code: formData.get("code") })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }

  try {
    // เพดานโต๊ะตาม tier (Phase 14b) — นับใต้ advisory lock ในทรานแซคชันเดียวกับการสร้าง
    await db.$transaction(async (tx) => {
      await assertTableCapacity(tx, storeId, ctx.plan.tableLimit, 1)
      await tx.table.create({ data: { storeId, code: parsed.data.code } })
    })
  } catch (error) {
    if (error instanceof TableLimitExceeded) return { ok: false, error: error.userMessage }
    if ((error as { code?: string }).code === "P2002") {
      return { ok: false, error: `มีโต๊ะรหัส ${parsed.data.code} อยู่แล้ว`, fieldErrors: { code: "รหัสนี้ซ้ำ" } }
    }
    return { ok: false, error: "เพิ่มโต๊ะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateTablePages()
  revalidatePath("/mobile-order/tables/manage")
  revalidatePath("/mobile-order/qr-codes")
  return { ok: true, message: `เพิ่มโต๊ะ ${parsed.data.code} เรียบร้อยแล้ว` }
}

/// สร้างโต๊ะเป็นชุด — รหัสที่ซ้ำกับของเดิมถูกข้ามไป ไม่ล้มทั้งชุด
/// (ร้านมักกดซ้ำเพื่อเติมโต๊ะที่ขาด การล้มทั้งชุดเพราะซ้ำ 1 ตัวคือพฤติกรรมที่น่ารำคาญ)
export async function createTablesBulk(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_SETUP", "ADD"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = bulkTableSchema.safeParse({
    prefix: formData.get("prefix") ?? "",
    from: formData.get("from"),
    to: formData.get("to"),
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }

  const { prefix, from, to } = parsed.data
  // เติมศูนย์ให้เท่ากับจำนวนหลักของเลขท้ายสุด — T01..T16 ไม่ใช่ T1..T16 จะได้เรียงถูก
  const width = String(to).length
  const codes = Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(width, "0")}`)

  const existing = await db.table.findMany({ where: { code: { in: codes } }, select: { code: true } })
  const taken = new Set(existing.map((t) => t.code))
  const fresh = codes.filter((code) => !taken.has(code))

  if (fresh.length === 0) {
    return { ok: false, error: "รหัสโต๊ะทั้งหมดในช่วงนี้มีอยู่แล้ว" }
  }

  try {
    await db.$transaction(async (tx) => {
      await assertTableCapacity(tx, storeId, ctx.plan.tableLimit, fresh.length)
      await tx.table.createMany({ data: fresh.map((code) => ({ storeId, code })), skipDuplicates: true })
    })
  } catch (error) {
    if (error instanceof TableLimitExceeded) return { ok: false, error: error.userMessage }
    return { ok: false, error: "เพิ่มโต๊ะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateTablePages()
  revalidatePath("/mobile-order/tables/manage")
  revalidatePath("/mobile-order/qr-codes")
  return {
    ok: true,
    message:
      taken.size > 0
        ? `เพิ่มโต๊ะ ${fresh.length} ตัว (ข้าม ${taken.size} ตัวที่มีอยู่แล้ว)`
        : `เพิ่มโต๊ะ ${fresh.length} ตัวเรียบร้อยแล้ว`,
  }
}

export async function renameTable(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_SETUP", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = renameTableSchema.safeParse({ id: formData.get("id"), code: formData.get("code") })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }

  try {
    await db.$transaction(async (tx) => {
      await assertTableIdle(tx, parsed.data.id)
      await tx.table.update({ where: { id: parsed.data.id }, data: { code: parsed.data.code } })
    })
  } catch (error) {
    if (error instanceof TableAbort) return { ok: false, ...error.failure }
    if ((error as { code?: string }).code === "P2002") {
      return { ok: false, error: `มีโต๊ะรหัส ${parsed.data.code} อยู่แล้ว`, fieldErrors: { code: "รหัสนี้ซ้ำ" } }
    }
    return { ok: false, error: "แก้รหัสโต๊ะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateTablePages()
  revalidatePath("/mobile-order/tables/manage")
  revalidatePath("/mobile-order/qr-codes")
  return { ok: true, message: `เปลี่ยนรหัสโต๊ะเป็น ${parsed.data.code} แล้ว` }
}

export async function deleteTable(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_SETUP", "DELETE"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  try {
    await db.$transaction(async (tx) => {
      const table = await assertTableIdle(tx, parsed.data.id)

      // ★ มีประวัติการเปิดโต๊ะแล้วลบไม่ได้ — TableSession ผูกกับบิลที่ออกไปแล้ว
      //   ลบทิ้งเท่ากับทำลายที่มาของยอดขาย · ให้เปลี่ยนรหัสแทนถ้าพิมพ์ผิด
      const history = await tx.tableSession.count({ where: { tableId: parsed.data.id } })
      if (history > 0) {
        throw new TableAbort({
          error: `ลบไม่ได้ — โต๊ะ ${table.code} เคยเปิดใช้งานมาแล้ว ${history} ครั้งและผูกกับบิลที่ออกไปแล้ว`,
        })
      }

      // QR ของโต๊ะที่ยังไม่เคยใช้งานลบทิ้งพร้อมกันได้ ไม่มีบิลอ้างถึง
      await tx.qRCode.deleteMany({ where: { tableId: parsed.data.id } })
      await tx.table.delete({ where: { id: parsed.data.id } })
    })
  } catch (error) {
    if (error instanceof TableAbort) return { ok: false, ...error.failure }
    return { ok: false, error: "ลบโต๊ะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateTablePages()
  revalidatePath("/mobile-order/tables/manage")
  revalidatePath("/mobile-order/qr-codes")
  return { ok: true, message: "ลบโต๊ะเรียบร้อยแล้ว" }
}
