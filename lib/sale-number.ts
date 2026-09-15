/// เลขบิลถัดไปรูปแบบ INV-000001 — เรียงต่อเนื่อง "ภายในร้าน" (Phase 13: ทุกร้านเริ่ม INV-000001 ของตัวเอง)
///
/// ใช้ร่วมกันทั้ง POS หน้าร้าน (app/actions/sales.ts) และ MJD Mobile Order (lib/close-session.ts)
/// เพื่อไม่ให้เลขชนกันข้ามช่องทางภายในร้านเดียวกัน
///
/// ★ ต้องจับ advisory lock ก่อนเสมอ: max+1 เฉย ๆ ทำให้ทรานแซคชันที่วิ่งพร้อมกันอ่านค่า max
///   เดียวกันแล้วชนที่ unique constraint (พิสูจน์แล้วด้วยเทส "ขายพร้อมกัน 8 บิล" — ผ่านแค่ 5)
///   lock นี้ปล่อยเองตอน commit/rollback จึงได้เลขเรียงต่อเนื่องไม่มีช่องว่างและไม่ต้อง retry
/// ★ key ของ lock ต้องเป็น "ต่อร้าน" — ถ้าใช้ค่าคงที่ตัวเดียว ทุกร้านจะต่อคิวออกเลขบิลผ่าน lock เดียว
///   ยังถูกต้องแต่ช้าลงตามจำนวนร้าน และเทสจับไม่ได้ (spec Phase 13 กับดักข้อ 4)
/// ⚠️ raw SQL ไม่ผ่าน @@map และไม่ผ่าน forStore() — ชื่อตารางต้องเป็นชื่อจริง ("sale")
///   และต้องกรอง storeId เองเสมอ

export type RawClient = {
  $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>
}

/// namespace ของ lock ชุดนี้ — กันชนกับ advisory lock อื่นที่อาจเพิ่มในอนาคต (เช่น เพดานโต๊ะใน Phase 14)
const SALE_NUMBER_LOCK_NAMESPACE = 720_001

export async function nextSaleNumber(tx: RawClient, storeId: string): Promise<string> {
  // pg_advisory_xact_lock(int, int) = key สองส่วน: namespace + hash ของร้าน
  // cast เป็น text เพราะ Prisma deserialize คอลัมน์ชนิด void ไม่ได้ (UnsupportedNativeDataType)
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(${SALE_NUMBER_LOCK_NAMESPACE}::int, hashtext(${storeId})::int)::text AS locked
  `

  const rows = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING("saleNumber" FROM '^INV-([0-9]+)$') AS INTEGER)) AS max
    FROM "sale"
    WHERE "storeId" = ${storeId} AND "saleNumber" ~ '^INV-[0-9]+$'
  `
  const max = rows[0]?.max ?? 0
  return `INV-${String(max + 1).padStart(6, "0")}`
}
