import "server-only"
import { getSalesLock } from "@/lib/queries"

/// ด่านขายหลังปิดยอด (2026-10-08 ล็อกรับเงิน · 2026-10-09 เจ้าของสั่งขยายเป็น "ขายไม่ได้เลย") — ทุก action ที่ขายใหม่หรือรับเงินต้องเรียกก่อนเขียนอะไร
///
/// ใช้ที่: เปิดโต๊ะ (`openTableSession` ฝั่งพนักงาน) · สั่งเข้าโต๊ะจากจอขาย (`createStaffTableOrder`) · เช็กอินคิวนวด (`checkInBooking`) ·
/// ขายกลับบ้าน/สินค้า (`createTakeawaySale`) · POS หน้าร้านเดิม (`createSale`) · ปิดบิลโต๊ะ/ห้อง (`confirmMobilePayment`) ·
/// ออก QR ให้บิลโต๊ะ (`prepareStaffPromptPay`) — **เพิ่มทางขาย/รับเงินใหม่ต้องเรียกตัวนี้ด้วย**
/// · ไม่ล็อก: ครัว/เสิร์ฟ/เริ่มนวด/นวดเสร็จ/ยกเลิกรายการ (งานของออร์เดอร์เดิม) · จองคิวล่วงหน้า · รวมโต๊ะ ·
///   ลูกค้าสแกน QR สั่งเอง (ไม่ใช่ของพนักงานคนใด — ล็อกเป็นรายคน) · บิลที่ธนาคารปิดเอง (SYSTEM — เงินเข้าแล้ว ต้องปิดให้ได้)
/// คืนข้อความไทยพร้อมแสดง หรือ null = ขายได้
export async function salesLockError(storeId: string, cashierId: string): Promise<string | null> {
  const lock = await getSalesLock(storeId, cashierId)
  if (!lock.locked) return null
  return salesLockMessage(lock.roundNo)
}

export function salesLockMessage(roundNo: number | null): string {
  return `ปิดรอบที่ ${roundNo ?? ""} ของวันนี้ไปแล้ว ไม่สามารถขายได้ — ต้องกด “เปิดรอบขายใหม่” ก่อน`
}
