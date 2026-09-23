import { listCustomerPaidBills, listNotifications, listPaymentsAwaitingCallback, listUpcomingBookings } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { NotificationBoard } from "@/components/notification-board"

export const metadata = { title: "การแจ้งเตือน" }

export default async function NotificationsPage() {
  // ด่านชั้นที่ 1 ของ §4 (Phase 16) — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted } = await requirePageAccess("MO_NOTIFICATIONS")
  const [notifications, awaitingCallback, paidBills, upcomingBookings] = await Promise.all([
    listNotifications(storeId),
    listPaymentsAwaitingCallback(storeId),
    listCustomerPaidBills(storeId),
    // ร้านที่ไม่ได้เปิดตัวเลือกร้านนวดไม่มีแถว booking เลย รายการจึงว่างเสมอ (Phase 20b)
    listUpcomingBookings(storeId),
  ])

  return (
    <NotificationBoard
      canAcknowledge={granted.MO_NOTIFICATIONS?.includes("EDIT") ?? false}
      notifications={notifications}
      awaitingCallback={awaitingCallback}
      paidBills={paidBills}
      upcomingBookings={upcomingBookings}
    />
  )
}
