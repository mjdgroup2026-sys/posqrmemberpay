import { getStoreSettings, listCustomerPaidBills, listPaymentsAwaitingCallback, listTableOverview } from "@/lib/queries"
import { spaAwareMetadata } from "@/lib/spa-title"
import { requirePageAccess } from "@/lib/permissions"
import { TableOverview } from "@/components/table-overview"

export function generateMetadata() {
  return spaAwareMetadata("ผังโต๊ะ", "ผังโต๊ะอาหาร/ห้องสปา")
}

export default async function TablesPage() {
  // ด่านชั้นที่ 1 ของ §4 (Phase 16) — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted } = await requirePageAccess("MO_TABLES")
  const [tables, paidBills, awaitingCallback, settings] = await Promise.all([
    listTableOverview(storeId),
    listCustomerPaidBills(storeId),
    listPaymentsAwaitingCallback(storeId),
    getStoreSettings(storeId),
  ])

  return (
    <TableOverview
      tables={tables}
      paidBills={paidBills}
      awaitingCallback={awaitingCallback}
      allowed={granted.MO_TABLES ?? []}
      canAcknowledge={granted.MO_NOTIFICATIONS?.includes("EDIT") ?? false}
      spaEnabled={settings?.spaEnabled ?? false}
    />
  )
}
