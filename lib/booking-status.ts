/// ชื่อ + สีของสถานะคิวนวด — ที่เดียวที่ตารางจองและกระดานห้องใช้ร่วมกัน (2026-10-08)
///
/// เจ้าของสั่งให้แต่ละสถานะ "แยกกันง่าย ๆ" — สีมาจาก token ชุด `--q-*` ใน globals.css (7 โทนไม่ซ้ำกัน)
/// เดิมเช็กอินแล้ว (teal) กับเสร็จแล้ว (เขียว) ใกล้กันจนดูไม่ออก · เปลี่ยนสีที่นี่แล้วทั้งสองหน้าตามกันเอง
/// · ไฟล์นี้ไม่มี server-only — client component import ได้

export type BookingStatusKey = "BOOKED" | "CHECKED_IN" | "IN_SERVICE" | "DONE" | "CANCELLED" | "NO_SHOW"

export const BOOKING_STATUS_LABEL: Record<BookingStatusKey, string> = {
  BOOKED: "จองไว้",
  CHECKED_IN: "เช็กอินแล้ว",
  IN_SERVICE: "กำลังนวด",
  DONE: "เสร็จแล้ว",
  CANCELLED: "ยกเลิก",
  NO_SHOW: "ไม่มาตามนัด",
}

export const BOOKING_STATUS_CHIP: Record<BookingStatusKey, string> = {
  BOOKED: "chip-q-booked",
  CHECKED_IN: "chip-q-checkin",
  IN_SERVICE: "chip-q-active",
  DONE: "chip-q-done",
  CANCELLED: "chip-neutral",
  NO_SHOW: "chip-q-late",
}

/// สถานะของการ์ดบนกระดาน (ห้อง/พนักงาน) → คำ + สี · โทน = ชื่อชุด `--q-<tone>` ที่ใช้กับแถบสีข้างการ์ด
export type BoardTone = "booked" | "checkin" | "active" | "due" | "billing" | "free" | "done" | "late" | "off"

export const BOARD_TONE_CHIP: Record<BoardTone, string> = {
  booked: "chip-q-booked",
  checkin: "chip-q-checkin",
  active: "chip-q-active",
  due: "chip-q-due",
  billing: "chip-q-billing",
  free: "chip-q-free",
  done: "chip-q-done",
  late: "chip-q-late",
  off: "chip-neutral",
}
