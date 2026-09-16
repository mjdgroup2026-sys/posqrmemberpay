import { listCustomerPaidBills, listPaymentsAwaitingCallback, listTableOverview } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { TableOverview } from "@/components/table-overview"

export const metadata = { title: "ผังโต๊ะ" }

export default async function TablesPage() {
  // ด่านชั้นที่ 1 ของ §4 (Phase 16) — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId } = await requirePageAccess("MO_TABLES")
  const [tables, paidBills, awaitingCallback] = await Promise.all([
    listTableOverview(storeId),
    listCustomerPaidBills(storeId),
    listPaymentsAwaitingCallback(storeId),
  ])

  return <TableOverview tables={tables} paidBills={paidBills} awaitingCallback={awaitingCallback} />
}
