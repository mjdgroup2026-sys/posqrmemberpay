import { listCustomerPaidBills, listNotifications, listPaymentsAwaitingCallback } from "@/lib/queries"
import { requireStorePage } from "@/lib/permissions"
import { NotificationBoard } from "@/components/notification-board"

export const metadata = { title: "การแจ้งเตือน" }

export default async function NotificationsPage() {
  const { storeId } = await requireStorePage()
  const [notifications, awaitingCallback, paidBills] = await Promise.all([
    listNotifications(storeId),
    listPaymentsAwaitingCallback(storeId),
    listCustomerPaidBills(storeId),
  ])

  return (
    <NotificationBoard
      notifications={notifications}
      awaitingCallback={awaitingCallback}
      paidBills={paidBills}
    />
  )
}
