import { listCustomerPaidBills, listPaymentsAwaitingCallback, listTableOverview } from "@/lib/queries"
import { requireStorePage } from "@/lib/permissions"
import { TableOverview } from "@/components/table-overview"

export const metadata = { title: "ผังโต๊ะ" }

export default async function TablesPage() {
  const { storeId } = await requireStorePage()
  const [tables, paidBills, awaitingCallback] = await Promise.all([
    listTableOverview(storeId),
    listCustomerPaidBills(storeId),
    listPaymentsAwaitingCallback(storeId),
  ])

  return <TableOverview tables={tables} paidBills={paidBills} awaitingCallback={awaitingCallback} />
}
