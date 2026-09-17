/// เมนูตัวอย่างที่ระบบใส่ให้ร้านใหม่ (Phase 14a · ปรับ 2026-09-17)
///
/// ชื่อขึ้นต้นด้วยคำนี้ให้เห็นชัดทุกที่ที่ชื่อเมนูโผล่ (จัดการเมนู / จอขาย / หน้าลูกค้า) — เจ้าของร้านใหม่เคยงง
/// ว่าเมนูมาจากไหน · ไฟล์นี้ไม่ import "server-only" เพราะหน้าจัดการเมนู (client) ใช้ตรวจว่ายังมีตัวอย่างค้างอยู่ไหม
export const SAMPLE_MENU_PREFIX = "[ตัวอย่าง]"

export function isSampleMenuName(name: string): boolean {
  return name.startsWith(SAMPLE_MENU_PREFIX)
}
