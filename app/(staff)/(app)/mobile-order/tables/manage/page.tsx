import { listTablesForManage } from "@/lib/queries"
import { requireStorePage } from "@/lib/permissions"
import { TableAdmin } from "@/components/table-admin"

export const metadata = { title: "จัดการโต๊ะ" }

export default async function ManageTablesPage() {
  const { storeId } = await requireStorePage()
  const tables = await listTablesForManage(storeId)
  return <TableAdmin tables={tables} />
}
