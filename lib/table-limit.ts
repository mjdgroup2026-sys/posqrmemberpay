import type { RawClient } from "@/lib/sale-number"

/// เพดานโต๊ะตาม tier ของแพ็กเกจ (Phase 14b) — "โต๊ะทุกตัวที่มีอยู่ต้องอยู่ในเพดานของ tier ที่จ่าย"
///
/// ★ ต้องนับใต้ advisory lock ต่อร้าน (กติกาข้อ 4 แนวเดียวกับเลขบิล): นับก่อนแล้วค่อยสร้างแยกกัน
///   สองคำขอที่วิ่งพร้อมกันจะเห็นจำนวนเดิมแล้วทะลุเพดานได้ — เทส "ยิง createTable พร้อมกัน 5 ตอนมี 10/12 → ผ่าน 2" พิสูจน์
/// ★ รวมโต๊ะ (merge) ไม่นับเป็นสร้าง · ลบแล้วสร้างใหม่ได้ (นับแถวที่มีอยู่จริงในตาราง restaurant_table)
/// ⚠️ raw SQL ไม่ผ่าน forStore() — ต้องกรอง storeId เอง และชื่อตารางต้องเป็นชื่อจริง

/// namespace แยกจาก SALE_NUMBER_LOCK_NAMESPACE (720_001) — lock คนละเรื่องไม่ต้องรอกัน
const TABLE_LIMIT_LOCK_NAMESPACE = 720_002

export class TableLimitExceeded extends Error {
  constructor(
    readonly limit: number,
    readonly current: number,
    readonly adding: number,
  ) {
    super("TABLE_LIMIT_EXCEEDED")
  }

  /// ข้อความไทยที่ผู้ใช้เห็น — บอกเพดานและทางออก
  get userMessage(): string {
    const room = Math.max(0, this.limit - this.current)
    return (
      `แพ็กเกจของร้านรองรับได้ ${this.limit} โต๊ะ (ใช้อยู่ ${this.current}${room > 0 ? ` เพิ่มได้อีก ${room}` : ""}) — ` +
      "อัปเกรดแพ็กเกจได้ที่หน้า ค่าใช้งาน"
    )
  }
}

type CountClient = RawClient & {
  table: { count: (args: { where: { storeId: string } }) => Promise<number> }
}

/// จับ lock ต่อร้านแล้วตรวจว่าเพิ่มอีก `adding` โต๊ะแล้วยังอยู่ในเพดานไหม — เรียกในทรานแซคชันเดียวกับการ create เสมอ
/// lock ปล่อยเองตอน commit/rollback
export async function assertTableCapacity(tx: CountClient, storeId: string, tableLimit: number, adding: number): Promise<void> {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(${TABLE_LIMIT_LOCK_NAMESPACE}::int, hashtext(${storeId})::int)::text AS locked
  `
  const current = await tx.table.count({ where: { storeId } })
  if (current + adding > tableLimit) throw new TableLimitExceeded(tableLimit, current, adding)
}
