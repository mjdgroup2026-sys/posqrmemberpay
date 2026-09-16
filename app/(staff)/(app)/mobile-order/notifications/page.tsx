import { listCustomerPaidBills, listNotifications, listPaymentsAwaitingCallback } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { NotificationBoard } from "@/components/notification-board"

export const metadata = { title: "การแจ้งเตือน" }

export default async function NotificationsPage() {
  // ด่านชั้นที่ 1 ของ §4 (Phase 16) — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted } = await requirePageAccess("MO_NOTIFICATIONS")
  const [notifications, awaitingCallback, paidBills] = await Promise.all([
    listNotifications(storeId),
    listPaymentsAwaitingCallback(storeId),
    listCustomerPaidBills(storeId),
  ])

  return (
    <NotificationBoard
      canAcknowledge={granted.MO_NOTIFICATIONS?.includes("EDIT") ?? false}
      notifications={notifications}
      awaitingCallback={awaitingCallback}
      paidBills={paidBills}
    />
  )
}
