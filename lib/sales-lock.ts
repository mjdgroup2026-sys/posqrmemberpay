import "server-only"
import { getSalesLock } from "@/lib/queries"

/// ด่านรับเงินหลังปิดยอด (2026-10-08 เจ้าของสั่ง) — ทุก action ที่ "รับเงิน" ต้องเรียกก่อนเขียนอะไร
///
/// ใช้ที่: ปิดบิลโต๊ะ/ห้อง (`confirmMobilePayment`) · ออก QR ให้บิลโต๊ะ (`prepareStaffPromptPay`) · ขายกลับบ้าน/สินค้า
/// (`createTakeawaySale`) · POS หน้าร้านเดิม (`createSale`) — **เพิ่มทางรับเงินใหม่ต้องเรียกตัวนี้ด้วย**
/// · ไม่ล็อก: ลูกค้าสั่งอาหาร/ส่งครัว/จอง/เช็กอิน/เริ่มนวด (ยังไม่รับเงิน) · บิลที่ธนาคารปิดเอง (SYSTEM — เงินเข้าแล้ว ต้องปิดให้ได้)
/// คืนข้อความไทยพร้อมแสดง หรือ null = รับเงินได้
export async function salesLockError(storeId: string, cashierId: string): Promise<string | null> {
  const lock = await getSalesLock(storeId, cashierId)
  if (!lock.locked) return null
  return `คุณปิดยอดรอบที่ ${lock.roundNo} ของวันนี้แล้ว — กด “เปิดรอบขายใหม่” ที่หน้าปิดยอดประจำวันก่อน จึงจะรับเงินได้`
}
