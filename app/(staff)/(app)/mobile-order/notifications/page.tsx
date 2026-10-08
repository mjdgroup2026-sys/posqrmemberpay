import {
  listCustomerPaidBills,
  listNotifications,
  listPaymentsAwaitingCallback,
  listServicesAwaitingStart,
} from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { NotificationBoard } from "@/components/notification-board"

export const metadata = { title: "การแจ้งเตือน" }

export default async function NotificationsPage() {
  // ด่านชั้นที่ 1 ของ §4 (Phase 16) — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted } = await requirePageAccess("MO_NOTIFICATIONS")
  const [notifications, awaitingCallback, paidBills, awaitingStart] = await Promise.all([
    listNotifications(storeId),
    listPaymentsAwaitingCallback(storeId),
    listCustomerPaidBills(storeId),
    // คิวจอง (ใกล้ถึงเวลา/เช็กอินแล้วรอเริ่ม) ย้ายไปหน้า "คิวนวด" แล้ว (2026-10-08) — ที่นี่เหลือห้อง walk-in
    listServicesAwaitingStart(storeId, { excludeBooked: true }),
  ])

  return (
    <NotificationBoard
      canAcknowledge={granted.MO_NOTIFICATIONS?.includes("EDIT") ?? false}
      notifications={notifications}
      awaitingCallback={awaitingCallback}
      paidBills={paidBills}
      awaitingStart={awaitingStart}
    />
  )
}
