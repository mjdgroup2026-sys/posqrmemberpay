import "server-only"
import { Socket } from "node:net"
import { groupByStation, hasStationSplit } from "@/lib/ticket-lines"

/// พิมพ์ทิกเก็ตครัวผ่านเครื่องพิมพ์ใบเสร็จความร้อนที่ต่อ LAN (ESC/POS over TCP พอร์ต 9100)
///
/// ⚠️ **เส้นทางหลักตอนนี้คือ PDF ไม่ใช่ไฟล์นี้** — ร้านที่ยังไม่มีเครื่องพิมพ์ความร้อนใช้หน้า
///    `/tickets/[orderId]` พิมพ์/บันทึกเป็น PDF ผ่านเบราว์เซอร์แทน (ดู components/kitchen-ticket.tsx)
///    ไฟล์นี้ยังอยู่ครบและทำงานทันทีที่ตั้ง KITCHEN_PRINTER_HOST — ทั้งสองทางใช้คู่กันได้ ไม่ใช่ทางเลือกแทนกัน
///
/// ตั้งค่าด้วย env — ไม่ตั้ง = ไม่มีเครื่องพิมพ์ ระบบทำงานต่อได้ปกติโดยไม่ล้ม:
///   KITCHEN_PRINTER_HOST=192.168.1.50
///   KITCHEN_PRINTER_PORT=9100        (ไม่ระบุ = 9100)
///   KITCHEN_PRINTER_TIMEOUT_MS=4000  (ไม่ระบุ = 4000)
///
/// ⚠️ การพิมพ์ต้องไม่ล้มทั้งทรานแซคชันของออร์เดอร์ — เรียกหลัง commit เสมอ แล้วบันทึกผลลง
///    `MobileOrder.printedAt` (null = ยังพิมพ์ไม่สำเร็จ พนักงานสั่งพิมพ์ซ้ำได้จากหน้ารายละเอียดโต๊ะ)

const ESC = "\x1B"
const GS = "\x1D"

export type KitchenTicketPayload = {
  tableCode: string
  orderNumber: number
  submittedAt: Date
  items: {
    quantity: number
    name: string
    options: string[]
    note: string | null
    /// ประเภทครัว (Phase 19) — ไม่ส่ง/ null = ไม่ระบุ · ทุกบรรทัดไม่ระบุ = พิมพ์แบบเดิมไม่มีหัวกลุ่ม
    stationId?: string | null
    stationName?: string | null
  }[]
  /// ลำดับ station ของร้าน (ไม่บังคับ) — ไม่ส่ง = เรียงตามชื่อ
  stationOrder?: { id: string; sortOrder: number }[]
}

export function isPrinterConfigured(): boolean {
  return Boolean(process.env.KITCHEN_PRINTER_HOST)
}

/// ประกอบข้อความ ESC/POS — ใช้ code page ไทย (TIS-620 / PC874) ที่เครื่องพิมพ์ไทยรองรับกันแทบทุกรุ่น
function buildTicket(payload: KitchenTicketPayload): Buffer {
  const lines: string[] = []
  lines.push(`${ESC}@`) // reset
  lines.push(`${ESC}t\x15`) // เลือก code page 21 (PC874/TIS-620)
  lines.push(`${ESC}a\x01`) // จัดกึ่งกลาง
  lines.push(`${GS}!\x11`) // ตัวใหญ่ 2 เท่า
  lines.push(`โต๊ะ ${payload.tableCode}\n`)
  lines.push(`${GS}!\x00`) // กลับขนาดปกติ
  lines.push(`ออร์เดอร์ที่ ${payload.orderNumber}\n`)
  lines.push(
    `${payload.submittedAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })}\n`,
  )
  lines.push(`${ESC}a\x00`) // ชิดซ้าย
  lines.push("--------------------------------\n")

  // จัดกลุ่มตามประเภทครัว (Phase 19) — ลำดับ/ชื่อกลุ่มมาจาก lib/ticket-lines.ts ที่เดียว ให้ตรงกับ KDS และทิกเก็ต PDF
  const groups = groupByStation(
    payload.items.map((item) => ({ ...item, stationId: item.stationId ?? null, stationName: item.stationName ?? null })),
    payload.stationOrder ?? [],
  )
  const split = hasStationSplit(groups)

  for (const group of groups) {
    if (split) {
      lines.push(`${ESC}E\x01`) // ตัวหนา
      lines.push(`[ ${group.stationName} ]\n`)
      lines.push(`${ESC}E\x00`)
    }
    for (const item of group.items) {
      lines.push(`${item.quantity} x ${item.name}\n`)
      if (item.options.length > 0) lines.push(`   (${item.options.join(", ")})\n`)
      if (item.note) lines.push(`   * ${item.note}\n`)
    }
    if (split) lines.push("\n")
  }

  lines.push("--------------------------------\n\n\n")
  lines.push(`${GS}V\x00`) // ตัดกระดาษ

  // TIS-620 คือ latin1 ของช่วง 0xA1–0xFB สำหรับอักษรไทย — Buffer จึงเข้ารหัสด้วย latin1 ได้ตรง
  return Buffer.from(lines.join(""), "latin1")
}

/// ส่งทิกเก็ตไปเครื่องพิมพ์ — คืน false เมื่อไม่มีเครื่องพิมพ์หรือส่งไม่สำเร็จ (ไม่ throw)
export async function printKitchenTicket(payload: KitchenTicketPayload): Promise<boolean> {
  const host = process.env.KITCHEN_PRINTER_HOST
  if (!host) return false

  const port = Number(process.env.KITCHEN_PRINTER_PORT ?? 9100)
  const timeout = Number(process.env.KITCHEN_PRINTER_TIMEOUT_MS ?? 4000)
  const data = buildTicket(payload)

  return new Promise<boolean>((resolve) => {
    const socket = new Socket()
    let settled = false

    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }

    socket.setTimeout(timeout)
    socket.on("timeout", () => finish(false))
    socket.on("error", () => finish(false))
    socket.connect(port, host, () => {
      socket.write(data, () => finish(true))
    })
  })
}
