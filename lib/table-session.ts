import "server-only"
import type { StoreTx } from "@/lib/db"
import type { TableSessionStatus } from "@/generated/prisma/client"

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

export async function openOrReuseSession(
  tx: StoreTx,
  storeId: string,
  input: { tableId: string; qrCodeId?: string },
): Promise<OpenSessionOutcome> {
  const table = await tx.table.findUnique({
    where: { id: input.tableId },
    select: { id: true, code: true, status: true, primaryTableId: true },
  })
  if (!table) throw new SessionError("ไม่พบโต๊ะที่ต้องการเปิด")

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
