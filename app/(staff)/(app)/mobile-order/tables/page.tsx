import {
  getStoreSettings,
  listCustomerPaidBills,
  listPaymentsAwaitingCallback,
  listServicesAwaitingStart,
  listTableOverview,
} from "@/lib/queries"
import { spaAwareMetadata } from "@/lib/spa-title"
import { requirePageAccess } from "@/lib/permissions"
import { TableOverview } from "@/components/table-overview"

export function generateMetadata() {
  return spaAwareMetadata("ผังโต๊ะ", "ผังโต๊ะอาหาร/ห้องสปา")
}

export default async function TablesPage() {
  // ด่านชั้นที่ 1 ของ §4 (Phase 16) — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted } = await requirePageAccess("MO_TABLES")
  const [tables, paidBills, awaitingCallback, settings, awaitingStart] = await Promise.all([
    listTableOverview(storeId),
    listCustomerPaidBills(storeId),
    listPaymentsAwaitingCallback(storeId),
    getStoreSettings(storeId),
    // ห้องที่เช็กอินแล้วรอกดเริ่มนวด (20e) — ร้านอาหารล้วนได้ลิสต์ว่างเสมอ
    listServicesAwaitingStart(storeId),
  ])

  return (
    <TableOverview
      tables={tables}
      paidBills={paidBills}
      awaitingCallback={awaitingCallback}
      allowed={granted.MO_TABLES ?? []}
      canAcknowledge={granted.MO_NOTIFICATIONS?.includes("EDIT") ?? false}
      spaEnabled={settings?.spaEnabled ?? false}
      awaitingStart={awaitingStart}
      // เริ่มนวด = MO_TABLES:EDIT หรือ SPA_BOOKINGS:EDIT ตรงกับด่านของ startServiceItem
      canStartService={(granted.MO_TABLES?.includes("EDIT") ?? false) || (granted.SPA_BOOKINGS?.includes("EDIT") ?? false)}
    />
  )
}
